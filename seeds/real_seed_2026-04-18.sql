-- LimoFin real-data seed
-- Source: LimoVault Finance Dashboard + Bill Schedule (2026-04-18 verified)
-- Replaces the illustrative demo seed with Andreas's actual recurring income,
-- bills, budgets, and April 2026 earmarks.

BEGIN;

-- Clear demo rows
DELETE FROM earmarks;
DELETE FROM budgets;
DELETE FROM expenses;
DELETE FROM bills;
DELETE FROM income_sources;

-- Reset autoincrement counters so the new IDs start at 1
DELETE FROM sqlite_sequence WHERE name IN ('income_sources','bills','budgets','earmarks','expenses');

-- ───────────────────────────────────────── INCOME ─────────────────────────────────────────
-- Biweekly W-2 net paycheck $4,166.67 (Gusto → Chase ****9890).
-- 2025 W-2 gross $130,153 → ~$10,846/mo gross → ~$8,333/mo net on biweekly cadence.
-- Last observed deposit 2026-03-31; next biweekly = 2026-04-28.
INSERT INTO income_sources (id, name, type, amount_cents, frequency, next_date, notes) VALUES
  (1, 'ITernative Paycheck',       'paycheck', 416667, 'biweekly', '2026-04-28', 'Gusto → Chase ****9890. 2025 W-2 gross $130,153.'),
  (2, 'Bonus / Variable',          'paycheck', 650500, 'oneoff',   NULL,         'Last bonus 2026-03-23 = $6,505. Not regular.'),
  (3, 'HYSA Float Transfer',       'transfer',  50000, 'monthly',  NULL,         'Optional top-up to keep Chase ****9890 above the $4,500 floor.');

-- ───────────────────────────────────────── BILLS ─────────────────────────────────────────
-- All pay from Chase ****9890 unless noted. Amounts are typical monthly outflow.
-- For variable CCs, amount = rough planned payment (avalanche posture, 2026-04-17 balances).
INSERT INTO bills (id, name, category, amount_cents, due_day_of_month, recurring, funded_from_source_id, autopay, notes) VALUES
  (1,  'US Bank Mortgage (****8003)',      'mortgage',     165411,  1,  1, 1, 1, 'FHA. Incl. escrow (prop tax + Tower Hill ins). Balance ~$160,659.'),
  (2,  'Upstart Personal Loan (****6931)', 'loan',          40794,  1,  1, 1, 1, 'Balance $4,485 @ 16.76%. 4-yr 100% on-time. Payoff ~Apr 2027.'),
  (3,  'Spectrum Internet',                'utility',        6000,  5,  1, 1, 1, 'Bumped from $40 → $60 Feb 2026.'),
  (4,  'CarePayment (medical ER)',         'loan',           6300,  7,  1, 1, 0, 'MANUAL. Balance $680 @ 0% APR. Orlando Health ER 01/26/2026. Phone reminder on the 4th — miss = lose 0% benefit.'),
  (5,  'Kissimmee Utility (KUA)',          'utility',       11000,  8,  1, 1, 1, 'Electric + water. Typical $86–$168, avg ~$110. Variable by season.'),
  (6,  'Chase Amazon CC (****0382)',       'cc',            20000, 11,  1, 1, 0, 'MANUAL. Balance $9,778 @ 27.49%. AVALANCHE PRIORITY #1 — plan larger payment when surplus allows.'),
  (7,  'Aqua Finance AC (****047)',        'loan',          12000, 12,  1, 1, 1, 'Balance $3,535. Paid via PayNearMe.'),
  (8,  'GoodLeap Solar',                   'loan',          28847, 13,  1, 1, 1, 'Balance ~$71,438. 30% federal credit already claimed. Not in Monarch.'),
  (9,  'SELF Roof Loan (#202642)',         'loan',          10733, 15,  1, 1, 1, 'Balance $2,925 @ 7.0%. Period 44/72. Payoff ~Jun 2028.'),
  (10, 'T-Mobile',                         'utility',       26700, 16,  1, 1, 1, 'Steady $267 since Dec 2025.'),
  (11, 'Barclays / Carnival CC (****8808)','cc',             3000, 16,  1, 1, 0, 'MANUAL. Balance $0 but $1,419 pending posted 4/16 — will be due next cycle.'),
  (12, 'Shellpoint HELOC (****9378)',      'loan',          50233, 19,  1, 1, 1, 'Balance $33,574 @ 15.5%. Avalanche target after CCs cleared.'),
  (13, 'Apple Card',                       'cc',            17000, 20,  1, 1, 0, 'MANUAL. Balance $8,510. Payments range $50–$650.'),
  (14, 'Best Buy Visa / Citi (****8634)',  'cc',             3000, 25,  1, 1, 0, 'MANUAL. Balance $1,393.'),
  (15, 'Synchrony / Discount Tire (****0455)','cc',              0, 11,  1, 1, 0, 'MANUAL. Balance $0 — keep it that way.');

-- ───────────────────────────────────────── BUDGETS ─────────────────────────────────────────
-- 2026-04 category limits. Based on "avalanche CCs, protect the $4,500 Chase floor" posture.
INSERT INTO budgets (month, category, limit_cents) VALUES
  ('2026-04', 'cc',           80000),   -- total CC payments target for April
  ('2026-04', 'mortgage',    165411),
  ('2026-04', 'loan',        148907),   -- Upstart+Aqua+GoodLeap+SELF+HELOC+Care
  ('2026-04', 'utility',      43700);   -- KUA+Spectrum+T-Mobile

-- ───────────────────────────────────────── EARMARKS (2026-04) ─────────────────────────────
-- Status logic anchored on today = 2026-04-18:
--   • due on/before 4/17 → paid
--   • due 4/18–4/30     → funded (money identified, not yet debited)
--   • CC manual planned → planned
INSERT INTO earmarks (month, bill_id, source_id, amount_cents, status) VALUES
  ('2026-04',  1, 1, 165411, 'paid'),    -- Mortgage (1st)
  ('2026-04',  2, 1,  40794, 'paid'),    -- Upstart (1st)
  ('2026-04',  3, 1,   6000, 'paid'),    -- Spectrum (5th)
  ('2026-04',  4, 1,   6300, 'paid'),    -- CarePayment (7th) — confirm manually
  ('2026-04',  5, 1,  11000, 'paid'),    -- KUA (8th)
  ('2026-04',  6, 1,  20000, 'planned'), -- Chase Amazon CC (11th) — avalanche target
  ('2026-04',  7, 1,  12000, 'paid'),    -- Aqua AC (12th)
  ('2026-04',  8, 1,  28847, 'paid'),    -- GoodLeap Solar (13th)
  ('2026-04',  9, 1,  10733, 'paid'),    -- SELF Roof (15th)
  ('2026-04', 10, 1,  26700, 'paid'),    -- T-Mobile (16th)
  ('2026-04', 11, 1,   3000, 'planned'), -- Barclays CC (16th, pending)
  ('2026-04', 12, 1,  50233, 'funded'),  -- Shellpoint HELOC (19th)
  ('2026-04', 13, 1,  17000, 'planned'), -- Apple Card
  ('2026-04', 14, 1,   3000, 'planned'); -- Best Buy

COMMIT;
