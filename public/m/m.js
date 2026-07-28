/* LimoFin companion (v0.3)
 * Three tabs: Today (safe-to-spend glance), Scan (receipts, offline queue),
 * Trends (insights). All data rendering goes through el()/textContent — never
 * innerHTML with data — so nothing a receipt or memo contains can execute.
 * Offline model: app shell via service worker, last glance via localStorage,
 * queued receipts via IndexedDB (synced when the LAN server is reachable).
 */
(() => {
  'use strict';

  const CATEGORIES = ['groceries', 'dining', 'gas', 'shopping', 'utilities', 'health', 'entertainment', 'travel', 'services', 'other'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const state = {
    tab: 'today',
    today: null,
    todayAt: null,
    insights: null,
    reachable: false,
    queue: [],
    review: null, // { source: 'live'|'queue', queueId?, receipt, parsed, ai, thumb }
    history: []
  };

  // ---------- tiny DOM + format helpers ----------
  const $ = (sel) => document.querySelector(sel);

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined) continue;
      node.append(child);
    }
    return node;
  }

  function money(cents, { compact = false } = {}) {
    if (cents === null || cents === undefined) return '–';
    const dollars = cents / 100;
    if (compact && Math.abs(dollars) >= 1000) {
      return `$${(dollars / 1000).toFixed(1)}k`;
    }
    const hasCents = Math.round(cents) % 100 !== 0;
    return dollars.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0
    });
  }

  function localToday() {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
  }

  function timeAgo(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  let toastTimer = null;
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
  }

  // ---------- network ----------
  async function fetchJson(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async function probeServer() {
    try {
      await fetchJson('/api/health', {}, 2500);
      state.reachable = true;
    } catch (_error) {
      state.reachable = false;
    }
    renderNetDot();
    return state.reachable;
  }

  function renderNetDot() {
    const dot = $('#netDot');
    dot.className = `net-dot ${state.reachable ? 'online' : 'offline'}`;
    dot.title = state.reachable ? 'LimoFin reachable' : 'Offline — receipts will queue';
  }

  function renderQueueBadge() {
    const badge = $('#queueBadge');
    const count = state.queue.length;
    badge.hidden = count === 0;
    badge.textContent = `${count} queued`;
  }

  // ---------- IndexedDB queue ----------
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('limofin-m', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbAll() {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readonly');
      const request = tx.objectStore('queue').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbPut(item) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readwrite');
      const request = tx.objectStore('queue').put(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbDelete(id) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readwrite');
      const request = tx.objectStore('queue').delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function refreshQueue() {
    state.queue = await idbAll().catch(() => []);
    renderQueueBadge();
  }

  // ---------- data loads ----------
  async function loadToday({ background = false } = {}) {
    try {
      const data = await fetchJson(`/api/today`);
      state.today = data;
      state.todayAt = new Date().toISOString();
      state.reachable = true;
      localStorage.setItem('limofin.m.today', JSON.stringify({ data, at: state.todayAt }));
    } catch (_error) {
      state.reachable = false;
      if (!state.today) {
        const cached = localStorage.getItem('limofin.m.today');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            state.today = parsed.data;
            state.todayAt = parsed.at;
          } catch (_e) { /* ignore */ }
        }
      }
    }
    renderNetDot();
    if (!background && state.tab === 'today') renderToday();
  }

  async function loadInsights() {
    try {
      state.insights = await fetchJson('/api/insights');
      localStorage.setItem('limofin.m.insights', JSON.stringify({ data: state.insights, at: new Date().toISOString() }));
    } catch (_error) {
      const cached = localStorage.getItem('limofin.m.insights');
      if (cached && !state.insights) {
        try { state.insights = JSON.parse(cached).data; } catch (_e) { /* ignore */ }
      }
    }
    if (state.tab === 'trends') renderTrends();
  }

  async function loadHistory() {
    try {
      state.history = await fetchJson('/api/receipts?status=committed&limit=5');
    } catch (_error) { /* keep old */ }
  }

  // ---------- Today tab ----------
  function paceChip(pace) {
    const labels = { on: 'on pace', cool: 'under pace', hot: 'running hot', over: 'over' };
    return el('span', { class: `pace-tag ${pace}`, text: labels[pace] || pace });
  }

  function renderToday() {
    const view = $('#view');
    view.replaceChildren();
    const data = state.today;

    if (!data) {
      view.append(el('div', { class: 'empty' }, [
        el('div', { text: state.reachable ? 'Loading…' : 'Can’t reach LimoFin' }),
        el('div', { class: 'hint', text: 'Connect to home Wi-Fi and pull to refresh.' })
      ]));
      return;
    }

    if (state.todayAt && !state.reachable) {
      view.append(el('div', { class: 'stale-note', text: `Offline — showing data from ${timeAgo(state.todayAt)}` }));
    }

    if (data.no_plan) {
      view.append(el('div', { class: 'card hero' }, [
        el('div', { class: 'kicker', text: 'No week plan' }),
        el('div', { class: 'big warn', text: '—' }),
        el('div', { class: 'sub', text: 'No plan covers today. Run the /finance weekly review to push this week’s plan.' })
      ]));
    } else {
      const spentRatio = data.totals.allocated_cents > 0 ? data.totals.spent_cents / data.totals.allocated_cents : 0;
      const heroClass = data.totals.remaining_cents < 0 ? 'bad' : (spentRatio > 0.85 && data.days_left > 1 ? 'warn' : 'ok');
      const hero = el('div', { class: 'card hero' }, [
        el('div', { class: 'kicker', text: 'Safe to spend today' }),
        el('div', { class: `big ${heroClass}`, text: money(data.safe_today_cents) }),
        el('div', { class: 'sub', text: `Spent today ${money(data.spent_today_cents)} · ${money(Math.max(0, data.totals.remaining_cents))} left this week` }),
        el('div', { class: 'chip-row' }, [
          el('span', { class: 'chip', text: `Day ${data.day_index + 1} of 7` }),
          data.plan.floor_cents !== null && data.runway_low_cents !== null
            ? el('span', {
              class: `chip ${data.runway_low_cents >= data.plan.floor_cents ? 'ok' : 'bad'}`,
              text: `Floor ${money(data.plan.floor_cents, { compact: true })} · low ${money(data.runway_low_cents, { compact: true })}`
            })
            : null,
          data.steps.total > 0
            ? el('span', { class: 'chip', text: `Checklist ${data.steps.done}/${data.steps.total}` })
            : null
        ])
      ]);
      view.append(hero);

      if (data.plan.verdict) {
        view.append(el('div', { class: 'card', style: 'padding:12px 14px;font-size:13px;color:var(--muted)' }, [
          el('span', { text: data.plan.verdict })
        ]));
      }

      view.append(el('div', { class: 'section-label', text: 'Envelopes' }));
      for (const envelope of data.envelopes) {
        const ratio = envelope.allocated_cents > 0 ? Math.min(1, envelope.spent_cents / envelope.allocated_cents) : 0;
        const fillClass = envelope.remaining_cents < 0 ? 'over' : (envelope.pace === 'hot' ? 'hot' : '');
        view.append(el('div', { class: 'card env-row' }, [
          el('div', { class: 'env-head' }, [
            el('span', { class: 'env-name', text: envelope.name }),
            el('span', {
              class: `env-remaining ${envelope.remaining_cents < 0 ? 'neg' : ''}`,
              text: `${money(envelope.remaining_cents)} left`
            })
          ]),
          el('div', { class: 'bar' }, [
            el('div', { class: `bar-fill ${fillClass}`, style: `width:${Math.round(ratio * 100)}%` })
          ]),
          el('div', { class: 'env-foot' }, [
            el('span', { text: `${money(envelope.spent_cents)} of ${money(envelope.allocated_cents)}` }),
            paceChip(envelope.pace)
          ])
        ]));
      }

      if (data.flags.length) {
        view.append(el('div', { class: 'section-label', text: 'Flags' }));
        const card = el('div', { class: 'card', style: 'padding:6px 0' });
        for (const flag of data.flags) {
          card.append(el('div', { class: `li-row flag-row ${flag.severity}`, text: flag.text }));
        }
        view.append(card);
      }
    }

    const bills = data.upcoming_bills || [];
    if (bills.length) {
      view.append(el('div', { class: 'section-label', text: 'Bills next 7 days' }));
      const card = el('div', { class: 'card', style: 'padding:0;overflow:hidden' });
      for (const bill of bills) {
        const when = bill.in_days === 0 ? 'today' : bill.in_days === 1 ? 'tomorrow' : `in ${bill.in_days} days`;
        card.append(el('div', { class: 'li-row' }, [
          el('span', { class: `dot ${bill.light}` }),
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-title', text: bill.name }),
            el('div', { class: 'li-sub', text: `${when}${bill.autopay ? ' · autopay' : ''}` })
          ]),
          el('span', { class: 'li-amt', text: money(bill.amount_cents) })
        ]));
      }
      view.append(card);
    }

    view.append(el('button', {
      class: 'ghost-btn',
      text: state.reachable ? 'Refresh' : 'Try to reconnect',
      onclick: async () => { await probeServer(); await loadToday(); }
    }));
  }

  // ---------- Scan tab ----------
  function downscaleImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read photo'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not decode photo'));
        img.onload = () => {
          const MAX = 1600;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

          const thumbCanvas = document.createElement('canvas');
          const tScale = 160 / Math.max(canvas.width, canvas.height);
          thumbCanvas.width = Math.round(canvas.width * tScale);
          thumbCanvas.height = Math.round(canvas.height * tScale);
          thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

          resolve({
            base64: dataUrl.split(',')[1],
            thumb: thumbCanvas.toDataURL('image/jpeg', 0.7)
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadReceipt(base64) {
    return fetchJson('/api/receipts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ media_type: 'image/jpeg', image_base64: base64 })
    }, 60000);
  }

  async function handlePhoto(file) {
    let scaled;
    try {
      scaled = await downscaleImage(file);
    } catch (error) {
      toast(error.message);
      return;
    }

    const reachable = await probeServer();
    if (!reachable) {
      await idbPut({
        base64: scaled.base64,
        thumb: scaled.thumb,
        created_at: new Date().toISOString()
      });
      await refreshQueue();
      toast('Offline — receipt queued for home Wi-Fi');
      renderScan();
      return;
    }

    toast('Uploading…');
    try {
      const result = await uploadReceipt(scaled.base64);
      state.review = {
        source: 'live',
        receipt: result.receipt,
        parsed: result.parsed,
        ai: result.ai,
        thumb: scaled.thumb
      };
      renderScan();
    } catch (error) {
      await idbPut({ base64: scaled.base64, thumb: scaled.thumb, created_at: new Date().toISOString() });
      await refreshQueue();
      toast(`Upload failed (${error.message}) — queued instead`);
      renderScan();
    }
  }

  async function syncQueueItem(item) {
    const result = await uploadReceipt(item.base64);
    const updated = { ...item, receipt_id: result.receipt.id, parsed: result.parsed, ai: result.ai };
    await idbPut(updated);
    return updated;
  }

  function centsToInput(cents) {
    return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2);
  }

  function renderReviewCard(container) {
    const review = state.review;
    const parsed = review.parsed || {};
    const envelopes = (state.today && !state.today.no_plan) ? state.today.envelopes : [];

    const amountInput = el('input', {
      type: 'text', inputmode: 'decimal', placeholder: '0.00',
      value: centsToInput(parsed.total_cents)
    });
    const dateInput = el('input', { type: 'date', value: parsed.date || localToday() });
    const memoInput = el('input', { type: 'text', placeholder: 'Memo', value: parsed.merchant || '', maxlength: '200' });

    const envelopeSelect = el('select', {}, [
      el('option', { value: '', text: envelopes.length ? 'No envelope (ledger only)' : 'No plan this week (ledger only)' }),
      ...envelopes.map((envelope) => el('option', {
        value: String(envelope.id),
        text: `${envelope.name} · ${money(envelope.remaining_cents)} left`,
        selected: parsed.envelope === envelope.name ? '' : null
      }))
    ]);

    const categorySelect = el('select', {}, [
      el('option', { value: '', text: 'Category (optional)' }),
      ...CATEGORIES.map((category) => el('option', {
        value: category,
        text: category,
        selected: parsed.category === category ? '' : null
      }))
    ]);

    const aiLabel = review.ai === 'ok'
      ? `AI parsed${parsed.confidence !== null && parsed.confidence !== undefined ? ` · ${Math.round(parsed.confidence * 100)}%` : ''}`
      : review.ai === 'unconfigured' ? 'AI off — manual entry' : 'AI failed — manual entry';

    const commitBtn = el('button', { class: 'btn primary', text: 'Log it' });
    const dismissBtn = el('button', { class: 'btn danger-ghost', text: 'Dismiss' });

    commitBtn.addEventListener('click', async () => {
      const amount = Math.round(parseFloat(amountInput.value.replace(/[$,\s]/g, '')) * 100);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        toast('Enter a valid amount');
        return;
      }
      commitBtn.disabled = true;
      try {
        const payload = {
          amount_cents: amount,
          date: dateInput.value || undefined,
          memo: memoInput.value || undefined,
          category: categorySelect.value || undefined
        };
        if (envelopeSelect.value) payload.envelope_id = Number(envelopeSelect.value);
        const result = await fetchJson(`/api/receipts/${review.receipt.id}/commit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const target = result.envelope ? result.envelope.name : 'ledger';
        toast(`Logged ${money(amount)} → ${target}`);
        if (review.source === 'queue') await idbDelete(review.queueId);
        state.review = null;
        await Promise.all([refreshQueue(), loadToday({ background: true }), loadHistory()]);
        renderScan();
      } catch (error) {
        toast(error.message);
        commitBtn.disabled = false;
      }
    });

    dismissBtn.addEventListener('click', async () => {
      try {
        await fetchJson(`/api/receipts/${review.receipt.id}/dismiss`, { method: 'POST' });
      } catch (_error) { /* dismissing a ghost is fine */ }
      if (review.source === 'queue') await idbDelete(review.queueId);
      state.review = null;
      await refreshQueue();
      toast('Dismissed');
      renderScan();
    });

    const thumb = review.thumb || (review.receipt ? review.receipt.image_url : null);
    container.append(el('div', { class: 'card review-card' }, [
      el('div', { class: 'review-head' }, [
        thumb ? el('img', { class: 'receipt-thumb', src: thumb, alt: 'Receipt' }) : null,
        el('div', {}, [
          el('div', { style: 'font-weight:700;font-size:15px', text: parsed.merchant || 'Receipt' }),
          el('div', { style: 'margin-top:4px' }, [
            el('span', { class: `ai-badge ${review.ai === 'ok' ? 'ok' : 'warn'}`, text: aiLabel })
          ])
        ])
      ]),
      el('div', { class: 'field-grid' }, [
        el('div', { class: 'field' }, [el('label', { text: 'Amount' }), amountInput]),
        el('div', { class: 'field' }, [el('label', { text: 'Date' }), dateInput])
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'Envelope' }), envelopeSelect]),
      el('div', { class: 'field-grid' }, [
        el('div', { class: 'field' }, [el('label', { text: 'Category' }), categorySelect]),
        el('div', { class: 'field' }, [el('label', { text: 'Memo' }), memoInput])
      ]),
      el('div', { class: 'btn-row' }, [dismissBtn, commitBtn])
    ]));
  }

  function renderScan() {
    const view = $('#view');
    view.replaceChildren();

    if (state.review) {
      view.append(el('div', { class: 'section-label', text: 'Confirm receipt' }));
      renderReviewCard(view);
      return;
    }

    view.append(el('button', {
      class: 'snap-btn',
      onclick: () => $('#cameraInput').click()
    }, [
      el('span', { class: 'cam', text: '📸' }),
      el('span', { text: 'Snap a receipt' })
    ]));
    view.append(el('div', {
      class: 'scan-note',
      text: state.reachable
        ? 'Parsed by AI, you confirm before anything is logged.'
        : 'Offline — receipts queue and sync on home Wi-Fi.'
    }));

    if (state.queue.length) {
      view.append(el('div', { class: 'section-label', text: `Queued (${state.queue.length})` }));
      const card = el('div', { class: 'card', style: 'padding:0;overflow:hidden' });
      for (const item of state.queue) {
        const uploaded = Boolean(item.receipt_id);
        const row = el('div', { class: 'li-row' }, [
          el('img', { class: 'queue-thumb', src: item.thumb, alt: 'Queued receipt' }),
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-title', text: uploaded ? ((item.parsed && item.parsed.merchant) || 'Ready to review') : 'Waiting for Wi-Fi' }),
            el('div', { class: 'li-sub', text: timeAgo(item.created_at) })
          ]),
          el('button', {
            class: 'btn', style: 'flex:none;padding:8px 14px;font-size:13px',
            text: uploaded ? 'Review' : 'Sync',
            onclick: async () => {
              if (!(await probeServer())) { toast('Still offline'); return; }
              try {
                const ready = uploaded ? item : await syncQueueItem(item);
                const receipt = ready.receipt_id ? { id: ready.receipt_id, image_url: `/api/receipts/${ready.receipt_id}/image` } : null;
                state.review = {
                  source: 'queue', queueId: ready.id, receipt,
                  parsed: ready.parsed, ai: ready.ai, thumb: ready.thumb
                };
                await loadToday({ background: true });
                renderScan();
              } catch (error) {
                toast(error.message);
              }
            }
          })
        ]);
        card.append(row);
      }
      view.append(card);
      if (state.reachable && state.queue.some((item) => !item.receipt_id)) {
        view.append(el('button', {
          class: 'ghost-btn', text: 'Sync all queued',
          onclick: async () => {
            for (const item of state.queue.filter((entry) => !entry.receipt_id)) {
              try { await syncQueueItem(item); } catch (_error) { break; }
            }
            await refreshQueue();
            toast('Synced — tap Review on each');
            renderScan();
          }
        }));
      }
    }

    if (state.history.length) {
      view.append(el('div', { class: 'section-label', text: 'Recent' }));
      const card = el('div', { class: 'card', style: 'padding:0;overflow:hidden' });
      for (const receipt of state.history) {
        card.append(el('div', { class: 'li-row' }, [
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-title', text: receipt.merchant || 'Receipt' }),
            el('div', { class: 'li-sub', text: receipt.purchase_date || (receipt.created_at || '').slice(0, 10) })
          ]),
          el('span', { class: 'li-amt', text: money(receipt.total_cents) })
        ]));
      }
      view.append(card);
    }
  }

  // ---------- Trends tab ----------
  function sparkBars(daily, width = 320, height = 64) {
    const max = Math.max(1, ...daily.map((day) => day.spent_cents));
    const gap = 2;
    const barWidth = (width - gap * (daily.length - 1)) / daily.length;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'spark');
    daily.forEach((day, index) => {
      const h = Math.max(2, Math.round((day.spent_cents / max) * (height - 4)));
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(index * (barWidth + gap)));
      rect.setAttribute('y', String(height - h));
      rect.setAttribute('width', String(barWidth));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx', '1.5');
      rect.setAttribute('fill', day.spent_cents === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(56,189,248,0.85)');
      svg.append(rect);
    });
    return svg;
  }

  function renderTrends() {
    const view = $('#view');
    view.replaceChildren();
    const data = state.insights;

    if (!data) {
      view.append(el('div', { class: 'empty' }, [
        el('div', { text: state.reachable ? 'Loading…' : 'Offline — no cached trends yet' })
      ]));
      return;
    }

    view.append(el('div', { class: 'trend-summary' }, [
      el('div', { class: 'card stat' }, [
        el('div', { class: 'n', text: money(data.avg_daily_cents, { compact: true }) }),
        el('div', { class: 'l', text: 'avg / day' })
      ]),
      el('div', { class: 'card stat' }, [
        el('div', { class: 'n', text: String(data.no_spend_days) }),
        el('div', { class: 'l', text: 'no-spend days' })
      ]),
      el('div', { class: 'card stat' }, [
        el('div', { class: 'n', text: money(data.window_total_cents, { compact: true }) }),
        el('div', { class: 'l', text: '28-day total' })
      ])
    ]));

    view.append(el('div', { class: 'section-label', text: 'Daily burn — last 28 days' }));
    view.append(el('div', { class: 'card' }, [sparkBars(data.daily)]));

    if (data.weeks.length) {
      view.append(el('div', { class: 'section-label', text: 'Weeks — spent vs allocated' }));
      const card = el('div', { class: 'card', style: 'padding:8px 0' });
      const maxAlloc = Math.max(1, ...data.weeks.map((week) => Math.max(week.allocated_cents, week.spent_cents)));
      for (const week of data.weeks.slice(-6)) {
        const allocPct = Math.round((week.allocated_cents / maxAlloc) * 100);
        const spentPct = Math.round((week.spent_cents / maxAlloc) * 100);
        card.append(el('div', { class: 'week-row' }, [
          el('span', { class: 'week-label', text: week.week_start.slice(5) }),
          el('div', { class: 'week-bars' }, [
            el('div', { class: 'wbar alloc', style: `width:${allocPct}%` }),
            el('div', { class: `wbar spent ${week.spent_cents > week.allocated_cents ? 'over' : ''}`, style: `width:${Math.max(1, spentPct)}%` })
          ]),
          el('span', { class: 'week-pct', text: week.adherence_pct === null ? '–' : `${week.adherence_pct}%` })
        ]));
      }
      view.append(card);
    }

    const activeWeekdays = data.weekday_avg.filter((day) => day.avg_cents > 0);
    if (activeWeekdays.length) {
      const heaviest = data.weekday_avg.reduce((best, day) => (day.avg_cents > best.avg_cents ? day : best));
      view.append(el('div', { class: 'section-label', text: 'Weekday pattern' }));
      const maxAvg = Math.max(1, ...data.weekday_avg.map((day) => day.avg_cents));
      const card = el('div', { class: 'card', style: 'padding:8px 0' });
      for (const day of data.weekday_avg) {
        card.append(el('div', { class: 'week-row' }, [
          el('span', { class: 'week-label', text: DOW[day.dow] }),
          el('div', { class: 'week-bars' }, [
            el('div', { class: 'wbar spent', style: `width:${Math.max(1, Math.round((day.avg_cents / maxAvg) * 100))}%` })
          ]),
          el('span', { class: 'week-pct', text: money(day.avg_cents, { compact: true }) })
        ]));
      }
      card.append(el('div', { class: 'li-row li-sub', style: 'border:none', text: `${DOW[heaviest.dow]} is your heaviest day.` }));
      view.append(card);
    }

    if (data.top_memos.length) {
      view.append(el('div', { class: 'section-label', text: 'Where it went (28d)' }));
      const card = el('div', { class: 'card', style: 'padding:0;overflow:hidden' });
      for (const memo of data.top_memos) {
        card.append(el('div', { class: 'li-row' }, [
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-title', text: memo.label }),
            el('div', { class: 'li-sub', text: `${memo.count}×` })
          ]),
          el('span', { class: 'li-amt', text: money(memo.total_cents) })
        ]));
      }
      view.append(card);
    }

    if (data.month_categories.length) {
      view.append(el('div', { class: 'section-label', text: `Ledger — ${data.month}` }));
      const card = el('div', { class: 'card', style: 'padding:0;overflow:hidden' });
      for (const row of data.month_categories) {
        card.append(el('div', { class: 'li-row' }, [
          el('div', { class: 'li-main' }, [el('div', { class: 'li-title', text: row.category })]),
          el('span', { class: 'li-amt', text: money(row.total_cents) })
        ]));
      }
      card.append(el('div', { class: 'li-row' }, [
        el('div', { class: 'li-main' }, [el('div', { class: 'li-title', text: 'Total' })]),
        el('span', { class: 'li-amt', text: money(data.month_total_cents) })
      ]));
      view.append(card);
    }
  }

  // ---------- tabs + boot ----------
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === tab);
    });
    if (tab === 'today') renderToday();
    if (tab === 'scan') { renderScan(); loadHistory().then(() => state.tab === 'scan' && renderScan()); }
    if (tab === 'trends') { renderTrends(); loadInsights(); }
  }

  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });

  $('#cameraInput').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (file) handlePhoto(file);
  });

  window.addEventListener('online', async () => {
    if (await probeServer()) {
      loadToday({ background: state.tab !== 'today' });
      if (state.queue.length) toast(`Back online — ${state.queue.length} receipt(s) ready to sync`);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      probeServer().then((reachable) => {
        if (reachable) loadToday({ background: state.tab !== 'today' });
      });
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/m/sw.js').catch(() => { /* non-fatal */ });
  }

  (async () => {
    const cached = localStorage.getItem('limofin.m.today');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        state.today = parsed.data;
        state.todayAt = parsed.at;
      } catch (_error) { /* ignore */ }
    }
    renderToday();
    await refreshQueue();
    await probeServer();
    await loadToday();
    loadHistory();
  })();
})();
