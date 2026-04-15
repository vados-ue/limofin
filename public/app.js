const state = {
  month: '',
  cashflow: null,
  bills: [],
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
        <td>${bill.name}</td>
        <td>${bill.due_date}</td>
        <td>${formatCurrency(bill.amount_cents)}</td>
        <td class="source-copy">${sourceName}</td>
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

  document.querySelectorAll('.modal-form').forEach((form) => {
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
  return new Date().toISOString().slice(0, 7);
}

async function init() {
  monthPicker.value = defaultMonth();
  wireModals();

  monthPicker.addEventListener('change', async (event) => {
    try {
      await loadDashboard(event.target.value);
    } catch (error) {
      showToast(error.message);
    }
  });

  try {
    await loadDashboard(monthPicker.value);
  } catch (error) {
    showToast(error.message);
  }
}

init();
