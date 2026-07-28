-- 004_receipts.sql
-- LimoFin v0.3: receipt captures from the companion PWA. A receipt is a
-- stored photo plus (optionally) an AI-parsed suggestion. Committing a
-- receipt writes an envelope_spend and/or an expense row and links back here.
-- This file re-runs on every startup (no migration ledger), so every statement
-- must be idempotent: CREATE ... IF NOT EXISTS only, no ALTER TABLE.

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','committed','dismissed')) DEFAULT 'pending',
  merchant TEXT,
  purchase_date TEXT,
  total_cents INTEGER,
  parse_json TEXT,
  model TEXT,
  spend_id INTEGER REFERENCES envelope_spends(id) ON DELETE SET NULL,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
