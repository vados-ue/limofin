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

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Update complete — LimoFin v$(node -p "require('./package.json').version")"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
