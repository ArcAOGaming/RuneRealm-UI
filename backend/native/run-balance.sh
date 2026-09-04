#!/usr/bin/env bash
# Measure fight length across levels. Free, unsigned, no wallet.
#   ./run-balance.sh              report on the current tuning
#   ./run-balance.sh sweep        search the tuning grid for a better one
set -euo pipefail
MODE="${1:-balance}"
NODE="${2:-https://alpha.neo.zephyrdev.xyz}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$(mktemp)"; trap 'rm -f "$BUNDLE"' EXIT
{
  echo "local C = (function()"; cat "$HERE/constants.lua"; echo "end)()"
  cat "$HERE/monster-index.generated.lua"
  echo "Battle = (function()"; cat "$HERE/battle.lua"; echo "end)()"
  echo "Battle.configure(C)"
  cat "$HERE/balance.lua"
} > "$BUNDLE"
curl -sS -m 300 -X POST "$NODE/~lua@5.3a/$MODE" \
  -H 'content-type: application/lua' --data-binary @"$BUNDLE"
echo
