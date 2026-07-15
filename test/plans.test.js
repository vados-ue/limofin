const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../server');

const SEED_PATH = path.join(__dirname, '..', 'seeds', 'plan_2026-07-15.sql');

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

const PLAN_PAYLOAD = {
  week_start: '2026-07-15',
  title: 'Week of Jul 15',
  notes: 'Test plan',
  steps: [
    { label: 'Pay Amex statement balance' },
    { label: 'Move 150 to savings', done: 1 }
  ],
  envelopes: [
    { name: 'Groceries', allocated_cents: 22000 },
    { name: 'Gas', allocated_cents: 6000 }
  ]
};

test('GET /api/health reports version 0.2.0', async (t) => {
  const { app, dbPath } = buildApp('plans-health-version');
  t.after(() => cleanup(app, dbPath));

  const response = await request(app).get('/api/health').expect(200);
  assert.equal(response.body.version, '0.2.0');
});

test('GET /api/plans/current returns 404 when no plan exists, list is empty', async (t) => {
  const { app, dbPath } = buildApp('plans-current-empty');
  t.after(() => cleanup(app, dbPath));

  const current = await request(app).get('/api/plans/current').expect(404);
  assert.equal(current.body.error, 'Not found');

  const list = await request(app).get('/api/plans').expect(200);
  assert.deepEqual(list.body, []);
});

test('POST /api/plans round-trips plan, steps, and envelopes', async (t) => {
  const { app, dbPath } = buildApp('plans-roundtrip');
  t.after(() => cleanup(app, dbPath));

  const created = await request(app).post('/api/plans').send(PLAN_PAYLOAD).expect(201);
  assert.equal(created.body.week_start, '2026-07-15');
  assert.equal(created.body.title, 'Week of Jul 15');
  assert.equal(created.body.steps.length, 2);
  assert.equal(created.body.envelopes.length, 2);
  assert.equal(created.body.totals.allocated_cents, 28000);
  assert.equal(created.body.totals.spent_cents, 0);
  assert.equal(created.body.totals.steps_total, 2);
  assert.equal(created.body.totals.steps_done, 1);

  const fetched = await request(app).get(`/api/plans/${created.body.id}`).expect(200);
  assert.equal(fetched.body.steps[0].label, 'Pay Amex statement balance');
  assert.equal(fetched.body.steps[1].done, 1);
  assert.equal(fetched.body.envelopes[0].name, 'Groceries');
  assert.equal(fetched.body.envelopes[0].allocated_cents, 22000);
  assert.equal(fetched.body.envelopes[0].remaining_cents, 22000);

  // Current resolves for any date inside the 7-day window, 404 outside it.
  const inside = await request(app).get('/api/plans/current?date=2026-07-21').expect(200);
  assert.equal(inside.body.id, created.body.id);
  await request(app).get('/api/plans/current?date=2026-07-22').expect(404);
  await request(app).get('/api/plans/current?date=2026-07-14').expect(404);

  // Duplicate week_start is rejected with a friendly message, not raw SQLite.
  const duplicate = await request(app).post('/api/plans').send({ week_start: '2026-07-15' }).expect(400);
  assert.equal(duplicate.body.error, 'A plan for that week already exists');

  // Duplicate envelope names within one plan get a friendly message too.
  const dupEnvelope = await request(app).post('/api/plans').send({
    week_start: '2026-09-02',
    envelopes: [{ name: 'Gas', allocated_cents: 6000 }, { name: 'Gas', allocated_cents: 1000 }]
  }).expect(400);
  assert.equal(dupEnvelope.body.error, 'Envelope names must be unique within a plan');

  // allocated_cents must be a safe integer within the cap.
  await request(app).post('/api/plans').send({
    week_start: '2026-09-09',
    envelopes: [{ name: 'X', allocated_cents: 1e308 }]
  }).expect(400);
  await request(app).post('/api/plans').send({
    week_start: '2026-09-09',
    envelopes: [{ name: 'X', allocated_cents: 9007199254740993 }]
  }).expect(400);
});

test('PATCH /api/steps/:id sets and toggles done', async (t) => {
  const { app, dbPath } = buildApp('plans-step-toggle');
  t.after(() => cleanup(app, dbPath));

  const created = await request(app).post('/api/plans').send(PLAN_PAYLOAD).expect(201);
  const stepId = created.body.steps[0].id;

  const setDone = await request(app).patch(`/api/steps/${stepId}`).send({ done: 1 }).expect(200);
  assert.equal(setDone.body.done, 1);

  const setUndone = await request(app).patch(`/api/steps/${stepId}`).send({ done: false }).expect(200);
  assert.equal(setUndone.body.done, 0);

  // Empty body toggles in place.
  const toggled = await request(app).patch(`/api/steps/${stepId}`).send({}).expect(200);
  assert.equal(toggled.body.done, 1);

  const detail = await request(app).get(`/api/plans/${created.body.id}`).expect(200);
  assert.equal(detail.body.totals.steps_done, 2);

  await request(app).patch('/api/steps/9999').send({ done: 1 }).expect(404);
  const badValue = await request(app).patch(`/api/steps/${stepId}`).send({ done: 'yes' }).expect(400);
  assert.match(badValue.body.error, /done must be/);
});

test('POST envelope spends roll up spent and remaining cents', async (t) => {
  const { app, dbPath } = buildApp('plans-spend-rollup');
  t.after(() => cleanup(app, dbPath));

  const created = await request(app).post('/api/plans').send(PLAN_PAYLOAD).expect(201);
  const envelopeId = created.body.envelopes[0].id;

  const first = await request(app)
    .post(`/api/envelopes/${envelopeId}/spends`)
    .send({ amount_cents: 5423, memo: 'Publix run', date: '2026-07-15' })
    .expect(201);
  assert.equal(first.body.amount_cents, 5423);
  assert.equal(first.body.envelope.spent_cents, 5423);
  assert.equal(first.body.envelope.remaining_cents, 16577);

  const second = await request(app)
    .post(`/api/envelopes/${envelopeId}/spends`)
    .send({ amount_cents: 3810, memo: 'Aldi top-up' })
    .expect(201);
  assert.equal(second.body.envelope.spent_cents, 9233);
  assert.equal(second.body.envelope.remaining_cents, 12767);

  const detail = await request(app).get(`/api/plans/${created.body.id}`).expect(200);
  const groceries = detail.body.envelopes.find((envelope) => envelope.id === envelopeId);
  assert.equal(groceries.spent_cents, 9233);
  assert.equal(groceries.remaining_cents, 12767);
  assert.equal(groceries.spends.length, 2);
  assert.equal(detail.body.totals.spent_cents, 9233);
  assert.equal(detail.body.totals.remaining_cents, 28000 - 9233);

  // Validation: non-positive, non-integer, and unsafe/oversized amounts are rejected.
  await request(app).post(`/api/envelopes/${envelopeId}/spends`).send({ amount_cents: 0 }).expect(400);
  await request(app).post(`/api/envelopes/${envelopeId}/spends`).send({ amount_cents: 12.5 }).expect(400);
  await request(app).post(`/api/envelopes/${envelopeId}/spends`).send({ amount_cents: 1e300 }).expect(400);
  await request(app).post(`/api/envelopes/${envelopeId}/spends`).send({ amount_cents: 9007199254740993 }).expect(400);
  await request(app).post(`/api/envelopes/${envelopeId}/spends`).send({ amount_cents: 10000000001 }).expect(400);
  await request(app).post('/api/envelopes/9999/spends').send({ amount_cents: 100 }).expect(404);
});

test('DELETE /api/spends/:id removes the spend and updates the rollup', async (t) => {
  const { app, dbPath } = buildApp('plans-spend-delete');
  t.after(() => cleanup(app, dbPath));

  const created = await request(app).post('/api/plans').send(PLAN_PAYLOAD).expect(201);
  const envelopeId = created.body.envelopes[0].id;

  const first = await request(app)
    .post(`/api/envelopes/${envelopeId}/spends`)
    .send({ amount_cents: 5423 })
    .expect(201);
  await request(app)
    .post(`/api/envelopes/${envelopeId}/spends`)
    .send({ amount_cents: 3810 })
    .expect(201);

  await request(app).delete(`/api/spends/${first.body.id}`).expect(200);

  const detail = await request(app).get(`/api/plans/${created.body.id}`).expect(200);
  const groceries = detail.body.envelopes.find((envelope) => envelope.id === envelopeId);
  assert.equal(groceries.spent_cents, 3810);
  assert.equal(groceries.spends.length, 1);

  await request(app).delete(`/api/spends/${first.body.id}`).expect(404);
});

test('deleting a plan cascades to steps, envelopes, and spends', async (t) => {
  const { app, dbPath } = buildApp('plans-cascade');
  t.after(() => cleanup(app, dbPath));

  const created = await request(app).post('/api/plans').send(PLAN_PAYLOAD).expect(201);
  const envelopeId = created.body.envelopes[0].id;
  await request(app)
    .post(`/api/envelopes/${envelopeId}/spends`)
    .send({ amount_cents: 1000 })
    .expect(201);

  await request(app).delete(`/api/plans/${created.body.id}`).expect(200);
  await request(app).get(`/api/plans/${created.body.id}`).expect(404);

  const db = app.locals.db;
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plan_steps').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plan_envelopes').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM envelope_spends').get().count, 0);
});

test('plan seed file is idempotent across repeated applies', async (t) => {
  const { app, dbPath } = buildApp('plans-seed-idempotent');
  t.after(() => cleanup(app, dbPath));

  const seedSql = fs.readFileSync(SEED_PATH, 'utf8');
  const db = app.locals.db;
  db.exec(seedSql);
  db.exec(seedSql);

  const plans = await request(app).get('/api/plans').expect(200);
  assert.equal(plans.body.length, 1);
  assert.equal(plans.body[0].week_start, '2026-07-15');

  const detail = await request(app).get(`/api/plans/${plans.body[0].id}`).expect(200);
  const stepCount = detail.body.steps.length;
  const envelopeCount = detail.body.envelopes.length;
  assert.ok(stepCount > 0);
  assert.ok(envelopeCount > 0);

  db.exec(seedSql);
  const again = await request(app).get(`/api/plans/${plans.body[0].id}`).expect(200);
  assert.equal(again.body.steps.length, stepCount);
  assert.equal(again.body.envelopes.length, envelopeCount);

  // The seed ships zero spends, and re-applies must not invent any.
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM envelope_spends').get().count, 0);

  // Rows the user deletes must NOT be resurrected by a later re-apply.
  const flagsBefore = db.prepare('SELECT COUNT(*) AS count FROM plan_flags').get().count;
  assert.ok(flagsBefore > 0);
  db.prepare("DELETE FROM plan_flags WHERE severity = 'info'").run();
  db.exec(seedSql);
  const flagsAfter = db.prepare('SELECT COUNT(*) AS count FROM plan_flags').get().count;
  assert.equal(flagsAfter, flagsBefore - 1);

  db.prepare("DELETE FROM plan_steps WHERE label LIKE 'Thu 16:%'").run();
  db.exec(seedSql);
  const stepsAfter = await request(app).get(`/api/plans/${plans.body[0].id}`).expect(200);
  assert.equal(stepsAfter.body.steps.length, stepCount - 1);
});

const DETAIL_PAYLOAD = {
  week_start: '2026-08-05',
  title: 'Detail week',
  verdict: 'Tight but doable; the floor holds if nothing new hits.',
  floor_cents: 150000,
  runway: [
    { label: 'Now', amount_cents: 302500 },
    { label: 'Fri', amount_cents: 241200 },
    { label: 'Sun', amount_cents: 159500 }
  ],
  flags: [
    { severity: 'danger', text: 'Dining ceiling effectively spent.' },
    { severity: 'warn', text: 'Upstart balance needs a portal check.' },
    { severity: 'info', text: 'Runway assumes only the $200 pull.' }
  ]
};

test('POST /api/plans round-trips verdict, floor, runway, and flags', async (t) => {
  const { app, dbPath } = buildApp('plans-detail-roundtrip');
  t.after(() => cleanup(app, dbPath));

  const created = await request(app).post('/api/plans').send(DETAIL_PAYLOAD).expect(201);
  assert.equal(created.body.verdict, DETAIL_PAYLOAD.verdict);
  assert.equal(created.body.floor_cents, 150000);
  assert.deepEqual(created.body.runway, DETAIL_PAYLOAD.runway);
  assert.deepEqual(created.body.flags, DETAIL_PAYLOAD.flags);

  const fetched = await request(app).get(`/api/plans/${created.body.id}`).expect(200);
  assert.equal(fetched.body.verdict, DETAIL_PAYLOAD.verdict);
  assert.equal(fetched.body.floor_cents, 150000);
  assert.deepEqual(fetched.body.runway, DETAIL_PAYLOAD.runway);
  assert.deepEqual(fetched.body.flags, DETAIL_PAYLOAD.flags);

  // The current endpoint carries the same detail fields.
  const current = await request(app).get('/api/plans/current?date=2026-08-07').expect(200);
  assert.equal(current.body.verdict, DETAIL_PAYLOAD.verdict);
  assert.deepEqual(current.body.runway, DETAIL_PAYLOAD.runway);
});

test('plan detail validation rejects bad severity and unsafe cents', async (t) => {
  const { app, dbPath } = buildApp('plans-detail-validation');
  t.after(() => cleanup(app, dbPath));

  // Severity outside the whitelist.
  const badSeverity = await request(app).post('/api/plans').send({
    week_start: '2026-08-12',
    flags: [{ severity: 'fatal', text: 'nope' }]
  }).expect(400);
  assert.match(badSeverity.body.error, /severity must be one of/);

  // Flag text is required.
  await request(app).post('/api/plans').send({
    week_start: '2026-08-12',
    flags: [{ severity: 'info', text: '' }]
  }).expect(400);

  // floor_cents: unsafe integer, negative, and oversized.
  await request(app).post('/api/plans').send({
    week_start: '2026-08-12',
    floor_cents: 9007199254740993
  }).expect(400);
  await request(app).post('/api/plans').send({
    week_start: '2026-08-12',
    floor_cents: -1
  }).expect(400);
  await request(app).post('/api/plans').send({
    week_start: '2026-08-12',
    floor_cents: 10000000001
  }).expect(400);

  // Runway points: unsafe amount, non-integer amount, missing label.
  await request(app).post('/api/plans').send({
    week_start: '2026-08-12',
    runway: [{ label: 'Now', amount_cents: 1e308 }]
  }).expect(400);
  await request(app).post('/api/plans').send({
    week_start: '2026-08-12',
    runway: [{ label: 'Now', amount_cents: 12.5 }]
  }).expect(400);
  await request(app).post('/api/plans').send({
    week_start: '2026-08-12',
    runway: [{ label: '', amount_cents: 100 }]
  }).expect(400);

  // Arrays are required to be arrays.
  await request(app).post('/api/plans').send({
    week_start: '2026-08-12',
    runway: 'not an array'
  }).expect(400);
  await request(app).post('/api/plans').send({
    week_start: '2026-08-12',
    flags: 'not an array'
  }).expect(400);

  // Nothing invalid got through.
  const list = await request(app).get('/api/plans').expect(200);
  assert.deepEqual(list.body, []);
});

test('plans created without details return null verdict and empty arrays', async (t) => {
  const { app, dbPath } = buildApp('plans-detail-absent');
  t.after(() => cleanup(app, dbPath));

  const created = await request(app).post('/api/plans').send(PLAN_PAYLOAD).expect(201);
  const fetched = await request(app).get(`/api/plans/${created.body.id}`).expect(200);
  assert.equal(fetched.body.verdict, null);
  assert.equal(fetched.body.floor_cents, null);
  assert.deepEqual(fetched.body.runway, []);
  assert.deepEqual(fetched.body.flags, []);
});

test('seed populates the Payday week plan exactly', async (t) => {
  const { app, dbPath } = buildApp('plans-seed-fidelity');
  t.after(() => cleanup(app, dbPath));

  const seedSql = fs.readFileSync(SEED_PATH, 'utf8');
  app.locals.db.exec(seedSql);

  const plans = await request(app).get('/api/plans').expect(200);
  assert.equal(plans.body.length, 1);

  const detail = await request(app).get(`/api/plans/${plans.body[0].id}`).expect(200);
  const plan = detail.body;
  assert.equal(plan.week_start, '2026-07-15');
  assert.equal(plan.title, 'Payday week');
  assert.match(plan.verdict, /^Chase bottomed at \$90\.93/);
  assert.match(plan.verdict, /one Zelle wide\.$/);
  assert.equal(plan.floor_cents, 150000);

  assert.equal(plan.steps.length, 5);
  assert.match(plan.steps[0].label, /^Wed 15:/);
  assert.match(plan.steps[4].label, /^Sun 19:/);

  assert.equal(plan.envelopes.length, 4);
  assert.deepEqual(
    plan.envelopes.map((envelope) => [envelope.name, envelope.allocated_cents]),
    [
      ['Concert (Tampa, all-in)', 12000],
      ['Groceries (Publix, Sat)', 7500],
      ['Gas (debit)', 4000],
      ['Dining out, dispensary, betting, Zelle', 0]
    ]
  );

  // Zero spends: the owner logs them live.
  assert.equal(plan.totals.spent_cents, 0);
  assert.equal(plan.envelopes.every((envelope) => envelope.spends.length === 0), true);

  assert.deepEqual(plan.runway, [
    { label: 'Now', amount_cents: 302500 },
    { label: 'Wed 15', amount_cents: 279800 },
    { label: 'Thu 16', amount_cents: 253100 },
    { label: 'Fri 17', amount_cents: 241200 },
    { label: 'Sat 18', amount_cents: 209700 },
    { label: 'Sun 19', amount_cents: 159500 }
  ]);

  assert.equal(plan.flags.length, 5);
  assert.deepEqual(
    plan.flags.map((flag) => flag.severity),
    ['danger', 'danger', 'warn', 'warn', 'info']
  );
  assert.match(plan.flags[4].text, /^Mom's Zelle/);
});
