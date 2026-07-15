-- LimoFin week plan seed: week starting 2026-07-15
-- Apply manually against an existing database, for example:
--   sqlite3 data/limofin.db < seeds/plan_2026-07-15.sql
-- Idempotent: the plan insert is guarded by NOT EXISTS on week_start
-- '2026-07-15', and every child row is guarded by NOT EXISTS on its own
-- identity within that plan, so re-running this file changes nothing.
-- Amounts are integer cents.

BEGIN;

-- Plan (guard: no plan with week_start 2026-07-15)
INSERT INTO week_plans (week_start, title, notes)
SELECT '2026-07-15', 'Week of Jul 15', 'Seeded plan for the week of 2026-07-15.'
WHERE NOT EXISTS (SELECT 1 FROM week_plans WHERE week_start = '2026-07-15');

-- Steps
INSERT INTO plan_steps (plan_id, label, done, position)
SELECT wp.id, 'Confirm mortgage cleared', 0, 0
FROM week_plans wp
WHERE wp.week_start = '2026-07-15'
  AND NOT EXISTS (SELECT 1 FROM plan_steps ps WHERE ps.plan_id = wp.id AND ps.label = 'Confirm mortgage cleared');

INSERT INTO plan_steps (plan_id, label, done, position)
SELECT wp.id, 'Pay Chase Amazon CC planned payment', 0, 1
FROM week_plans wp
WHERE wp.week_start = '2026-07-15'
  AND NOT EXISTS (SELECT 1 FROM plan_steps ps WHERE ps.plan_id = wp.id AND ps.label = 'Pay Chase Amazon CC planned payment');

INSERT INTO plan_steps (plan_id, label, done, position)
SELECT wp.id, 'Move 150.00 to savings', 0, 2
FROM week_plans wp
WHERE wp.week_start = '2026-07-15'
  AND NOT EXISTS (SELECT 1 FROM plan_steps ps WHERE ps.plan_id = wp.id AND ps.label = 'Move 150.00 to savings');

INSERT INTO plan_steps (plan_id, label, done, position)
SELECT wp.id, 'Review subscriptions for cuts', 0, 3
FROM week_plans wp
WHERE wp.week_start = '2026-07-15'
  AND NOT EXISTS (SELECT 1 FROM plan_steps ps WHERE ps.plan_id = wp.id AND ps.label = 'Review subscriptions for cuts');

-- Envelopes (dollars stored as cents)
INSERT INTO plan_envelopes (plan_id, name, allocated_cents, position)
SELECT wp.id, 'Groceries', 22000, 0
FROM week_plans wp
WHERE wp.week_start = '2026-07-15'
  AND NOT EXISTS (SELECT 1 FROM plan_envelopes pe WHERE pe.plan_id = wp.id AND pe.name = 'Groceries');

INSERT INTO plan_envelopes (plan_id, name, allocated_cents, position)
SELECT wp.id, 'Dining out', 8000, 1
FROM week_plans wp
WHERE wp.week_start = '2026-07-15'
  AND NOT EXISTS (SELECT 1 FROM plan_envelopes pe WHERE pe.plan_id = wp.id AND pe.name = 'Dining out');

INSERT INTO plan_envelopes (plan_id, name, allocated_cents, position)
SELECT wp.id, 'Gas', 6000, 2
FROM week_plans wp
WHERE wp.week_start = '2026-07-15'
  AND NOT EXISTS (SELECT 1 FROM plan_envelopes pe WHERE pe.plan_id = wp.id AND pe.name = 'Gas');

INSERT INTO plan_envelopes (plan_id, name, allocated_cents, position)
SELECT wp.id, 'Fun money', 5000, 3
FROM week_plans wp
WHERE wp.week_start = '2026-07-15'
  AND NOT EXISTS (SELECT 1 FROM plan_envelopes pe WHERE pe.plan_id = wp.id AND pe.name = 'Fun money');

-- Spends (guarded by envelope + memo within the seeded plan)
INSERT INTO envelope_spends (envelope_id, amount_cents, memo, date)
SELECT pe.id, 5423, 'Publix run', '2026-07-15'
FROM plan_envelopes pe
JOIN week_plans wp ON wp.id = pe.plan_id
WHERE wp.week_start = '2026-07-15' AND pe.name = 'Groceries'
  AND NOT EXISTS (
    SELECT 1 FROM envelope_spends es
    WHERE es.envelope_id = pe.id AND es.memo = 'Publix run' AND es.date = '2026-07-15'
  );

INSERT INTO envelope_spends (envelope_id, amount_cents, memo, date)
SELECT pe.id, 3810, 'Wawa fill up', '2026-07-15'
FROM plan_envelopes pe
JOIN week_plans wp ON wp.id = pe.plan_id
WHERE wp.week_start = '2026-07-15' AND pe.name = 'Gas'
  AND NOT EXISTS (
    SELECT 1 FROM envelope_spends es
    WHERE es.envelope_id = pe.id AND es.memo = 'Wawa fill up' AND es.date = '2026-07-15'
  );

COMMIT;
