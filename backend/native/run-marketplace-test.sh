#!/usr/bin/env bash
# Run the companion-index, AMM and quote-token suites on a live ~lua@5.3a
# device. The index is no longer deployed; the live companion market is in
# game.lua and `npm run test:lua` covers it.
# No process is spawned and no wallet is used.
set -euo pipefail

NODE="${1:-https://alpha.neo.zephyrdev.xyz}"
HERE="$(cd "$(dirname "$0")" && pwd)"
AOS="${HYPER_AOS:-$HERE/json.lua}"

run_suite() {
  local contract="$1" testfile="$2" entry="$3"
  local bundle
  bundle="$(mktemp)"
  {
    cat "$AOS"
    echo "local jsonx = (function()"; cat "$HERE/jsonenc.lua"; echo "end)()"
    echo "local encode, jsonObject = jsonx.encode, jsonx.object"
    cat "$HERE/$contract"
    cat "$HERE/$testfile"
  } > "$bundle"
  echo "== $contract ($(wc -c < "$bundle") bytes) =="
  local result
  result="$(curl --fail-with-body -sS -m "${LUA_TEST_TIMEOUT:-600}" -X POST "$NODE/~lua@5.3a/$entry" \
    -H 'content-type: application/lua' --data-binary @"$bundle")"
  printf '%s\n' "$result"
  if ! grep -Eq '(^|[^0-9])0 failed([^0-9]|$)' <<<"$result"; then
    echo "$contract suite did not report zero failures" >&2
    rm -f "$bundle"
    return 1
  fi
  echo
  rm -f "$bundle"
}

echo "node: $NODE"
echo
run_suite amm.lua amm_test.lua ammtest
run_suite quote.lua quote_test.lua quotetest
