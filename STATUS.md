# LimoFin Status

**Built:** 2026-04-14
**Stack:** Node 20+ / Express 4 / better-sqlite3 / helmet / node-cron / vanilla HTML + Chart.js
**Port:** 3002
**Deploy target:** Proxmox LXC 105 (`limofin`, 10.117.1.82)
**GitHub:** https://github.com/vados-ue/limofin

---

## File tree

```
limofin/
├── .gitignore
├── README.md
├── STATUS.md
├── package.json
├── package-lock.json
├── server.js
├── data/
│   └── .env.example
├── migrations/
│   └── 001_init.sql
├── seeds/
│   └── seed.sql
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── test/
│   └── api.test.js
└── scripts/
    ├── update.sh
    ├── smoke.sh
    └── limofin.service
```

---

## Tests

All passing against real (non-vendored) deps:

```
> limofin@0.1.0 test
> node --test test/

✔ GET /api/health returns ok
✔ POST /api/bills persists and round-trips
✔ cashflow coverage is based on green earmarks only
✔ deleting a bill cascades to its earmark
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

## Live `curl /api/health`

```
{"ok":true,"version":"0.1.0","db":"up"}
```

---

## Notes

- **Seed data is illustrative, not Andreas' real finances.** Demo scenario: $3000 biweekly paycheck, $1800 mortgage (funded), $450 CC1 (planned), $320 CC2 (unfunded), $140 electric, $15 Netflix. Produces a red/yellow/green dashboard out-of-the-box.
- Monarch Money integration (backlog item, blocked on SSL 525) is not a dependency — LimoFin is manual-entry first.
- `node-cron` is imported but no jobs are scheduled yet. Scaffolded for the "month rollover" feature (carry unfunded earmarks forward).
- The deploy scripts were written after Codex's main pass because the Codex sandbox could not write to `.git/` or bind to ports, so they were handled directly in the orchestration layer using the Bulma Dashboard pattern.

---

## Open TODOs (not blocking deploy)

- [ ] Implement month rollover cron job
- [ ] Add CSV export for expenses
- [ ] Add a "plan next month" view that suggests earmarks automatically
- [ ] Authentication (currently open on local network, matching Bulma pattern)
