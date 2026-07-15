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
│   ├── 001_init.sql
│   ├── 002_week_plans.sql
│   └── 003_plan_details.sql
├── seeds/
│   ├── seed.sql
│   ├── real_seed_2026-04-18.sql
│   └── plan_2026-07-15.sql
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── test/
│   ├── index.js
│   ├── api.test.js
│   └── plans.test.js
└── scripts/
    ├── update.sh
    ├── smoke.sh
    └── limofin.service
```

---

## Tests

All passing against real (non-vendored) deps:

```
> limofin@0.2.1 test
> node --test test/

✔ GET /api/health returns ok
✔ POST /api/bills persists and round-trips
✔ cashflow coverage is based on green earmarks only
✔ deleting a bill cascades to its earmark
✔ GET /api/health reports version 0.2.1
✔ GET /api/plans/current returns 404 when no plan exists, list is empty
✔ POST /api/plans round-trips plan, steps, and envelopes
✔ PATCH /api/steps/:id sets and toggles done
✔ POST envelope spends roll up spent and remaining cents
✔ DELETE /api/spends/:id removes the spend and updates the rollup
✔ deleting a plan cascades to steps, envelopes, and spends
✔ plan seed file is idempotent across repeated applies
✔ POST /api/plans round-trips verdict, floor, runway, and flags
✔ plan detail validation rejects bad severity and unsafe cents
✔ plans created without details return null verdict and empty arrays
✔ seed populates the Payday week plan exactly
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

## Live `curl /api/health`

```
{"ok":true,"version":"0.2.1","db":"up"}
```

---

## Notes

- **Seed data is illustrative, not Andreas' real finances.** Demo scenario: $3000 biweekly paycheck, $1800 mortgage (funded), $450 CC1 (planned), $320 CC2 (unfunded), $140 electric, $15 Netflix. Produces a red/yellow/green dashboard out-of-the-box.
- Monarch Money integration (backlog item, blocked on SSL 525) is not a dependency — LimoFin is manual-entry first.
- **Deleting a week plan: use the API, not the sqlite3 CLI.** `DELETE /api/plans/:id` cascades to steps, envelopes, spends, meta, runway points, and flags. The bare sqlite3 CLI defaults `PRAGMA foreign_keys` OFF and leaves orphaned child rows; if the CLI must be used, prefix the delete with `PRAGMA foreign_keys=ON;`.
- **Week-plan seeds (`seeds/plan_YYYY-MM-DD.sql`) no-op when any plan already exists for that week.** To replace a placeholder plan with a seeded one, delete the placeholder via the API before running `scripts/update.sh`. The updater prints "Skipped" (with the blocking plan's title) instead of a false "Applied", and never re-applies a seed once its week has ended.
- `node-cron` is imported but no jobs are scheduled yet. Scaffolded for the "month rollover" feature (carry unfunded earmarks forward).
- The deploy scripts were written after Codex's main pass because the Codex sandbox could not write to `.git/` or bind to ports, so they were handled directly in the orchestration layer using the Bulma Dashboard pattern.

---

## Open TODOs (not blocking deploy)

- [ ] Implement month rollover cron job
- [ ] Add CSV export for expenses
- [ ] Add a "plan next month" view that suggests earmarks automatically
- [ ] Authentication (currently open on local network, matching Bulma pattern)
