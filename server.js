const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');
const cron = require('node-cron');

dotenv.config({ path: path.join(__dirname, 'data', '.env') });

const VERSION = '0.1.0';
const DEFAULT_PORT = Number(process.env.PORT || 3002);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SEED_PATH = path.join(__dirname, 'seeds', 'seed.sql');

const TABLE_CONFIG = {
  bills: {
    table: 'bills',
    fields: ['name', 'category', 'amount_cents', 'due_day_of_month', 'recurring', 'funded_from_source_id', 'autopay', 'notes'],
    required: ['name', 'amount_cents']
  },
  sources: {
    table: 'income_sources',
    fields: ['name', 'type', 'amount_cents', 'frequency', 'next_date', 'notes'],
    required: ['name', 'amount_cents']
  },
  expenses: {
    table: 'expenses',
    fields: ['date', 'amount_cents', 'category', 'description', 'source'],
    required: ['date', 'amount_cents']
  },
  budgets: {
    table: 'budgets',
    fields: ['month', 'category', 'limit_cents'],
    required: ['month', 'category', 'limit_cents']
  },
  earmarks: {
    table: 'earmarks',
    fields: ['month', 'bill_id', 'source_id', 'amount_cents', 'status'],
    required: ['month', 'bill_id', 'amount_cents']
  }
};

let activeServer = null;
let activeDb = null;

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function listSqlFiles(dirPath) {
  return fs.readdirSync(dirPath)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

function countSeedRows(db) {
  const tables = ['income_sources', 'bills', 'expenses', 'budgets', 'earmarks'];
  return tables.reduce((sum, table) => {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    return sum + row.count;
  }, 0);
}

function applySqlFile(db, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  if (sql.trim()) {
    db.exec(sql);
  }
}

function runMigrations(db) {
  for (const file of listSqlFiles(MIGRATIONS_DIR)) {
    applySqlFile(db, path.join(MIGRATIONS_DIR, file));
  }
}

function maybeSeedDatabase(db, options = {}) {
  const rowCount = countSeedRows(db);
  if (rowCount === 0 && !options.skipSeed) {
    applySqlFile(db, SEED_PATH);
  }
}

function openDatabase(dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'limofin.db'), options = {}) {
  ensureDirectory(dbPath);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  maybeSeedDatabase(db, options);
  return db;
}

function coerceValue(value) {
  return value === '' ? null : value;
}

function validatePayload(payload, config, isUpdate = false) {
  const filtered = {};
  for (const field of config.fields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      filtered[field] = coerceValue(payload[field]);
    }
  }

  if (!isUpdate) {
    for (const field of config.required) {
      if (filtered[field] === undefined || filtered[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }

  if (isUpdate && Object.keys(filtered).length === 0) {
    throw new Error('No valid fields supplied');
  }

  return filtered;
}

function insertRow(db, table, values) {
  const fields = Object.keys(values);
  const placeholders = fields.map((field) => `@${field}`).join(', ');
  const sql = `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`;
  const info = db.prepare(sql).run(values);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
}

function updateRow(db, table, id, values) {
  const fields = Object.keys(values);
  const assignments = fields.map((field) => `${field} = @${field}`).join(', ');
  const sql = `UPDATE ${table} SET ${assignments} WHERE id = @id`;
  const info = db.prepare(sql).run({ ...values, id });
  if (info.changes === 0) {
    return null;
  }
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

function buildCrudRouter(db, config) {
  const router = express.Router();
  const { table } = config;

  router.get('/', (_req, res) => {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    res.json(rows);
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(row);
  });

  router.post('/', (req, res) => {
    try {
      const values = validatePayload(req.body, config);
      const row = insertRow(db, table, values);
      res.status(201).json(row);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.put('/:id', (req, res) => {
    try {
      const values = validatePayload(req.body, config, true);
      const row = updateRow(db, table, req.params.id, values);
      if (!row) {
        return res.status(404).json({ error: 'Not found' });
      }
      return res.json(row);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.delete('/:id', (req, res) => {
    const info = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json({ ok: true });
  });

  return router;
}

function monthBounds(month) {
  return {
    month,
    firstDay: `${month}-01`
  };
}

function expectedIncomeForMonth(db, month) {
  const sources = db.prepare(`
    SELECT id AS source_id, name, amount_cents, frequency, next_date
    FROM income_sources
    ORDER BY id
  `).all();

  return sources.flatMap((source) => {
    if (!source.next_date) {
      return [];
    }

    if (source.frequency === 'monthly' || source.frequency === 'oneoff') {
      return source.next_date.startsWith(month)
        ? [{ source_id: source.source_id, name: source.name, amount_cents: source.amount_cents, expected_date: source.next_date }]
        : [];
    }

    if (source.frequency === 'biweekly' || source.frequency === 'weekly') {
      const intervalDays = source.frequency === 'weekly' ? 7 : 14;
      const events = [];
      let current = new Date(`${source.next_date}T00:00:00Z`);
      const monthStart = new Date(`${month}-01T00:00:00Z`);
      const [year, monthNumber] = month.split('-').map(Number);
      const monthEnd = new Date(Date.UTC(year, monthNumber, 0));

      while (current < monthStart) {
        current.setUTCDate(current.getUTCDate() + intervalDays);
      }

      while (current <= monthEnd) {
        const iso = current.toISOString().slice(0, 10);
        if (iso.startsWith(month)) {
          events.push({
            source_id: source.source_id,
            name: source.name,
            amount_cents: source.amount_cents,
            expected_date: iso
          });
        } else if (iso.slice(0, 7) > month) {
          break;
        }
        current.setUTCDate(current.getUTCDate() + intervalDays);
      }

      return events;
    }

    return source.next_date.startsWith(month)
      ? [{ source_id: source.source_id, name: source.name, amount_cents: source.amount_cents, expected_date: source.next_date }]
      : [];
  });
}

function buildCashflow(db, month) {
  const income = expectedIncomeForMonth(db, month);
  const incomeTotal = income.reduce((sum, entry) => sum + entry.amount_cents, 0);

  const bills = db.prepare(`
    SELECT
      b.id AS bill_id,
      b.name,
      b.amount_cents,
      b.category,
      printf('%s-%02d', ?, b.due_day_of_month) AS due_date,
      e.status AS earmark_status,
      e.amount_cents AS earmark_amount_cents,
      s.name AS source_name
    FROM bills b
    LEFT JOIN earmarks e
      ON e.bill_id = b.id
      AND e.month = ?
    LEFT JOIN income_sources s
      ON s.id = e.source_id
    ORDER BY b.due_day_of_month, b.id
  `).all(month, month);

  let fundedAmount = 0;
  const normalizedBills = bills.map((bill) => {
    let light = 'red';
    let earmark = null;

    if (bill.earmark_status === 'funded' || bill.earmark_status === 'paid') {
      light = 'green';
      fundedAmount += bill.earmark_amount_cents || 0;
      earmark = { status: bill.earmark_status, source_name: bill.source_name };
    } else if (bill.earmark_status === 'planned') {
      light = 'yellow';
      earmark = { status: bill.earmark_status, source_name: bill.source_name };
    }

    return {
      bill_id: bill.bill_id,
      name: bill.name,
      amount_cents: bill.amount_cents,
      due_date: bill.due_date,
      earmark,
      light
    };
  });

  const billsTotal = normalizedBills.reduce((sum, bill) => sum + bill.amount_cents, 0);
  const coveragePct = billsTotal === 0 ? 0 : Math.round((fundedAmount / billsTotal) * 100);

  return {
    month,
    income,
    income_total_cents: incomeTotal,
    bills: normalizedBills,
    bills_total_cents: billsTotal,
    delta_cents: incomeTotal - billsTotal,
    coverage_pct: coveragePct
  };
}

function createApp(options = {}) {
  const db = options.db || openDatabase(options.dbPath, { skipSeed: options.skipSeed });
  const app = express();

  cron.schedule('0 2 * * *', () => {}, { scheduled: false }).stop();

  app.use(helmet({
    contentSecurityPolicy: false
  }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: VERSION, db: 'up' });
  });

  app.use('/api/bills', buildCrudRouter(db, TABLE_CONFIG.bills));
  app.use('/api/sources', buildCrudRouter(db, TABLE_CONFIG.sources));
  app.use('/api/expenses', buildCrudRouter(db, TABLE_CONFIG.expenses));
  app.use('/api/budgets', buildCrudRouter(db, TABLE_CONFIG.budgets));
  app.use('/api/earmarks', buildCrudRouter(db, TABLE_CONFIG.earmarks));

  app.get('/api/cashflow/:month', (req, res) => {
    if (!/^\d{4}-\d{2}$/.test(req.params.month)) {
      return res.status(400).json({ error: 'Month must be YYYY-MM' });
    }

    try {
      const result = buildCashflow(db, req.params.month);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.locals.db = db;
  return app;
}

function closeResources() {
  if (activeServer) {
    activeServer.close();
    activeServer = null;
  }
  if (activeDb) {
    activeDb.close();
    activeDb = null;
  }
}

function registerSignalHandlers() {
  const shutdown = (signal) => {
    if (activeServer) {
      activeServer.close(() => {
        if (activeDb) {
          activeDb.close();
          activeDb = null;
        }
        process.exit(signal === 'SIGINT' ? 130 : 0);
      });
    } else {
      if (activeDb) {
        activeDb.close();
        activeDb = null;
      }
      process.exit(signal === 'SIGINT' ? 130 : 0);
    }
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

function startServer(options = {}) {
  const db = options.db || openDatabase(options.dbPath, { skipSeed: options.skipSeed });
  const port = options.port || DEFAULT_PORT;
  const app = createApp({ db });
  activeDb = db;
  activeServer = app.listen(port, () => {
    console.log(`LimoFin listening on http://localhost:${port}`);
  });
  registerSignalHandlers();
  return { app, db, server: activeServer };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  VERSION,
  buildCashflow,
  closeResources,
  createApp,
  openDatabase,
  runMigrations,
  startServer
};
