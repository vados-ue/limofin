#!/usr/bin/env bash
# smoke.sh — quick health check for LimoFin
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3002}"
MONTH="${MONTH:-$(date +%Y-%m)}"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo "▸ LimoFin smoke check ($BASE_URL)"

curl -sf "$BASE_URL/api/health" >/dev/null || fail "/api/health failed"
ok "/api/health"

curl -sf "$BASE_URL/api/cashflow/$MONTH" >/dev/null || fail "/api/cashflow/$MONTH failed"
ok "/api/cashflow/$MONTH"

echo ""
ok "All smoke checks passed"
