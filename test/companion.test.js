const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp, sanitizeParsedReceipt } = require('../server');

function buildApp(testName, extraOptions = {}) {
  const stamp = `${process.pid}-${Date.now()}-${testName}`;
  const dbPath = path.join(os.tmpdir(), `limofin-${stamp}.db`);
  const receiptsDir = path.join(os.tmpdir(), `limofin-receipts-${stamp}`);
  const app = createApp({ dbPath, skipSeed: true, receiptsDir, ...extraOptions });
  return { app, dbPath, receiptsDir };
}

function cleanup(app, dbPath, receiptsDir) {
  app.locals.db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  fs.rmSync(receiptsDir, { recursive: true, force: true });
}

// Monday-start week; queries pin the date so results never depend on wall time.
const PLAN_PAYLOAD = {
  week_start: '2026-07-13',
  title: 'Week of Jul 13',
  verdict: 'Tight but fine',
  floor_cents: 150000,
  envelopes: [
    { name: 'Groceries', allocated_cents: 22000 },
    { name: 'Gas', allocated_cents: 6000 }
  ],
  steps: [{ label: 'Pay Amex', done: 1 }, { label: 'Move to savings' }],
  runway: [
    { label: 'Wed', amount_cents: 210000 },
    { label: 'Fri', amount_cents: 165000 }
  ],
  flags: [{ severity: 'warn', text: 'HELOC hits Friday' }]
};

const FAKE_IMAGE_BASE64 = Buffer.from('not-really-a-jpeg-but-bytes-nonetheless').toString('base64');

async function createPlanWithSpend(app) {
  const plan = await request(app).post('/api/plans').send(PLAN_PAYLOAD).expect(201);
  const groceries = plan.body.envelopes.find((envelope) => envelope.name === 'Groceries');
  await request(app)
    .post(`/api/envelopes/${groceries.id}/spends`)
    .send({ amount_cents: 5000, memo: 'Publix', date: '2026-07-15' })
    .expect(201);
  return plan.body;
}

test('GET /api/today returns no_plan when nothing covers the date', async (t) => {
  const { app, dbPath, receiptsDir } = buildApp('today-noplan');
  t.after(() => cleanup(app, dbPath, receiptsDir));

  const response = await request(app).get('/api/today?date=2026-07-15').expect(200);
  assert.equal(response.body.no_plan, true);
  assert.equal(response.body.plan, null);
  assert.ok(Array.isArray(response.body.upcoming_bills));
});

test('GET /api/today computes safe-to-spend, pace, and spent-today', async (t) => {
  const { app, dbPath, receiptsDir } = buildApp('today-math');
  t.after(() => cleanup(app, dbPath, receiptsDir));

  await createPlanWithSpend(app);

  const response = await request(app).get('/api/today?date=2026-07-15').expect(200);
  const body = response.body;
  assert.equal(body.no_plan, false);
  assert.equal(body.day_index, 2);
  assert.equal(body.days_left, 5);
  // 28000 allocated - 5000 spent = 23000 remaining over 5 days.
  assert.equal(body.totals.remaining_cents, 23000);
  assert.equal(body.safe_today_cents, 4600);
  assert.equal(body.spent_today_cents, 5000);
  assert.equal(body.plan.floor_cents, 150000);
  assert.equal(body.runway_low_cents, 165000);
  assert.equal(body.steps.done, 1);

  const groceries = body.envelopes.find((envelope) => envelope.name === 'Groceries');
  assert.equal(groceries.spent_today_cents, 5000);
  assert.equal(groceries.remaining_cents, 17000);
  assert.ok(['on', 'hot', 'cool', 'over'].includes(groceries.pace));
});

test('GET /api/today lists upcoming bills within 7 days with earmark lights', async (t) => {
  const { app, dbPath, receiptsDir } = buildApp('today-bills');
  t.after(() => cleanup(app, dbPath, receiptsDir));

  const soon = await request(app).post('/api/bills')
    .send({ name: 'HELOC', amount_cents: 120000, due_day_of_month: 20, category: 'loan' })
    .expect(201);
  await request(app).post('/api/bills')
    .send({ name: 'Mortgage', amount_cents: 210000, due_day_of_month: 1, category: 'mortgage' })
    .expect(201);
  await request(app).post('/api/earmarks')
    .send({ month: '2026-07', bill_id: soon.body.id, amount_cents: 120000, status: 'funded' })
    .expect(201);

  const response = await request(app).get('/api/today?date=2026-07-15').expect(200);
  const bills = response.body.upcoming_bills;
  assert.equal(bills.length, 1);
  assert.equal(bills[0].name, 'HELOC');
  assert.equal(bills[0].due_date, '2026-07-20');
  assert.equal(bills[0].in_days, 5);
  assert.equal(bills[0].light, 'green');
});

test('GET /api/insights aggregates daily burn, weeks, memos, and month ledger', async (t) => {
  const { app, dbPath, receiptsDir } = buildApp('insights');
  t.after(() => cleanup(app, dbPath, receiptsDir));

  await createPlanWithSpend(app);
  await request(app).post('/api/expenses')
    .send({ date: '2026-07-14', amount_cents: 3200, category: 'dining', description: 'Culvers' })
    .expect(201);

  const response = await request(app).get('/api/insights?date=2026-07-15').expect(200);
  const body = response.body;
  assert.equal(body.daily.length, 28);
  assert.equal(body.daily[27].date, '2026-07-15');
  assert.equal(body.daily[27].spent_cents, 5000);
  assert.equal(body.window_total_cents, 5000);
  assert.equal(body.no_spend_days, 27);
  assert.equal(body.weeks.length, 1);
  assert.equal(body.weeks[0].allocated_cents, 28000);
  assert.equal(body.weeks[0].adherence_pct, 18);
  assert.equal(body.top_memos[0].label, 'Publix');
  assert.equal(body.month, '2026-07');
  const dining = body.month_categories.find((row) => row.category === 'dining');
  assert.equal(dining.total_cents, 3200);
});

test('POST /api/receipts stores the image and reports ai unconfigured without a key', async (t) => {
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
  const { app, dbPath, receiptsDir } = buildApp('receipts-store');
  t.after(() => cleanup(app, dbPath, receiptsDir));

  const response = await request(app).post('/api/receipts')
    .send({ media_type: 'image/jpeg', image_base64: `data:image/jpeg;base64,${FAKE_IMAGE_BASE64}` })
    .expect(201);
  assert.equal(response.body.ai, 'unconfigured');
  assert.equal(response.body.receipt.status, 'pending');

  const files = fs.readdirSync(receiptsDir);
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('.jpg'));

  const image = await request(app).get(response.body.receipt.image_url).expect(200);
  assert.equal(image.body.toString(), 'not-really-a-jpeg-but-bytes-nonetheless');

  await request(app).post('/api/receipts')
    .send({ media_type: 'text/html', image_base64: FAKE_IMAGE_BASE64 })
    .expect(400);
});

test('POST /api/receipts/:id/commit writes spend + expense and locks the receipt', async (t) => {
  const { app, dbPath, receiptsDir } = buildApp('receipts-commit');
  t.after(() => cleanup(app, dbPath, receiptsDir));

  const plan = await createPlanWithSpend(app);
  const gas = plan.envelopes.find((envelope) => envelope.name === 'Gas');

  const created = await request(app).post('/api/receipts')
    .send({ media_type: 'image/jpeg', image_base64: FAKE_IMAGE_BASE64 })
    .expect(201);
  const receiptId = created.body.receipt.id;

  await request(app).post(`/api/receipts/${receiptId}/commit`)
    .send({ amount_cents: 0 })
    .expect(400);
  await request(app).post(`/api/receipts/${receiptId}/commit`)
    .send({ amount_cents: 2500, envelope_id: 999999 })
    .expect(400);

  const committed = await request(app).post(`/api/receipts/${receiptId}/commit`)
    .send({ amount_cents: 2500, envelope_id: gas.id, memo: 'Wawa', date: '2026-07-15', category: 'gas' })
    .expect(201);
  assert.equal(committed.body.receipt.status, 'committed');
  assert.equal(committed.body.receipt.total_cents, 2500);
  assert.equal(committed.body.receipt.merchant, 'Wawa');
  assert.equal(committed.body.receipt.purchase_date, '2026-07-15');
  assert.equal(committed.body.spend.amount_cents, 2500);
  assert.equal(committed.body.envelope.remaining_cents, 3500);
  assert.equal(committed.body.expense.category, 'gas');
  assert.equal(committed.body.expense.source, 'import');
  assert.equal(committed.body.expense.description, 'Wawa');

  // Locked: no double-commit, no dismiss after commit.
  await request(app).post(`/api/receipts/${receiptId}/commit`)
    .send({ amount_cents: 2500 })
    .expect(409);
  await request(app).post(`/api/receipts/${receiptId}/dismiss`).expect(409);

  const today = await request(app).get('/api/today?date=2026-07-15').expect(200);
  assert.equal(today.body.spent_today_cents, 7500);
});

test('POST /api/receipts/:id/dismiss retires a pending receipt', async (t) => {
  const { app, dbPath, receiptsDir } = buildApp('receipts-dismiss');
  t.after(() => cleanup(app, dbPath, receiptsDir));

  const created = await request(app).post('/api/receipts')
    .send({ media_type: 'image/png', image_base64: FAKE_IMAGE_BASE64 })
    .expect(201);
  const receiptId = created.body.receipt.id;

  const dismissed = await request(app).post(`/api/receipts/${receiptId}/dismiss`).expect(200);
  assert.equal(dismissed.body.receipt.status, 'dismissed');

  const pending = await request(app).get('/api/receipts?status=pending').expect(200);
  assert.equal(pending.body.length, 0);
  const all = await request(app).get('/api/receipts?status=all').expect(200);
  assert.equal(all.body.length, 1);
});

test('AI parse path uses the stubbed API and sanitizes the suggestion', async (t) => {
  const hostileParse = {
    merchant: `Publix ${'X'.repeat(300)}`,
    date: '2026-07-15',
    total_cents: 4321,
    tax_cents: -5,
    category: 'groceries',
    envelope: 'Slush Fund',
    confidence: 0.93,
    items: [{ name: 'Milk', amount_cents: 399 }, { name: 42, amount_cents: 100 }]
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: `Sure! ${JSON.stringify(hostileParse)}` }] })
  });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const { app, dbPath, receiptsDir } = buildApp('receipts-ai', { fetchImpl });
  t.after(() => {
    delete process.env.ANTHROPIC_API_KEY;
    cleanup(app, dbPath, receiptsDir);
  });

  const response = await request(app).post('/api/receipts')
    .send({ media_type: 'image/jpeg', image_base64: FAKE_IMAGE_BASE64 })
    .expect(201);
  assert.equal(response.body.ai, 'ok');
  const parsed = response.body.parsed;
  assert.equal(parsed.merchant.length, 120);
  assert.equal(parsed.total_cents, 4321);
  assert.equal(parsed.tax_cents, null);
  assert.equal(parsed.envelope, null);
  assert.equal(parsed.items.length, 1);
  assert.equal(response.body.receipt.merchant, parsed.merchant);
  assert.equal(response.body.receipt.total_cents, 4321);
  // Suggestion stored, but nothing was written to money tables.
  const today = await request(app).get('/api/today?date=2026-07-15').expect(200);
  assert.equal(today.body.no_plan, true);
});

test('sanitizeParsedReceipt matches envelopes case-insensitively and rejects junk', () => {
  const parsed = sanitizeParsedReceipt({
    merchant: '  Wawa  ',
    date: 'not-a-date',
    total_cents: 12.5,
    category: 'nonsense',
    envelope: 'gRoCeRiEs',
    confidence: 7,
    items: 'nope'
  }, ['Groceries', 'Gas']);
  assert.equal(parsed.merchant, 'Wawa');
  assert.equal(parsed.date, null);
  assert.equal(parsed.total_cents, null);
  assert.equal(parsed.category, null);
  assert.equal(parsed.envelope, 'Groceries');
  assert.equal(parsed.confidence, null);
  assert.deepEqual(parsed.items, []);
});
