-- DEMO DATA ONLY: illustrative values, not real financial data
INSERT INTO income_sources (name, type, amount_cents, frequency, next_date, notes)
VALUES
  ('Primary Paycheck', 'paycheck', 300000, 'biweekly', '2026-04-18', 'Main payroll deposit'),
  ('Monthly Transfer', 'transfer', 50000, 'monthly', '2026-04-03', 'Savings top-up');

INSERT INTO bills (name, category, amount_cents, due_day_of_month, recurring, funded_from_source_id, autopay, notes)
VALUES
  ('Mortgage', 'mortgage', 180000, 1, 1, 1, 1, 'Home loan payment'),
  ('CC1', 'cc', 45000, 15, 1, 1, 0, 'Primary credit card'),
  ('CC2', 'cc', 32000, 22, 1, NULL, 0, 'Backup credit card'),
  ('Electric', 'utility', 14000, 10, 1, NULL, 1, 'Power utility bill'),
  ('Netflix', 'subscription', 1500, 5, 1, NULL, 1, 'Streaming subscription');

INSERT INTO budgets (month, category, limit_cents)
VALUES
  ('2026-04', 'cc', 80000);

INSERT INTO earmarks (month, bill_id, source_id, amount_cents, status)
VALUES
  ('2026-04', 1, 1, 180000, 'funded'),
  ('2026-04', 2, 1, 45000, 'planned');

