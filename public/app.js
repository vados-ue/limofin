const state = {
  month: '',
  view: 'dashboard',
  cashflow: null,
  bills: [],
  plan: null,
  planLoaded: false,
  charts: {
    bills: null,
    delta: null
  }
};

const monthPicker = document.querySelector('#monthPicker');
const billsTableBody = document.querySelector('#billsTableBody');
const toastRoot = document.querySelector('#toastRoot');

function formatCurrency(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format((cents || 0) / 100);
}

function monthOffset(baseMonth, offset) {
  const date = new Date(`${baseMonth}-01T00:00:00`);
  date.setMonth(date.getMonth() + offset);
  return date.toISOString().slice(0, 7);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function isoDateLocal(date = new Date()) {
  // Browser-local calendar day (NOT toISOString, which is UTC and rolls to
  // tomorrow every evening for anyone west of Greenwich).
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastRoot.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function renderHero() {
  const cashflow = state.cashflow;
  document.querySelector('#deltaValue').textContent = formatCurrency(cashflow.delta_cents);
  document.querySelector('#coverageValue').textContent = `${cashflow.coverage_pct}%`;
  document.querySelector('#incomeTotal').textContent = formatCurrency(cashflow.income_total_cents);
  document.querySelector('#billsTotal').textContent = formatCurrency(cashflow.bills_total_cents);
}

function statusMeta(light) {
  if (light === 'green') {
    return { label: 'Funded', className: 'status-green' };
  }
  if (light === 'yellow') {
    return { label: 'Planned', className: 'status-yellow' };
  }
  return { label: 'Unfunded', className: 'status-red' };
}

function renderBillsTable() {
  const rows = state.cashflow.bills;
  if (!rows.length) {
    billsTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">No bills for this month yet.</td></tr>`;
    return;
  }

  billsTableBody.innerHTML = rows.map((bill) => {
    const status = statusMeta(bill.light);
    const sourceName = bill.earmark?.source_name || 'No earmark';
    return `
      <tr>
        <td>${escapeHtml(bill.name)}</td>
        <td>${bill.due_date}</td>
        <td>${formatCurrency(bill.amount_cents)}</td>
        <td class="source-copy">${escapeHtml(sourceName)}</td>
        <td><span class="status-pill ${status.className}">${status.label}</span></td>
      </tr>
    `;
  }).join('');
}

async function renderBillsChart() {
  const categories = {};
  for (const bill of state.bills) {
    categories[bill.category || 'other'] = (categories[bill.category || 'other'] || 0) + bill.amount_cents;
  }

  const labels = Object.keys(categories);
  const values = Object.values(categories);
  const canvas = document.querySelector('#billsChart');

  if (state.charts.bills) {
    state.charts.bills.destroy();
  }

  state.charts.bills = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: labels.length ? labels : ['No bills'],
      datasets: [{
        data: values.length ? values : [1],
        backgroundColor: ['#22c55e', '#0ea5e9', '#eab308', '#f97316', '#ef4444', '#6366f1']
      }]
    },
    options: {
      plugins: {
        legend: { labels: { color: '#f3f4f6' } }
      }
    }
  });
}

async function renderDeltaChart() {
  const months = Array.from({ length: 6 }, (_, index) => monthOffset(state.month, index - 5));
  const series = await Promise.all(months.map((month) => api(`/api/cashflow/${month}`)));
  const canvas = document.querySelector('#deltaChart');

  if (state.charts.delta) {
    state.charts.delta.destroy();
  }

  state.charts.delta = new Chart(canvas, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'Delta',
        data: series.map((entry) => entry.delta_cents / 100),
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.18)',
        tension: 0.28,
        fill: true
      }]
    },
    options: {
      scales: {
        x: {
          ticks: { color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.06)' }
        },
        y: {
          ticks: { color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.06)' }
        }
      },
      plugins: {
        legend: { labels: { color: '#f3f4f6' } }
      }
    }
  });
}

async function loadDashboard(month) {
  state.month = month;
  const [cashflow, bills] = await Promise.all([
    api(`/api/cashflow/${month}`),
    api('/api/bills')
  ]);

  state.cashflow = cashflow;
  state.bills = bills;

  renderHero();
  renderBillsTable();
  await renderBillsChart();
  await renderDeltaChart();
}

async function fetchCurrentPlan() {
  // Pass the browser's local date explicitly so "current" matches the user's
  // day even when the server host runs in a different time zone.
  const response = await fetch(`/api/plans/current?date=${isoDateLocal()}`);
  if (response.status === 404) {
    return null;
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function loadPlanView() {
  state.plan = await fetchCurrentPlan();
  state.planLoaded = true;
  renderPlanView();
}

function envelopeStatusMeta(envelope) {
  if (envelope.remaining_cents < 0) {
    return { label: 'Over', className: 'status-red' };
  }
  if (envelope.allocated_cents > 0 && envelope.spent_cents / envelope.allocated_cents >= 0.8) {
    return { label: 'Tight', className: 'status-yellow' };
  }
  return { label: 'On track', className: 'status-green' };
}

function renderPlanView() {
  const plan = state.plan;
  const hasPlan = Boolean(plan);

  document.querySelector('#planEmpty').hidden = hasPlan;
  document.querySelector('#planEnvelopesCard').hidden = !hasPlan;
  document.querySelector('#planStepsCard').hidden = !hasPlan;
  document.querySelector('#planSpendsCard').hidden = !hasPlan;

  if (!hasPlan) {
    return;
  }

  const weekLabel = plan.title || `Week of ${plan.week_start}`;
  document.querySelector('#planWeekLabel').textContent = weekLabel;
  document.querySelector('#stepsProgress').textContent =
    `${plan.totals.steps_done} of ${plan.totals.steps_total} done`;

  const stepsList = document.querySelector('#planStepsList');
  if (!plan.steps.length) {
    stepsList.innerHTML = '<li class="empty-state">No steps in this plan.</li>';
  } else {
    stepsList.innerHTML = plan.steps.map((step) => `
      <li class="${step.done ? 'step-done' : ''}">
        <label>
          <input type="checkbox" data-step-id="${step.id}" ${step.done ? 'checked' : ''}>
          <span>${escapeHtml(step.label)}</span>
        </label>
      </li>
    `).join('');
  }

  const envelopesBody = document.querySelector('#envelopesTableBody');
  if (!plan.envelopes.length) {
    envelopesBody.innerHTML = '<tr><td colspan="6" class="empty-state">No envelopes in this plan.</td></tr>';
  } else {
    envelopesBody.innerHTML = plan.envelopes.map((envelope) => {
      const status = envelopeStatusMeta(envelope);
      const remainingClass = envelope.remaining_cents < 0 ? 'amount-negative' : '';
      return `
        <tr>
          <td>${escapeHtml(envelope.name)}</td>
          <td>${formatCurrency(envelope.allocated_cents)}</td>
          <td>${formatCurrency(envelope.spent_cents)}</td>
          <td class="${remainingClass}">${formatCurrency(envelope.remaining_cents)}</td>
          <td><span class="status-pill ${status.className}">${status.label}</span></td>
          <td><button type="button" class="ghost-button table-button" data-spend-envelope="${envelope.id}" data-envelope-name="${escapeHtml(envelope.name)}">Spend</button></td>
        </tr>
      `;
    }).join('');
  }

  document.querySelector('#planTotals').textContent =
    `Allocated ${formatCurrency(plan.totals.allocated_cents)}, spent ${formatCurrency(plan.totals.spent_cents)}, remaining ${formatCurrency(plan.totals.remaining_cents)}.`;

  const spendRows = plan.envelopes.flatMap((envelope) =>
    envelope.spends.map((spend) => ({ ...spend, envelope_name: envelope.name })));
  spendRows.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id - b.id);

  const spendsBody = document.querySelector('#spendsTableBody');
  if (!spendRows.length) {
    spendsBody.innerHTML = '<tr><td colspan="5" class="empty-state">Nothing spent yet this week.</td></tr>';
  } else {
    spendsBody.innerHTML = spendRows.map((spend) => `
      <tr>
        <td>${escapeHtml(spend.date || '')}</td>
        <td>${escapeHtml(spend.envelope_name)}</td>
        <td class="source-copy">${escapeHtml(spend.memo || '')}</td>
        <td>${formatCurrency(spend.amount_cents)}</td>
        <td><button type="button" class="ghost-button table-button" data-delete-spend="${spend.id}">Delete</button></td>
      </tr>
    `).join('');
  }
}

function switchView(view) {
  state.view = view;
  document.querySelector('#view-dashboard').hidden = view !== 'dashboard';
  document.querySelector('#view-plan').hidden = view !== 'plan';
  document.querySelector('.month-control').hidden = view !== 'dashboard';

  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('action-button', active);
    button.classList.toggle('ghost-button', !active);
  });

  if (view === 'plan') {
    loadPlanView().catch((error) => showToast(error.message));
  } else if (view === 'dashboard' && !state.cashflow) {
    loadDashboard(monthPicker.value).catch((error) => showToast(error.message));
  }
}

function parsePlanForm(form) {
  const raw = Object.fromEntries(new FormData(form).entries());
  const steps = (raw.steps_lines || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label) => ({ label }));

  const envelopes = (raw.envelope_lines || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const splitAt = line.lastIndexOf(':');
      const name = (splitAt >= 0 ? line.slice(0, splitAt) : line).trim();
      const dollars = splitAt >= 0 ? Number(line.slice(splitAt + 1).trim()) : 0;
      if (!name || Number.isNaN(dollars)) {
        throw new Error(`Could not read envelope line: ${line}`);
      }
      return { name, allocated_cents: Math.round(dollars * 100) };
    });

  return {
    week_start: raw.week_start,
    title: raw.title || null,
    steps,
    envelopes
  };
}

function wirePlanView() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  const planView = document.querySelector('#view-plan');

  planView.addEventListener('change', async (event) => {
    const checkbox = event.target.closest('input[data-step-id]');
    if (!checkbox) {
      return;
    }
    try {
      await api(`/api/steps/${checkbox.dataset.stepId}`, {
        method: 'PATCH',
        body: JSON.stringify({ done: checkbox.checked ? 1 : 0 })
      });
      await loadPlanView();
    } catch (error) {
      // Revert the optimistic flip so the checkbox matches the database.
      checkbox.checked = !checkbox.checked;
      showToast(error.message);
    }
  });

  planView.addEventListener('click', async (event) => {
    const spendButton = event.target.closest('[data-spend-envelope]');
    if (spendButton) {
      const form = document.querySelector('#spendForm');
      form.reset();
      form.elements.envelope_id.value = spendButton.dataset.spendEnvelope;
      form.elements.date.value = isoDateLocal();
      document.querySelector('#spendModalTitle').textContent = `Add Spend: ${spendButton.dataset.envelopeName}`;
      document.querySelector('#spendModal').showModal();
      return;
    }

    const deleteButton = event.target.closest('[data-delete-spend]');
    if (deleteButton) {
      try {
        await api(`/api/spends/${deleteButton.dataset.deleteSpend}`, { method: 'DELETE' });
        showToast('Spend deleted');
        await loadPlanView();
      } catch (error) {
        showToast(error.message);
      }
    }
  });

  document.querySelector('#planForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      const payload = parsePlanForm(form);
      const created = await api('/api/plans', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      form.reset();
      form.closest('dialog').close();
      await loadPlanView();
      // The view only ever shows the plan covering today, so make it clear
      // when the new plan saved but is not the one on screen.
      const isDisplayed = state.plan && state.plan.id === created.id;
      showToast(isDisplayed
        ? 'Plan created'
        : `Plan saved for week of ${created.week_start} (not the current week)`);
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelector('#spendForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      const payload = {
        amount_cents: Math.round(Number(form.elements.amount_dollars.value) * 100),
        memo: form.elements.memo.value || null,
        date: form.elements.date.value || null
      };
      await api(`/api/envelopes/${form.elements.envelope_id.value}/spends`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      form.reset();
      form.closest('dialog').close();
      showToast('Spend saved');
      await loadPlanView();
    } catch (error) {
      showToast(error.message);
    }
  });
}

function formToPayload(form) {
  const raw = Object.fromEntries(new FormData(form).entries());
  const payload = { ...raw };

  if (payload.amount_dollars !== undefined) {
    payload.amount_cents = Math.round(Number(payload.amount_dollars) * 100);
    delete payload.amount_dollars;
  }

  if (payload.limit_dollars !== undefined) {
    payload.limit_cents = Math.round(Number(payload.limit_dollars) * 100);
    delete payload.limit_dollars;
  }

  if (payload.due_day_of_month !== undefined) {
    payload.due_day_of_month = Number(payload.due_day_of_month);
  }

  if (payload.amount_cents !== undefined) {
    payload.amount_cents = Number(payload.amount_cents);
  }

  return payload;
}

function wireModals() {
  document.querySelectorAll('[data-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector(`#${button.dataset.modal}`).showModal();
    });
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => {
      button.closest('dialog').close();
    });
  });

  document.querySelectorAll('.modal-form[data-endpoint]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      try {
        const payload = formToPayload(form);
        await api(form.dataset.endpoint, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        form.reset();
        form.closest('dialog').close();
        showToast('Saved successfully');
        await loadDashboard(state.month);
      } catch (error) {
        showToast(error.message);
      }
    });
  });
}

function defaultMonth() {
  return isoDateLocal().slice(0, 7);
}

async function init() {
  monthPicker.value = defaultMonth();
  wireModals();
  wirePlanView();

  monthPicker.addEventListener('change', async (event) => {
    try {
      await loadDashboard(event.target.value);
    } catch (error) {
      showToast(error.message);
    }
  });

  // Land on the Week Plan view when a plan covers today; Dashboard otherwise.
  let landingView = 'dashboard';
  try {
    const plan = await fetchCurrentPlan();
    if (plan) {
      state.plan = plan;
      state.planLoaded = true;
      landingView = 'plan';
    }
  } catch (_error) {
    // Fall back to the dashboard if the check fails.
  }
  switchView(landingView);
}

init();
