import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { viteEnvForGraph } from '../live-config.mjs';

/**
 * Bundle the exact game client used by the React app for Node worker threads.
 * The worker supplies an Arweave wallet shim; no game verb is reimplemented.
 */
export async function buildSwarmClient({ root, graph, pid, node, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const outfile = path.join(outDir, 'client.mjs');
  // Keep pid/node for callers outside the swarm tests, but always inject the
  // WHOLE graph. Overriding only the game used to leave Hunt and the exchange
  // on whatever ids happened to be baked into the source tree.
  const selected = graph ?? { game: pid, node };
  // The swarm calls the shipped verbs, and it also has to send messages the
  // shipped verbs will not build. `listMonster` clamps its price to a legal
  // one, which is correct for the app and useless for a probe asserting that a
  // price of zero is refused — so the raw transport is exported alongside the
  // client rather than reimplemented. It is still the app's transport: the same
  // signing, scheduling, slot correlation and error shaping.
  const entry = [
    `export * from ${JSON.stringify(path.join(root, 'src', 'lib', 'game.ts').replace(/\\/g, '/'))};`,
    'export { readHunt, search as huntSearch, attack as huntAttack,',
    '  declineCapture as huntDeclineCapture, capture as huntCapture,',
    '  retrySettlement as huntRetrySettlement, end as huntEnd }',
    `  from ${JSON.stringify(path.join(root, 'src', 'lib', 'hunt.ts').replace(/\\/g, '/'))};`,
    // The settle observer's reset, so a test can put the transport back to
    // "nothing learned yet" between cases. See `src/lib/slot-settle.mjs`.
    `export { resetSettleObservations } from ${JSON.stringify(path.join(root, 'src', 'lib', 'slot-settle.mjs').replace(/\\/g, '/'))};`,
    'export { send as rawSend, sendMessage as rawSendMessage, readSlot as rawReadSlot,',
    '  readJSON as rawReadJSON, readState as rawReadState, deliverSlot as rawDeliverSlot,',
    '  pendingDeliveries as rawPendingDeliveries,',
    // The transport's own phase timings. The shipped app installs no observer
    // and measures nothing; the swarm worker installs one so a run records
    // where each signed write actually spent its time.
    '  setTransportObserver,',
    '  AmbiguousWriteError, AcceptedWriteError, OutboxDeliveryError }',
    `  from ${JSON.stringify(path.join(root, 'src', 'lib', 'hyperbeam.ts').replace(/\\/g, '/'))};`,
    // The Rune bridge and the token pair. These live in `marketplace.ts`
    // because they address the TOKEN processes rather than the game, and
    // leaving them out of this bundle is why the swarm never touched the
    // bridge: its withdraw half was only ever exercised by hand. Same rule as
    // everything else here -- the app's own verbs, not a reimplementation.
    'export { RUNE_PROCESS, QUOTE_PROCESS, MARKET_NODE, exchangeConfigured,',
    '  readTokenInfo, readTokenBalance, claimQuoteFaucet, depositRuneToGame,',
    '  parseUnits, formatUnits }',
    `  from ${JSON.stringify(path.join(root, 'src', 'lib', 'marketplace.ts').replace(/\\/g, '/'))};`,
    // Both custody venues. The worker uses these exact browser verbs for
    // deposits, resting/taking orders, amendments, cancellation and exits.
    'export { INTERNAL_VENUE_PROCESS, EXTERNAL_VENUE_PROCESS, VENUE_NODE,',
    '  internalVenueConfigured, externalVenueConfigured, venuesConfigured,',
    '  readVenueInfo, readVenueBook, readVenuePosition, placeVenueOrder,',
    '  amendVenueOrder, cancelVenueOrder, cancelAllVenueOrders,',
    '  maintainVenueOrders, withdrawFromVenue, depositTokenToVenue }',
    `  from ${JSON.stringify(path.join(root, 'src', 'lib', 'venue.ts').replace(/\\/g, '/'))};`,
  ].join('\n');
  await esbuild.build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'swarm-client.ts', loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outfile,
    // The shipped client now includes an optional browser-local wallet. Its
    // signer imports arbundles only when that provider is selected; swarm
    // workers always inject their own ANS-104 signer instead. Leaving the
    // unreachable dynamic import external keeps Node-only crypto adapters out
    // of this browser-shaped worker bundle.
    external: ['@dha-team/arbundles'],
    define: {
      // wallet.ts intentionally detects `window`. A worker is browser-shaped
      // through installWalletShim(), so point that lookup at the worker global.
      window: 'globalThis',
      'import.meta.env': JSON.stringify(viteEnvForGraph(selected)),
    },
    logLevel: 'warning',
  });
  return { file: outfile, url: pathToFileURL(outfile).href };
}
