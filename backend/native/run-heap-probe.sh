#!/usr/bin/env bash
# Measure Luerl heap growth per message for the deployed bundle. Free, unsigned.
#   bash backend/native/run-heap-probe.sh [node-url]
set -euo pipefail
NODE="${1:-https://alpha.neo.zephyrdev.xyz}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$(mktemp)"
trap 'rm -f "$BUNDLE"' EXIT
{
  cat "$HERE/json.lua"
  echo "local C = (function()";      cat "$HERE/constants.lua"; echo "end)()"
  cat "$HERE/monster-index.generated.lua"
  echo "local jsonx = (function()";  cat "$HERE/jsonenc.lua";   echo "end)()"
  echo "local encode, jsonObject = jsonx.encode, jsonx.object"
  echo "Battle = (function()";       cat "$HERE/battle.lua";    echo "end)()"
  echo "local EconomyEngine = (function()"; cat "$HERE/economy.lua"; echo "end)()"
  cat "$HERE/game.lua"
  cat "$HERE/heap_probe.lua"
} > "$BUNDLE"
echo "node:   $NODE"
echo "bundle: $(wc -c < "$BUNDLE") bytes"
echo
curl --fail-with-body -sS -m "${LUA_TEST_TIMEOUT:-600}" -X POST "$NODE/~lua@5.3a/heapprobe" \
  -H 'content-type: application/lua' --data-binary @"$BUNDLE"
echo
