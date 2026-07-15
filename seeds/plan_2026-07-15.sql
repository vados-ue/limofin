-- LimoFin week plan seed: week starting 2026-07-15 (Payday week)
-- Apply manually against an existing database, for example:
--   sqlite3 data/limofin.db < seeds/plan_2026-07-15.sql
-- (scripts/update.sh also applies this automatically after each deploy,
-- and skips it once the week has ended.)
-- Apply-once: whether a plan with week_start '2026-07-15' already exists is
-- snapshotted into a temp table BEFORE any insert, and every statement is
-- guarded on that snapshot. On a fresh database everything inserts; on any
-- later run nothing inserts, so rows the user has edited or deleted through
-- the UI are never resurrected.
-- ORDERING: the guard keys on week_start alone, so ANY pre-existing plan for
-- 2026-07-15 (for example an earlier placeholder) makes this entire file a
-- silent no-op. To replace such a plan, delete it FIRST via
-- DELETE /api/plans/:id (the API cascades to steps, envelopes, spends, meta,
-- runway points, and flags; the bare sqlite3 CLI does NOT cascade unless you
-- run PRAGMA foreign_keys=ON), and only then apply this seed. update.sh
-- detects the collision and prints "Skipped", never a false "Applied".
-- Amounts are integer cents. No spends are seeded: the owner logs them live.

BEGIN;

DROP TABLE IF EXISTS temp._seed_state;
CREATE TEMP TABLE _seed_state AS
SELECT EXISTS(SELECT 1 FROM week_plans WHERE week_start = '2026-07-15') AS already_seeded;

-- Plan
INSERT INTO week_plans (week_start, title, notes)
SELECT '2026-07-15', 'Payday week', NULL
WHERE (SELECT already_seeded FROM temp._seed_state) = 0;

-- Verdict and cash floor
INSERT INTO plan_meta (plan_id, verdict, floor_cents)
SELECT wp.id,
  'Chase bottomed at $90.93 before the paycheck; with it and the $200 transfer you sit near $3,025. The week affords the concert, repays McCoy, and re-kills Best Buy, but only by skipping the extra Carnival payment. End-of-week margin over the floor: about $95. That is one Zelle wide.',
  150000
FROM week_plans wp
WHERE wp.week_start = '2026-07-15'
  AND (SELECT already_seeded FROM temp._seed_state) = 0;

-- Steps
INSERT INTO plan_steps (plan_id, label, done, position)
SELECT wp.id, s.label, 0, s.position
FROM week_plans wp
JOIN (
  SELECT 'Wed 15: Before Tampa (2 min): confirm at Barclays that the $300 paid 7/9 covers the Carnival minimum due tomorrow. SELF $107 autopays today. Concert on debit, $120 cap; Carnival and Best Buy cards stay home.' AS label, 0 AS position
  UNION ALL SELECT 'Thu 16: Recovery day, $0 spend. T-Mobile $267 hits this window. Log the real concert total against its envelope.', 1
  UNION ALL SELECT 'Fri 17: Re-kill the Best Buy card: pay the ~$119.20 that revived it (Proforce Pest $50 posted + Firestone $69.20 pending) and repoint Proforce to debit. Then 10-min portal checks: Upstart (Monarch says $9,234, April portal said $4,485) and the real Apple Card balance in Wallet.', 2
  UNION ALL SELECT 'Sat 18: Move $200 back to McCoy (the buffer saved the week once already). Repoint SunPass to debit: third $40 refill of the month hit Carnival on 7/15. Publix run, $75.', 3
  UNION ALL SELECT 'Sun 19: HELOC $502 autopays. Projected finish ~$1,595 with the $1,500 floor intact. Carnival attack resumes with the 7/31 check.', 4
) s
WHERE wp.week_start = '2026-07-15'
  AND (SELECT already_seeded FROM temp._seed_state) = 0;

-- Envelopes (dollars stored as cents)
INSERT INTO plan_envelopes (plan_id, name, allocated_cents, position)
SELECT wp.id, e.name, e.allocated_cents, e.position
FROM week_plans wp
JOIN (
  SELECT 'Concert (Tampa, all-in)' AS name, 12000 AS allocated_cents, 0 AS position
  UNION ALL SELECT 'Groceries (Publix, Sat)', 7500, 1
  UNION ALL SELECT 'Gas (debit)', 4000, 2
  UNION ALL SELECT 'Dining out, dispensary, betting, Zelle', 0, 3
) e
WHERE wp.week_start = '2026-07-15'
  AND (SELECT already_seeded FROM temp._seed_state) = 0;

-- Runway points (projected balances through the week)
INSERT INTO plan_runway_points (plan_id, label, amount_cents, position)
SELECT wp.id, r.label, r.amount_cents, r.position
FROM week_plans wp
JOIN (
  SELECT 'Now' AS label, 302500 AS amount_cents, 0 AS position
  UNION ALL SELECT 'Wed 15', 279800, 1
  UNION ALL SELECT 'Thu 16', 253100, 2
  UNION ALL SELECT 'Fri 17', 241200, 3
  UNION ALL SELECT 'Sat 18', 209700, 4
  UNION ALL SELECT 'Sun 19', 159500, 5
) r
WHERE wp.week_start = '2026-07-15'
  AND (SELECT already_seeded FROM temp._seed_state) = 0;

-- Flags
INSERT INTO plan_flags (plan_id, severity, text, position)
SELECT wp.id, f.severity, f.text, f.position
FROM week_plans wp
JOIN (
  SELECT 'danger' AS severity, 'July dining + dispensary ceiling effectively spent: $997 of $1,000 used by Jul 14 per Monarch tags.' AS text, 0 AS position
  UNION ALL SELECT 'danger', '$390 went out by Zelle in 3 days (7/12 $220, 7/14 $170), both tagged Mary J, category unconfirmed.', 1
  UNION ALL SELECT 'warn', 'Upstart syncs fresh at $9,234; the April portal said $4,485. Verify at the portal, could be a new loan or a sync artifact.', 2
  UNION ALL SELECT 'warn', 'Apple Card is 10 months stale in Monarch; real balance unknown, check Wallet.', 3
  UNION ALL SELECT 'info', 'Mom''s Zelle and the McCoy $200 pull were not both visible in Monarch yet; runway assumes only the $200.', 4
) f
WHERE wp.week_start = '2026-07-15'
  AND (SELECT already_seeded FROM temp._seed_state) = 0;

DROP TABLE temp._seed_state;

COMMIT;
