#!/usr/bin/env bash
# Run the RuneRealm test suite on a live HyperBEAM ~lua@5.3a node.
# No wallet, no signing, no cost.  Usage: ./run-test.sh [node-url]
#
# It bundles exactly what deploy.mjs deploys, so any construct Luerl rejects —
# goto, string.pack, gmatch("[^,%s]+") — fails here before it reaches a
# deployed process.
set -euo pipefail

# alpha.neo by default: this only needs `~lua@5.3a`, which is free and
# unsigned, and not every node that serves the full process loop will accept a
# bundle this size as a probe body.
NODE="${1:-https://alpha.neo.zephyrdev.xyz}"
HERE="$(cd "$(dirname "$0")" && pwd)"
AOS="${HYPER_AOS:-$HERE/json.lua}"

if [ ! -f "$AOS" ]; then
  echo "json.lua not found at $AOS" >&2
  exit 1
fi

BUNDLE="$(mktemp)"
trap 'rm -f "$BUNDLE"' EXIT
{
  cat "$AOS"
  echo "local C = (function()";      cat "$HERE/constants.lua"; echo "end)()"
  echo "local jsonx = (function()";  cat "$HERE/jsonenc.lua";   echo "end)()"
  echo "local encode, jsonObject = jsonx.encode, jsonx.object"
  echo "Battle = (function()";       cat "$HERE/battle.lua";    echo "end)()"
  echo "local EconomyEngine = (function()"; cat "$HERE/economy.lua"; echo "end)()"
  echo "BattleFleetConfig = nil"
  echo "BattleFleetAuthority = (function()"; cat "$HERE/battle-fleet/authority.lua"; echo "end)()"
  cat "$HERE/game.lua"
  cat "$HERE/game_test.lua"
} > "$BUNDLE"

echo "node:   $NODE"
echo "bundle: $(wc -c < "$BUNDLE") bytes"
echo
# The whole suite runs inside ONE request, so the timeout has to cover every
# test rather than a single call. It was 180s, and the suite quietly outgrew it:
# a run that had passed an hour earlier started reporting `curl (28)`, which
# reads exactly like the node being down and is not. Raise LUA_TEST_TIMEOUT
# rather than trimming tests.
RESULT="$(curl --fail-with-body -sS -m "${LUA_TEST_TIMEOUT:-600}" -X POST "$NODE/~lua@5.3a/gametest" \
  -H 'content-type: application/lua' --data-binary @"$BUNDLE")"
printf '%s\n' "$RESULT"
if ! grep -Eq '(^|[^0-9])0 failed([^0-9]|$)' <<<"$RESULT"; then
  echo "game suite did not report zero failures" >&2
  exit 1
fi
echo
