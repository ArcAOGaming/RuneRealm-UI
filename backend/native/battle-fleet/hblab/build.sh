#!/usr/bin/env bash
# Build one HyperBEAM lab image. Usage: ./build.sh [profile] [ref]
#
#   ./build.sh                    # stock, edge tip
#   ./build.sh fastjit            # WAMR Fast JIT, edge tip
#   ./build.sh stock 14e9f68a     # a specific commit
#
# Always passes CACHE_BUST so a moving ref is actually re-fetched; without it
# Docker reuses the cached clone and builds an older commit while the tag says
# otherwise.
set -euo pipefail

profile="${1:-stock}"
ref="${2:-edge}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

docker build \
  --build-arg "WAMR_PROFILE=${profile}" \
  --build-arg "HB_REF=${ref}" \
  --build-arg "CACHE_BUST=$(date +%s)" \
  -t "hb:${profile}" \
  "${here}"

echo
echo "hb:${profile} built from:"
docker run --rm --entrypoint sh "hb:${profile}" -c 'cat /app/.pinned-ref; echo; cat /app/.wamr-flags'
