-- LimoFin week plan seed: week starting 2026-07-15
-- Apply manually against an existing database, for example:
--   sqlite3 data/limofin.db < seeds/plan_2026-07-15.sql
-- (scripts/update.sh also applies this automatically after each deploy.)
-- Apply-once: whether a plan with week_start '2026-07-15' already exists is
-- snapshotted into a temp table BEFORE any insert, and every statement is
-- guarded on that snapshot. On a fresh database everything inserts; on any
-- later run nothing inserts, so rows the user has edited or deleted through
-- the UI are never resurrected.
-- Amounts are integer cents.

BEGIN;

DROP TABLE IF EXISTS temp._seed_state;
CREATE TEMP TABLE _seed_state AS
SELECT EXISTS(SELECT 1 FROM week_plans WHERE week_start = '2026-07-15') AS already_seeded;

-- Plan
INSERT INTO week_plans (week_start, title, notes)
SELECT '2026-07-15', 'Week of Jul 15', 'Seeded plan for the week of 2026-07-15.'
WHERE (SELECT already_seeded FROM temp._seed_state) = 0;

-- Steps
INSERT INTO plan_steps (plan_id, label, done, position)
SELECT wp.id, s.label, 0, s.position
FROM week_plans wp
JOIN (
  SELECT 'Confirm mortgage cleared' AS label, 0 AS position
  UNION ALL SELECT 'Pay Chase Amazon CC planned payment', 1
  UNION ALL SELECT 'Move 150.00 to savings', 2
  UNION ALL SELECT 'Review subscriptions for cuts', 3
) s
WHERE wp.week_start = '2026-07-15'
  AND (SELECT already_seeded FROM temp._seed_state) = 0;

-- Envelopes (dollars stored as cents)
INSERT INTO plan_envelopes (plan_id, name, allocated_cents, position)
SELECT wp.id, e.name, e.allocated_cents, e.position
FROM week_plans wp
JOIN (
  SELECT 'Groceries' AS name, 22000 AS allocated_cents, 0 AS position
  UNION ALL SELECT 'Dining out', 8000, 1
  UNION ALL SELECT 'Gas', 6000, 2
  UNION ALL SELECT 'Fun money', 5000, 3
) e
WHERE wp.week_start = '2026-07-15'
  AND (SELECT already_seeded FROM temp._seed_state) = 0;

-- Spends
INSERT INTO envelope_spends (envelope_id, amount_cents, memo, date)
SELECT pe.id, 5423, 'Publix run', '2026-07-15'
FROM plan_envelopes pe
JOIN week_plans wp ON wp.id = pe.plan_id
WHERE wp.week_start = '2026-07-15' AND pe.name = 'Groceries'
  AND (SELECT already_seeded FROM temp._seed_state) = 0;

INSERT INTO envelope_spends (envelope_id, amount_cents, memo, date)
SELECT pe.id, 3810, 'Wawa fill up', '2026-07-15'
FROM plan_envelopes pe
JOIN week_plans wp ON wp.id = pe.plan_id
WHERE wp.week_start = '2026-07-15' AND pe.name = 'Gas'
  AND (SELECT already_seeded FROM temp._seed_state) = 0;

DROP TABLE temp._seed_state;

COMMIT;
