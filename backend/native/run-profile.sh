#!/usr/bin/env bash
# Where a message's time goes. Free, unsigned, creates nothing.
#   bash backend/native/run-profile.sh [node-url] [players]
#
# Runs the bundle in several variants: once whole, and once each with a publish
# block stubbed out. Each printed value is a three-repeat median with its range.
# Treat a between-variant difference as signal only when it is larger than the
# reported repeat dispersion. These Lua CPU measurements do not include
# scheduler queueing, HTTP latency or HyperBEAM snapshot I/O.
set -euo pipefail
NODE="${1:-https://alpha.neo.zephyrdev.xyz}"
PLAYERS="${2:-50}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# Windows python cannot open the shell's /c/... paths, so every python step below
# works from the repo root with relative paths.
cd "$HERE/../.."
REL="backend/native"

cleanup () {
  rm -f "$HERE/.profile-game.lua" "$HERE/.profile-probe.lua" \
    "$HERE/.profile-rows.json"
}
trap cleanup EXIT

python - "$PLAYERS" <<'PY'
import io, json, sys
try:
    n = int(sys.argv[1])
except ValueError as exc:
    raise SystemExit('players must be an integer') from exc
if n < 0 or n > 10000:
    raise SystemExit('players must be an integer from 0 to 10000')
d = json.load(io.open('backend/native/legacy-players.json', encoding='utf-8'))
rows = d['players'] if isinstance(d, dict) else d
if n > len(rows):
    raise SystemExit('players %d exceeds fixture size %d' % (n, len(rows)))
io.open('backend/native/.profile-rows.json', 'w', encoding='utf-8').write(
    json.dumps({'players': rows[:n]}, separators=(',', ':')))
PY

variant () {              # $1 label, $2 sed program, $3 expected changed lines
  local label="$1" prog="$2" expected="$3"
  local game="$HERE/.profile-game.lua"
  if [ -z "$prog" ]; then cp "$HERE/game.lua" "$game"; else sed "$prog" "$HERE/game.lua" > "$game"; fi
  local added=0 deleted=0 ignored=""
  if [ "$expected" -gt 0 ]; then
    # A sed expression that stopped matching used to produce a plausible
    # "variant" identical to whole. Require exactly the intended line count.
    read -r added deleted ignored < <(
      git diff --no-index --numstat -- "$HERE/game.lua" "$game" || true
    )
    if [ "${added:-0}" -ne "$expected" ] || [ "${deleted:-0}" -ne "$expected" ]; then
      echo "variant '$label' rewrote ${added:-0}/${deleted:-0} lines; expected $expected" >&2
      return 1
    fi
  fi
  local probe="$HERE/.profile-probe.lua"
  python - <<PY
import io
rows = io.open('$REL/.profile-rows.json', encoding='utf-8').read()
src  = io.open('$REL/profile_compute.lua', encoding='utf-8').read()
if src.count('__PAYLOAD__') != 1:
    raise SystemExit('profile_compute.lua must contain exactly one __PAYLOAD__ marker')
io.open('$REL/.profile-probe.lua', 'w', encoding='utf-8').write(src.replace('__PAYLOAD__', rows))
PY
  local bundle; bundle="$(mktemp)"
  {
    cat "$HERE/json.lua"
    echo "local C = (function()";      cat "$HERE/constants.lua"; echo "end)()"
    echo "local jsonx = (function()";  cat "$HERE/jsonenc.lua";   echo "end)()"
    echo "local encode, jsonObject = jsonx.encode, jsonx.object"
    echo "Battle = (function()";       cat "$HERE/battle.lua";    echo "end)()"
    echo "local EconomyEngine = (function()"; cat "$HERE/economy.lua"; echo "end)()"
    cat "$game"
    cat "$probe"
  } > "$bundle"
  echo "── $label"
  local output
  if ! output="$(curl --fail-with-body -sS -m "${LUA_TEST_TIMEOUT:-600}" \
      -X POST "$NODE/~lua@5.3a/profile" \
      -H 'content-type: application/lua' --data-binary @"$bundle")"; then
    rm -f "$bundle"
    echo "profile request failed for variant: $label" >&2
    return 1
  fi
  rm -f "$bundle"
  printf '%s\n' "$output"
  local measured
  measured="$(grep -Ec 'us/msg[[:space:]]+x[0-9]+ x3 repeats.*range [0-9.]+\.\.[0-9.]+ us/msg' <<<"$output" || true)"
  if [ "$measured" -ne 3 ] || ! grep -q '^measurements: 3$' <<<"$output" \
      || ! grep -q '^repeats: 3$' <<<"$output" \
      || ! grep -q "^fixture players: $PLAYERS$" <<<"$output" \
      || ! grep -Eq '^effective players: [0-9]+$' <<<"$output"; then
    echo "profile variant '$label' returned $measured/3 measurements" >&2
    return 1
  fi
  echo
}

echo "node:    $NODE"
echo "players: $PLAYERS"
echo

variant "whole" "" 0
variant "no board (factions/leaderboard/challenges)" \
  's|^    result.leaderboard = encode(leaderboard(50))$|    result.leaderboard = "[]"|; s|^    result.factions = encode(factionStats())$|    result.factions = "[]"|; s|^    result.challenges = encode(openChallenges())$|    result.challenges = "[]"|' 3
variant "no market/assets" \
  's|^    result.market = encode(marketView())$|    result.market = "[]"|; s|^    result.markethistory = encode(MarketHistory)$|    result.markethistory = "[]"|; s|^    result.assets = encode(jsonObject(Assets))$|    result.assets = "[]"|' 3
variant "no battle view" \
  's|^      result.battle = encode(Battle.view(b))$|      result.battle = "{}"|' 1
variant "no collect" \
  's|^  collectgarbage("collect")$|  -- collect disabled|' 1

cleanup
trap - EXIT
