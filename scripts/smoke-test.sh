#!/usr/bin/env bash
# Quick smoke test for the deployed Calabogie Safety app.
# Usage: bash scripts/smoke-test.sh
#   Reads CRON_SECRET from .env.local. Requires curl + jq (optional).
set -euo pipefail

URL="${APP_URL:-https://track-scheduler.vercel.app}"
CRON="$(grep '^CRON_SECRET=' .env.local | cut -d= -f2- || true)"

pass=0
fail=0

check() {
  local name="$1"
  local got="$2"
  local want="$3"
  if [[ "$got" == "$want" ]]; then
    echo "  ✓ $name"
    pass=$((pass + 1))
  else
    echo "  ✗ $name (got $got, want $want)"
    fail=$((fail + 1))
  fi
}

echo "▸ Smoke-testing $URL"
echo ""

echo "1. Root redirect"
status=$(curl -s -o /dev/null -w "%{http_code}" "$URL/")
check "GET / returns 307" "$status" "307"

echo "2. Login page renders"
status=$(curl -s -o /tmp/login.html -w "%{http_code}" "$URL/login")
check "GET /login returns 200" "$status" "200"
if grep -q "Calabogie Safety" /tmp/login.html; then
  echo "  ✓ login page contains 'Calabogie Safety'"
  pass=$((pass + 1))
else
  echo "  ✗ login page missing 'Calabogie Safety' string"
  fail=$((fail + 1))
fi

echo "3. RSVP route graceful on invalid token"
status=$(curl -s -o /dev/null -w "%{http_code}" "$URL/r/invalid-token")
check "GET /r/invalid-token returns 200" "$status" "200"

echo "4. Drain-outbox cron auth"
status=$(curl -s -o /dev/null -w "%{http_code}" "$URL/api/jobs/drain-outbox")
check "GET /api/jobs/drain-outbox without auth returns 401" "$status" "401"

if [[ -n "$CRON" ]]; then
  echo "5. Drain-outbox cron with auth"
  resp=$(curl -s -H "Authorization: Bearer $CRON" "$URL/api/jobs/drain-outbox")
  if echo "$resp" | grep -q '"attempted"'; then
    echo "  ✓ Drain endpoint returns expected JSON shape"
    pass=$((pass + 1))
  else
    echo "  ✗ Drain endpoint returned: $resp"
    fail=$((fail + 1))
  fi

  echo "6. Dev-login route gating"
  status=$(curl -s -o /dev/null -w "%{http_code}" "$URL/auth/dev-login")
  check "GET /auth/dev-login without key returns 403" "$status" "403"

  status=$(curl -s -o /dev/null -w "%{http_code}" -L "$URL/auth/dev-login?key=$CRON")
  check "GET /auth/dev-login?key=<CRON> lands 200 (follows redirect to /dashboard)" "$status" "200"
fi

echo ""
echo "─── Summary ─────────────────────────"
echo "  Passed: $pass"
echo "  Failed: $fail"
if [[ $fail -eq 0 ]]; then
  echo "  ✓ All checks passed."
  exit 0
else
  echo "  ✗ Some checks failed."
  exit 1
fi
