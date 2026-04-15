# LimoFin

**LimoFin solves the "bill is due but I didn't earmark the money" problem.**

Knowing a bill is coming is not enough if you haven't planned where the money comes from. LimoFin makes that plan visible. For every upcoming bill, you see a traffic-light status:

- 🟢 **Funded** — earmarked from a specific income source, money is (or will be) set aside
- 🟡 **Planned** — earmark exists but not yet funded
- 🔴 **Unfunded** — no plan, no source assigned

No Plaid, no Monarch, no bank OAuth. Manual-entry first, zero external dependencies. You own the data.

---

## Features

- Bills, income sources, expenses, budgets, earmarks — simple normalized SQLite schema
- **Cash flow forecast** for any month: income vs. bills, coverage %, per-bill traffic light
- Category-based bill breakdown (doughnut chart) and 6-month cash flow trend (line chart)
- Quick-action modals for adding bills, sources, and expenses
- Dark, single-page UI — no build step, no framework lock-in
- Deploy pattern mirrors Bulma Dashboard — `scripts/update.sh` handles backup, git pull, npm ci, migrate, restart, health-check

---

## Stack

| Component | Version |
|-----------|---------|
| Node.js | >=20 |
| Express | 4.x |
| better-sqlite3 | 12.x (WAL mode) |
| helmet + dotenv | current |
| node-cron | 4.x (scaffolded for earmark rollover) |
| Frontend | vanilla HTML/CSS/JS + Chart.js 4 (CDN) |

Default port: **3002**

---

## Install

```bash
# On the deploy host (e.g. a Proxmox LXC running Debian 12)
sudo apt update && sudo apt install -y git nodejs npm sqlite3 curl
sudo git clone https://github.com/vados-ue/limofin.git /opt/limofin
cd /opt/limofin
sudo cp data/.env.example data/.env
sudo npm ci --omit=dev
sudo cp scripts/limofin.service /etc/systemd/system/limofin.service
sudo systemctl daemon-reload
sudo systemctl enable --now limofin
curl http://localhost:3002/api/health
```

For updates:

```bash
sudo bash /opt/limofin/scripts/update.sh
```

---

## API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET`  | `/api/health` | Service status |
| `GET`  | `/api/bills` | List bills |
| `POST` | `/api/bills` | Create bill |
| `PUT`  | `/api/bills/:id` | Update bill |
| `DELETE` | `/api/bills/:id` | Delete bill (cascades earmark) |
| `GET`  | `/api/sources` | List income sources |
| `POST` | `/api/sources` | Create income source |
| `GET`  | `/api/expenses` | List expenses |
| `POST` | `/api/expenses` | Create expense |
| `GET`  | `/api/budgets/:month` | Budget rows for month |
| `POST` | `/api/budgets` | Create budget row |
| `GET`  | `/api/earmarks/:month` | Earmarks for month |
| `POST` | `/api/earmarks` | Create earmark |
| **`GET`** | **`/api/cashflow/:month`** | **The killer endpoint — forecast with traffic-light status per bill, total coverage %** |

### Cash flow response shape

```json
{
  "month": "2026-04",
  "income": [ { "source_id": 1, "name": "Paycheck", "amount_cents": 300000 } ],
  "income_total_cents": 600000,
  "bills": [
    {
      "bill_id": 1,
      "name": "Mortgage",
      "amount_cents": 180000,
      "earmark": { "status": "funded", "source_name": "Paycheck" },
      "light": "green"
    }
  ],
  "bills_total_cents": 272500,
  "delta_cents": 327500,
  "coverage_pct": 66
}
```

---

## Development

```bash
npm install
npm test          # node:test + supertest, covers cashflow coverage math + cascade delete
npm start         # starts on port 3002 (override with PORT=xxxx)
bash scripts/smoke.sh   # curl /api/health + /api/cashflow for current month
```

Data lives in `data/limofin.db` (WAL mode) and is **not** in git. `data/.env` is also ignored.

---

## Credits

Built 2026-04-14 by Andreas Limones + Claude (orchestrator) + Codex (Backend/Frontend/QA engineering). Deployed on Proxmox LXC 105.

Solves a pain point Andreas flagged in his 2026 Goal Review: *"CC payments due without funds earmarked — knowing a bill is coming isn't enough if you haven't planned the source."*
