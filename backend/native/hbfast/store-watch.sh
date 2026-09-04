#!/usr/bin/env bash
# HyperBEAM store watchdog.
#
# The primary LMDB store only ever grows — HyperBEAM has no way to prune old
# slots, only a full reset (see STORE_MANAGEMENT.md). So this cannot fix a large
# store; its job is to LOG growth and shout BEFORE the store is big enough to
# make writes slow again, so a re-baseline is a planned maintenance window and
# never another 12-second surprise in play.
#
# It also does what the original gw-cache-maintain.sh did: reset the DISPOSABLE
# gateway cache when it crosses a cap. The authoritative primary LMDB is only
# ever MEASURED here, never touched.
#
# Install on the existing timer:
#   cp store-watch.sh /root/HyperBEAM/tools/store-watch.sh && chmod +x it
#   point hyperbeam-maintain.service ExecStart at it (or run both)
set -uo pipefail

HB=/root/HyperBEAM
REL=$HB/_build/rocksdb+genesis_wasm/rel/hb
BIN=$REL/bin/hb
GW=$REL/cache-mainnet/gw-cache
PRIMARY=$REL/cache-mainnet/lmdb
LOG=$HB/logs/storage-monitor.log

# --- primary-store alert thresholds (the point of this script) ---
WARN_GIB=20           # plan a re-baseline (export -> wipe -> deploy+load)
CRIT_GIB=60           # re-baseline now; latency is climbing
WEBHOOK="${HB_STORE_WEBHOOK:-}"   # optional: a URL to POST alerts to

# --- disposable gw-cache reset (unchanged behaviour) ---
GW_PRUNE_GIB=70
DISK_MAX_PCT=88

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gw_kb=$(du -sk "$GW" 2>/dev/null | cut -f1); gw_kb=${gw_kb:-0}
pr_kb=$(du -sk "$PRIMARY" 2>/dev/null | cut -f1); pr_kb=${pr_kb:-0}
disk_pct=$(df --output=pcent / | tail -1 | tr -dc '0-9'); disk_pct=${disk_pct:-0}
gw_gib=$(( gw_kb / 1024 / 1024 ))
pr_gib=$(( pr_kb / 1024 / 1024 ))

# --- the alert: primary store growth ---
level=ok
if   [ "$pr_gib" -ge "$CRIT_GIB" ]; then level=CRIT
elif [ "$pr_gib" -ge "$WARN_GIB" ]; then level=WARN
fi
if [ "$level" != "ok" ]; then
  msg="hyperbeam primary store ${pr_gib}GiB (${level} at WARN=${WARN_GIB}/CRIT=${CRIT_GIB}) — re-baseline needed; HyperBEAM cannot prune in place. See STORE_MANAGEMENT.md."
  logger -t hyperbeam-store-watch "$msg"
  echo "$ts $level $msg" >&2
  if [ -n "$WEBHOOK" ]; then
    curl -sS -m 10 -X POST -H 'content-type: application/json' \
      --data "{\"level\":\"$level\",\"primary_gib\":$pr_gib,\"disk_pct\":$disk_pct,\"text\":\"$msg\"}" \
      "$WEBHOOK" >/dev/null 2>&1 || true
  fi
fi

# --- disposable gw-cache reset (never touches the primary) ---
pruned=no
if [ "$gw_gib" -ge "$GW_PRUNE_GIB" ] || [ "$disk_pct" -ge "$DISK_MAX_PCT" ]; then
  "$BIN" eval 'GW = #{ <<"store-module">> => hb_store_lmdb, <<"name">> => <<"cache-mainnet/gw-cache">>, <<"capacity">> => 128849018880 }, catch hb_store:reset(GW), ok.' >/dev/null 2>&1 || true
  pruned=yes
  logger -t hyperbeam-store-watch "pruned gw-cache (was ${gw_gib}GiB, disk ${disk_pct}%)"
fi

echo "$ts primary_gib=$pr_gib gw_cache_gib=$gw_gib disk_pct=$disk_pct level=$level gw_pruned=$pruned" >> "$LOG"
