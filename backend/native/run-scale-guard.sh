#!/usr/bin/env bash
# One gameplay message must cost the same whatever the population.
#
#   bash backend/native/run-scale-guard.sh [node-url]
#
# Free and unsigned, like the rest of the Lua suite: it POSTs the bundle to a
# live `~lua@5.3a` and runs entirely inside that request. Nothing is spawned,
# nothing is scheduled, no slot is paid for.
#
# Exits non-zero when an action's cost scales with the number of players, so it
# can gate a deploy. See scale_guard.lua for what it measures and why it counts
# tables rather than timing anything.
set -euo pipefail
NODE="${1:-http://localhost:8734}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$(mktemp)"
OUTPUT="$(mktemp)"
trap 'rm -f "$BUNDLE" "$OUTPUT"' EXIT
{
  cat "$HERE/json.lua"
  echo "local C = (function()";      cat "$HERE/constants.lua"; echo "end)()"
  cat "$HERE/monster-index.generated.lua"
  echo "C.PUBLIC_ACCESS = true"
  echo "local jsonx = (function()";  cat "$HERE/jsonenc.lua";   echo "end)()"
  echo "local encode, jsonObject = jsonx.encode, jsonx.object"
  echo "Battle = (function()";       cat "$HERE/battle.lua";    echo "end)()"
  echo "local EconomyEngine = (function()"; cat "$HERE/economy.lua"; echo "end)()"
  echo "BattleFleetBootstrapConfig = { enabled = true }"
  echo "BattleFleetConfig = nil"
  echo "BattleFleetAuthority = (function()"
  cat "$HERE/battle-fleet/authority.lua"
  echo "end)()"
  cat "$HERE/game.lua"
  cat "$HERE/scale_guard.lua"
} > "$BUNDLE"
echo "node:   $NODE"
echo "bundle: $(wc -c < "$BUNDLE") bytes"
echo
curl --fail-with-body -sS -m "${LUA_TEST_TIMEOUT:-900}" -X POST "$NODE/~lua@5.3a/scaleguard" \
  -H 'content-type: application/lua' --data-binary @"$BUNDLE" | tee "$OUTPUT"
echo

# The probe reports its own verdict in the body; turn it into an exit status so
# this can gate anything. A body that contains neither verdict means the request
# did not get far enough to have an opinion, which is also a failure.
if grep -q "SCALE GUARD PASSED" "$OUTPUT"; then exit 0; fi
if grep -q "SCALE GUARD FAILED" "$OUTPUT"; then exit 1; fi
echo "scale guard produced no verdict" >&2
exit 2
