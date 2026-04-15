const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../server');

function buildApp(testName) {
  const dbPath = path.join(os.tmpdir(), `limofin-${process.pid}-${Date.now()}-${testName}.db`);
  const app = createApp({ dbPath, skipSeed: true });
  return { app, dbPath };
}

function cleanup(app, dbPath) {
  app.locals.db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

test('GET /api/health returns ok', async (t) => {
  const { app, dbPath } = buildApp('health');
  t.after(() => cleanup(app, dbPath));

  const response = await request(app).get('/api/health').expect(200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.db, 'up');
});

test('POST /api/bills persists and round-trips', async (t) => {
  const { app, dbPath } = buildApp('bills');
  t.after(() => cleanup(app, dbPath));

  const created = await request(app)
    .post('/api/bills')
    .send({
      name: 'Internet',
      category: 'utility',
      amount_cents: 8900,
      due_day_of_month: 12,
      recurring: 1,
      autopay: 1,
      notes: 'Fiber'
    })
    .expect(201);

  const fetched = await request(app).get(`/api/bills/${created.body.id}`).expect(200);
  assert.equal(fetched.body.name, 'Internet');
  assert.equal(fetched.body.amount_cents, 8900);
  assert.equal(fetched.body.autopay, 1);
});

test('cashflow coverage is based on green earmarks only', async (t) => {
  const { app, dbPath } = buildApp('cashflow');
  t.after(() => cleanup(app, dbPath));

  const source = await request(app)
    .post('/api/sources')
    .send({
      name: 'Payroll',
      type: 'paycheck',
      amount_cents: 300000,
      frequency: 'monthly',
      next_date: '2026-04-01'
    })
    .expect(201);

  const billOne = await request(app)
    .post('/api/bills')
    .send({
      name: 'Bill A',
      category: 'other',
      amount_cents: 75000,
      due_day_of_month: 5
    })
    .expect(201);

  const billTwo = await request(app)
    .post('/api/bills')
    .send({
      name: 'Bill B',
      category: 'other',
      amount_cents: 75000,
      due_day_of_month: 19
    })
    .expect(201);

  await request(app)
    .post('/api/earmarks')
    .send({
      month: '2026-04',
      bill_id: billOne.body.id,
      source_id: source.body.id,
      amount_cents: 75000,
      status: 'funded'
    })
    .expect(201);

  const response = await request(app).get('/api/cashflow/2026-04').expect(200);
  assert.equal(response.body.income_total_cents, 300000);
  assert.equal(response.body.bills_total_cents, 150000);
  assert.equal(response.body.coverage_pct, 50);
});

test('deleting a bill cascades to its earmark', async (t) => {
  const { app, dbPath } = buildApp('cascade');
  t.after(() => cleanup(app, dbPath));

  const source = await request(app)
    .post('/api/sources')
    .send({
      name: 'Payroll',
      type: 'paycheck',
      amount_cents: 300000,
      frequency: 'monthly',
      next_date: '2026-04-01'
    })
    .expect(201);

  const bill = await request(app)
    .post('/api/bills')
    .send({
      name: 'Water',
      category: 'utility',
      amount_cents: 4200,
      due_day_of_month: 11
    })
    .expect(201);

  await request(app)
    .post('/api/earmarks')
    .send({
      month: '2026-04',
      bill_id: bill.body.id,
      source_id: source.body.id,
      amount_cents: 4200,
      status: 'planned'
    })
    .expect(201);

  await request(app).delete(`/api/bills/${bill.body.id}`).expect(200);
  const earmarks = await request(app).get('/api/earmarks').expect(200);
  assert.equal(earmarks.body.filter((entry) => entry.bill_id === bill.body.id).length, 0);
});
