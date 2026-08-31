# A local HyperBEAM node, reproducible, for measuring where a slot's time goes.
#
# It clones the node's own repo rather than copying a working tree, so a build
# is exactly the named ref with nothing local in it. The default is the fork
# branch that carries the live node's code AND its ops config, so the container
# is the same node as hyperbeam.tylerw.ai rather than an approximation of it.
# The resolved commit is written to /app/.pinned-ref; report it next to numbers.
#
# `WAMR_PROFILE` is the point of the lab. Upstream builds WAMR in its slowest
# execution mode and leaves profiling instrumentation on, so every wasm module
# on every stock node is interpreted -- measured at ~450x off native. This
# builds the same source several ways so the difference can be timed:
#
#   stock       exactly as the node builds it: classic interpreter, JITs off
#   fastinterp  WAMR_BUILD_FAST_INTERP=1, profiling instrumentation off
#   fastjit     WAMR_BUILD_FAST_JIT=1 (self-contained, no LLVM), profiling off
#
#   ./build.sh stock            # or  fastinterp  |  fastjit
#   ./run.sh   stock
FROM erlang:27

# Everything above the clone is ref-independent, so a rebuild at a new commit
# reuses these layers instead of recompiling the world. That matters here: the
# branch is expected to move.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake git pkg-config libssl-dev libncurses-dev \
        ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# `rebar3 as rocksdb ...` builds a Rust binding, so cargo is a hard build
# dependency -- without it the release dies on a bare `sh: 1: exec: cargo: not
# found`. Upstream's own Dockerfile compiles Rust FROM SOURCE for this, which
# costs hours; rustup is the same toolchain in about a minute.
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
    && cargo --version

# The genesis_wasm profile clones and installs permaweb/ao's legacy CU server,
# which is a Node application. It is also the only path on the node that runs
# WASM under a JIT, so it is worth having present rather than stubbed out.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version

ARG HB_REPO=https://github.com/tylerwarburton/HyperBEAM.git
ARG HB_REF=node-deploy
# `CACHE_BUST` exists so `--build-arg CACHE_BUST=$(date +%s)` re-fetches a
# moving branch. Without it Docker reuses the cached clone layer and silently
# builds last week's commit while the tag claims otherwise.
ARG CACHE_BUST=0
# Resolve the ref to a commit first, then detach onto that. `checkout --detach
# <branch>` is rejected outright when the name is a remote branch git would
# otherwise auto-track, so accepting both a branch name and a raw SHA needs the
# rev-parse. Detached deliberately: nothing here should have a working branch.
RUN git clone "${HB_REPO}" /app \
    && cd /app \
    && SHA=$(git rev-parse --verify "origin/${HB_REF}^{commit}" 2>/dev/null \
             || git rev-parse --verify "${HB_REF}^{commit}") \
    && git checkout --detach "$SHA" \
    && git rev-parse HEAD > /app/.pinned-ref \
    && echo "built from ${HB_REF} = $(cat /app/.pinned-ref)"
WORKDIR /app

ARG WAMR_PROFILE=stock
# Rewrite only the execution-mode flags, in place, before anything compiles.
# `rebar3` runs `make wamr` as a pre-hook, so the library is built from whatever
# this leaves behind. The greps are assertions, not decoration: a pattern that
# stops matching upstream would otherwise yield a "fastjit" image that is
# quietly still the stock one, and the experiment would report a null result.
RUN set -eux; \
    if [ "${WAMR_PROFILE}" != "stock" ]; then \
        case "${WAMR_PROFILE}" in \
            fastinterp) sed -i 's/-DWAMR_BUILD_FAST_INTERP=0/-DWAMR_BUILD_FAST_INTERP=1/' Makefile; \
                        grep -q 'WAMR_BUILD_FAST_INTERP=1' Makefile ;; \
            fastjit)    sed -i 's/-DWAMR_BUILD_FAST_JIT=0/-DWAMR_BUILD_FAST_JIT=1/' Makefile; \
                        grep -q 'WAMR_BUILD_FAST_JIT=1' Makefile ;; \
            *) echo "unknown WAMR_PROFILE ${WAMR_PROFILE}" >&2; exit 1 ;; \
        esac; \
        sed -i 's/-DWAMR_BUILD_MEMORY_PROFILING=1/-DWAMR_BUILD_MEMORY_PROFILING=0/' Makefile; \
        sed -i 's/-DWAMR_BUILD_DUMP_CALL_STACK=1/-DWAMR_BUILD_DUMP_CALL_STACK=0/' Makefile; \
        sed -i 's/-DWAMR_BUILD_AOT_STACK_FRAME=1/-DWAMR_BUILD_AOT_STACK_FRAME=0/' Makefile; \
    fi; \
    grep -E 'WAMR_BUILD_(FAST_INTERP|FAST_JIT|JIT|INTERP|AOT)=|MEMORY_PROFILING|DUMP_CALL_STACK|AOT_STACK_FRAME' Makefile \
        | tee /app/.wamr-flags

# relx copies config.flat into the release, so it has to exist at build time.
# It is not the config the node runs -- that is deploy/node-config.json, applied
# at startup by entrypoint.sh -- it only has to be present and parseable.
RUN printf '%s\n' 'port = 8734.' > /app/config.flat

ARG REBAR_PROFILES=rocksdb+genesis_wasm
RUN rebar3 as ${REBAR_PROFILES} release && echo "${REBAR_PROFILES}" > /app/.rebar-profiles

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

VOLUME /data
EXPOSE 8734
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
