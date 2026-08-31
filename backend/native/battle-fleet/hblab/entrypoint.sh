#!/usr/bin/env bash
# Start the node with the live node's own config, adjusted for localhost.
set -euo pipefail

DATA=/data
mkdir -p "${DATA}"
cd "${DATA}"   # stores are relative names, so they land on the volume

CONFIG="${DATA}/node-config.json"
if [ ! -f "${CONFIG}" ]; then
  # The deployed config verbatim, with the two things that cannot be shared:
  # the public hostname, and the gateway-backed stores. `node-host` must be what
  # a client actually reaches or signed messages address the wrong node.
  node -e '
    const fs = require("fs");
    const source = "/app/deploy/node-config.json";
    const config = fs.existsSync(source) ? JSON.parse(fs.readFileSync(source, "utf8")) : {};
    config["node-host"] = process.env.HB_NODE_HOST || "localhost:8734";
    config["port"] = Number(process.env.HB_PORT || 8734);
    // Keep every store the live node has. Dropping the gateway tiers would make
    // a local read of an Arweave id fail in a way the real node does not, and
    // silently change what is being measured.
    fs.writeFileSync(process.argv[1], JSON.stringify(config, null, 2));
  ' "${CONFIG}"
  echo "wrote ${CONFIG} (node-host=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))["node-host"])' "${CONFIG}"))"
fi

echo "hyperbeam commit: $(cat /app/.pinned-ref)"
echo "rebar profiles:   $(cat /app/.rebar-profiles 2>/dev/null || echo default)"
echo "wamr flags:"
sed 's/^/  /' /app/.wamr-flags

export HB_CONFIG="${CONFIG}"
export HB_PORT="${HB_PORT:-8734}"
export HB_KEY="${DATA}/hyperbeam-key.json"

exec /app/_build/*/rel/hb/bin/hb foreground
