#!/usr/bin/env bash
# Run the Rune token suite on a live HyperBEAM ~lua@5.3a node.
# No wallet, no signing, no cost.  Usage: ./run-rune-test.sh [node-url]
#
# It bundles exactly what deploy-rune.mjs deploys, so any construct Luerl
# rejects — goto, string.pack, gmatch("[^,%s]+") — fails here before it reaches
# a deployed process.
set -euo pipefail

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
  echo "local jsonx = (function()";  cat "$HERE/jsonenc.lua";   echo "end)()"
  echo "local encode, jsonObject = jsonx.encode, jsonx.object"
  cat "$HERE/rune.lua"
  cat "$HERE/rune_test.lua"
} > "$BUNDLE"

echo "node:   $NODE"
echo "bundle: $(wc -c < "$BUNDLE") bytes"
echo
RESULT="$(curl --fail-with-body -sS -m "${LUA_TEST_TIMEOUT:-600}" -X POST "$NODE/~lua@5.3a/runetest" \
  -H 'content-type: application/lua' --data-binary @"$BUNDLE")"
printf '%s\n' "$RESULT"
if ! grep -Eq '(^|[^0-9])0 failed([^0-9]|$)' <<<"$RESULT"; then
  echo "Rune suite did not report zero failures" >&2
  exit 1
fi
echo
