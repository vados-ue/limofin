#!/usr/bin/env bash
# update.sh — LimoFin updater
# Mirrors the Bulma Dashboard update pattern.
# Run on the install host as root: sudo bash /opt/limofin/scripts/update.sh

set -euo pipefail

INSTALL_DIR=/opt/limofin
DATA_DIR="$INSTALL_DIR/data"
DB_FILE="$DATA_DIR/limofin.db"
ENV_FILE="$DATA_DIR/.env"
SERVICE=limofin
PORT=3002

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  LimoFin — Update"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Pre-flight
echo "▸ Pre-flight checks"
[[ $EUID -eq 0 ]] || fail "Must run as root (sudo bash scripts/update.sh)"
[[ -d "$INSTALL_DIR" ]] || fail "Install dir missing: $INSTALL_DIR"
command -v node    >/dev/null || fail "node not installed"
command -v npm     >/dev/null || fail "npm not installed"
command -v git     >/dev/null || fail "git not installed"
command -v sqlite3 >/dev/null || fail "sqlite3 not installed"
ok "Pre-flight passed"
echo ""

# Backup DB
if [[ -f "$DB_FILE" ]]; then
  BACKUP="$DATA_DIR/limofin.pre-update.db"
  sqlite3 "$DB_FILE" ".backup $BACKUP" || fail "DB backup failed"
  ok "Backed up DB → $(basename "$BACKUP")"
else
  warn "No DB yet — first run, skipping backup"
fi
echo ""

# Stop service
echo "▸ Stopping service"
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  systemctl stop "$SERVICE"
  ok "Service stopped"
else
  warn "Service '$SERVICE' not running"
fi
if command -v fuser >/dev/null && fuser "$PORT/tcp" >/dev/null 2>&1; then
  warn "Stray process on port $PORT — killing"
  fuser -k "$PORT/tcp" 2>/dev/null || true
  sleep 1
fi
echo ""

# Pull
echo "▸ Pulling latest code"
BEFORE=$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
git -C "$INSTALL_DIR" pull origin main || fail "git pull failed"
AFTER=$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
if [[ "$BEFORE" != "$AFTER" ]]; then
  echo "  Changes:"
  git -C "$INSTALL_DIR" log --oneline "$BEFORE..$AFTER" | sed 's/^/    /'
  ok "Code updated"
else
  warn "No new commits"
fi
echo ""

# Ensure .env
echo "▸ Ensuring .env"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$DATA_DIR/.env.example" "$ENV_FILE"
  ok "Created $ENV_FILE from example"
else
  ok ".env exists"
fi
echo ""

# Install deps
echo "▸ Installing dependencies"
cd "$INSTALL_DIR"
npm ci --omit=dev 2>&1 | tail -5
ok "Dependencies installed"
echo ""

# Start
echo "▸ Starting service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl start "$SERVICE"
sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  ok "Service running"
else
  fail "Service failed to start — check: journalctl -u $SERVICE -n 50"
fi
echo ""

# Verify
echo "▸ Health check"
if curl -sf "http://localhost:$PORT/api/health" >/dev/null; then
  ok "LimoFin is healthy on port $PORT"
else
  fail "Health check failed"
fi
echo ""

# Apply plan seeds (apply-once guarded, safe to re-run).
# Runs after the service is up so migrations have created the tables.
#
# Seeds are named plan_YYYY-MM-DD.sql (the plan's week_start) and their
# apply-once guard keys on week_start alone, so ANY pre-existing plan for
# that week (even a placeholder with a different title) makes the whole
# file a silent no-op. We detect that case and report "Skipped", never
# "Applied", so a no-op cannot masquerade as a successful seed. Seeds whose
# week has already ended are skipped entirely, so deleting an old plan in
# the UI does not resurrect it on the next deploy.
#
# NOTE for operators: never delete week_plans rows with the bare sqlite3
# CLI — it defaults PRAGMA foreign_keys OFF and orphans rows in
# plan_steps/plan_envelopes/envelope_spends/plan_meta/plan_runway_points/
# plan_flags. Use DELETE /api/plans/:id (cascades correctly), or prefix
# any CLI delete with "PRAGMA foreign_keys=ON;".
echo "▸ Applying plan seeds"
if [[ -f "$DB_FILE" ]]; then
  SEED_COUNT=0
  TODAY=$(date +%F)
  for seed in "$INSTALL_DIR"/seeds/plan_*.sql; do
    [[ -e "$seed" ]] || continue
    SEED_NAME=$(basename "$seed")
    WEEK_START="${SEED_NAME#plan_}"
    WEEK_START="${WEEK_START%.sql}"
    if [[ ! "$WEEK_START" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
      warn "Skipped $SEED_NAME — name is not plan_YYYY-MM-DD.sql, cannot verify; apply manually if intended"
      continue
    fi
    WEEK_END=$(date -d "$WEEK_START +6 days" +%F)
    if [[ "$WEEK_END" < "$TODAY" ]]; then
      warn "Skipped $SEED_NAME — week ended $WEEK_END (expired seeds never re-apply)"
      continue
    fi
    EXISTING_TITLE=$(sqlite3 "$DB_FILE" ".timeout 5000" \
      "SELECT title FROM week_plans WHERE week_start = '$WEEK_START' LIMIT 1")
    if [[ -n "$EXISTING_TITLE" ]]; then
      warn "Skipped $SEED_NAME — a plan for $WEEK_START already exists ('$EXISTING_TITLE') and the apply-once guard will not overwrite it. To land this seed: DELETE /api/plans/:id on that plan, then: sqlite3 $DB_FILE < $seed"
      continue
    fi
    sqlite3 "$DB_FILE" ".timeout 5000" ".read $seed" || fail "Seed apply failed: $SEED_NAME"
    LANDED=$(sqlite3 "$DB_FILE" ".timeout 5000" \
      "SELECT COUNT(*) FROM week_plans WHERE week_start = '$WEEK_START'")
    if [[ "$LANDED" -gt 0 ]]; then
      ok "Applied $SEED_NAME"
      SEED_COUNT=$((SEED_COUNT + 1))
    else
      fail "Seed ran but no plan landed for week $WEEK_START: $SEED_NAME"
    fi
  done
  [[ $SEED_COUNT -gt 0 ]] || warn "No plan seeds applied this run"
else
  warn "DB missing after start — skipped plan seeds"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Update complete — LimoFin v$(node -p "require('./package.json').version")"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
