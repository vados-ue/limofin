-- 003_plan_details.sql
-- LimoFin v0.2.1: plan verdict, cash floor, runway projection points, and
-- severity-tagged flags for the week plan view.
-- This file re-runs on every startup (no migration ledger), so every statement
-- must be idempotent: CREATE ... IF NOT EXISTS only, no ALTER TABLE. That is
-- why verdict and floor_cents live in a 1:1 plan_meta table instead of new
-- columns on week_plans (ALTER TABLE ADD COLUMN would fail on re-apply).

CREATE TABLE IF NOT EXISTS plan_meta (
  plan_id INTEGER PRIMARY KEY REFERENCES week_plans(id) ON DELETE CASCADE,
  verdict TEXT,
  floor_cents INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plan_runway_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES week_plans(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plan_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES week_plans(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  severity TEXT NOT NULL CHECK(severity IN ('info', 'warn', 'danger')),
  text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plan_runway_points_plan ON plan_runway_points(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_flags_plan ON plan_flags(plan_id);
