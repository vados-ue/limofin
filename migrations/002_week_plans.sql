-- 002_week_plans.sql
-- LimoFin v0.2: weekly money plans with checklist steps, spending envelopes,
-- and per-envelope spend entries.
-- This file re-runs on every startup (no migration ledger), so every statement
-- must be idempotent: CREATE ... IF NOT EXISTS only, no ALTER TABLE, and it
-- never touches the v0.1 tables (income_sources, bills, expenses, budgets, earmarks).

CREATE TABLE IF NOT EXISTS week_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL UNIQUE,
  title TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plan_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES week_plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plan_envelopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES week_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  allocated_cents INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_id, name)
);

CREATE TABLE IF NOT EXISTS envelope_spends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id INTEGER NOT NULL REFERENCES plan_envelopes(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  memo TEXT,
  date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_envelopes_plan ON plan_envelopes(plan_id);
CREATE INDEX IF NOT EXISTS idx_envelope_spends_envelope ON envelope_spends(envelope_id);
