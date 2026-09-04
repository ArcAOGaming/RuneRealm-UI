#!/usr/bin/env bash
# Run the RuneRealm test suite on a live HyperBEAM ~lua@5.3a node.
# No wallet, no signing, no cost.  Usage: ./run-test.sh [node-url ...]
#
# It bundles exactly what deploy.mjs deploys, so any construct Luerl rejects —
# goto, string.pack, gmatch("[^,%s]+") — fails here before it reaches a
# deployed process.
set -uo pipefail

# WHICH NODE, and why it is a list.
#
# The whole suite is ONE request — one Lua VM, ~700 messages, state carried in
# globals from the first to the last — so the node has to be willing to hold a
# request open for as long as the suite takes. Several will not, and the way
# they say so is indistinguishable from being down:
#
#   node                       longest request it would serve
#   alpha.neo.zephyrdev.xyz    19.7 s ok; 25.0 s -> 502 from nginx/1.28.1
#   hb.arweave.net             25.1 s -> 572
#   hyperbeam.tylerw.ai        180 s ok (this suite); 301 s -> 504 nginx/1.18.0
#
# Measured 2026-09-02 by POSTing a `~lua@5.3a` script that spins for a known
# number of iterations, so the cut is the gateway's and not the device's — a
# trivial script answers in 0.05 s on alpha.neo, and the whole 738 KB bundle
# LOADS there in 0.6 s. The 502 arrives at a fixed ~25 s with an HTML body and
# no trace of the suite in it, so `LUA_TEST_TIMEOUT` cannot buy past it, and
# raising it (which is what the last person to hit this did) changes nothing.
#
# So: try each node in turn, and tell the difference between "this node hung up
# on us" — try the next — and "the suite reported failures", which is an answer
# and stops here. An explicit argument or LUA_TEST_NODE overrides the list.
if [ "$#" -gt 0 ]; then
  NODES=("$@")
elif [ -n "${LUA_TEST_NODE:-}" ]; then
  NODES=("$LUA_TEST_NODE")
else
  NODES=(https://hyperbeam.tylerw.ai https://alpha.neo.zephyrdev.xyz)
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
AOS="${HYPER_AOS:-$HERE/json.lua}"

if [ ! -f "$AOS" ]; then
  echo "json.lua not found at $AOS" >&2
  exit 1
fi

BUNDLE="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$BUNDLE" "$BODY"' EXIT
{
  cat "$AOS"
  echo "local C = (function()";      cat "$HERE/constants.lua"; echo "end)()"
  cat "$HERE/monster-index.generated.lua"
  echo "local jsonx = (function()";  cat "$HERE/jsonenc.lua";   echo "end)()"
  echo "local encode, jsonObject = jsonx.encode, jsonx.object"
  echo "Battle = (function()";       cat "$HERE/battle.lua";    echo "end)()"
  echo "local EconomyEngine = (function()"; cat "$HERE/economy.lua"; echo "end)()"
  echo "BattleFleetConfig = nil"
  echo "BattleFleetAuthority = (function()"; cat "$HERE/battle-fleet/authority.lua"; echo "end)()"
  cat "$HERE/game.lua"
  cat "$HERE/game_test.lua"
} > "$BUNDLE"

echo "bundle: $(wc -c < "$BUNDLE") bytes"

# The whole suite runs inside ONE request, so the timeout has to cover every
# test rather than a single call. It was 180s, and the suite quietly outgrew it:
# a run that had passed an hour earlier started reporting `curl (28)`, which
# reads exactly like the node being down and is not. Raise LUA_TEST_TIMEOUT
# rather than trimming tests. Note that it only bounds OUR patience — a node
# with its own request ceiling cuts the connection long before this expires.
TIMEOUT="${LUA_TEST_TIMEOUT:-900}"

for NODE in "${NODES[@]}"; do
  echo
  echo "node:   $NODE"
  : > "$BODY"
  META="$(curl -sS -m "$TIMEOUT" -o "$BODY" -w '%{http_code} %{time_total}' \
    -X POST "$NODE/~lua@5.3a/gametest" \
    -H 'content-type: application/lua' --data-binary @"$BUNDLE" 2>&1)" || true
  CODE="${META%% *}"
  ELAPSED="${META##* }"

  # The suite's own verdict is the only thing that ends this loop: `0 failed` is
  # the pass, any other count is a real failure and trying another node would
  # only hide it. It is the last line and nothing else has that shape — a loose
  # `N failed` would also match a JSON extra printed beside a PASS, and the
  # suite prints a great deal of JSON.
  if grep -Eq '^[0-9]+ passed, [0-9]+ failed$' "$BODY"; then
    cat "$BODY"
    echo
    echo "(${ELAPSED}s on $NODE)"
    if grep -Eq '^[0-9]+ passed, 0 failed$' "$BODY"; then exit 0; fi
    echo "game suite did not report zero failures" >&2
    exit 1
  fi

  # No verdict in the body. Either the node cut the request or it answered with
  # something that is not the suite at all — its own HTML landing page is the
  # common one, and it arrives at status 200 as often as not. See CLAUDE.md:
  # treat an HTML body as "absent", everywhere.
  if head -c 200 "$BODY" | grep -qi '<html\|<!doctype'; then
    echo "  $NODE answered HTML, not the suite, after ${ELAPSED}s (status ${CODE})." >&2
    echo "  That is this node's request ceiling, not a test failure." >&2
  elif [ "$CODE" = "000" ] || [ -z "$CODE" ]; then
    echo "  $NODE dropped the connection after ${ELAPSED}s: $META" >&2
  else
    echo "  $NODE answered ${CODE} after ${ELAPSED}s with no suite output:" >&2
    head -c 400 "$BODY" >&2
    echo >&2
  fi
done

echo >&2
echo "no node finished the suite. Every node above either hung up or answered" >&2
echo "something that was not the suite; none of them reported a test failure," >&2
echo "so nothing here says the contract is broken." >&2
echo "Run \`npm run test:lua:local\` for the same assertions offline, or pass a" >&2
echo "node that will hold a request open for the length of the run:" >&2
echo "  ./run-test.sh https://your-node.example" >&2
exit 1
