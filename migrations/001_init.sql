CREATE TABLE IF NOT EXISTS income_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('paycheck','transfer','freelance','other')),
  amount_cents INTEGER NOT NULL,
  frequency TEXT CHECK(frequency IN ('weekly','biweekly','monthly','quarterly','annual','oneoff')),
  next_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT CHECK(category IN ('cc','mortgage','utility','insurance','subscription','loan','other')),
  amount_cents INTEGER NOT NULL,
  due_day_of_month INTEGER,
  recurring INTEGER DEFAULT 1,
  funded_from_source_id INTEGER REFERENCES income_sources(id),
  autopay INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category TEXT,
  description TEXT,
  source TEXT CHECK(source IN ('manual','import')) DEFAULT 'manual',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  category TEXT NOT NULL,
  limit_cents INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(month, category)
);

CREATE TABLE IF NOT EXISTS earmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES income_sources(id),
  amount_cents INTEGER NOT NULL,
  status TEXT CHECK(status IN ('planned','funded','paid')) DEFAULT 'planned',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(month, bill_id)
);
