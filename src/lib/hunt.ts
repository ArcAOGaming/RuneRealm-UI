/** Client for the separate Hunt process. Account ownership stays in game.ts. */
import { HB_NODE, readJSON, send } from './hyperbeam';
import {
  huntRouteReleased, huntSettlementApplied, joined, retryHuntAcknowledgement,
} from './game';
import {
  GameError, HuntRoute, HuntRun, Reply,
} from './types';

function unwrap<T>(reply: Reply<T>): T {
  if (reply && typeof reply === 'object' && 'error' in reply && reply.error) {
    throw new GameError(String(reply.error));
  }
  return reply as T;
}

const actionId = (kind: string) => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  return `${kind}_${random}`;
};

const tags = (route: HuntRoute, extra: Record<string, string> = {}) => [
  { name: 'RunId', value: route.runId },
  { name: 'Ticket', value: route.ticket },
  ...Object.entries(extra).map(([name, value]) => ({ name, value })),
];

const write = async (
  route: HuntRoute,
  action: string,
  extra: Record<string, string> = {},
  requiredOutbox: boolean | ((reply: Reply<HuntRun>) => boolean) = false,
  confirm?: () => Promise<boolean>,
) => unwrap<HuntRun>(await send<Reply<HuntRun>>([
  { name: 'Action', value: action },
  ...tags(route, extra),
], {
  process: route.processId,
  node: route.node || HB_NODE,
  requiredOutbox,
  ...(confirm ? { deliveryOptions: { confirm } } : {}),
}));

/**
 * The run, from the worker's published cache. Free, unsigned, and cancellable:
 * the screen polls this while a run is opening or settling, and a read with no
 * signal outlives the screen holding one of six connections to the origin.
 */
export const readHunt = (route: HuntRoute, signal?: AbortSignal) =>
  readJSON<HuntRun>(`hunt-run-${route.runId}`, {
    process: route.processId,
    node: route.node || HB_NODE,
    signal,
  }).then(joined);

export const search = (route: HuntRoute) =>
  write(route, 'Hunt.Search', { ActionId: actionId('search') });

export const attack = (route: HuntRoute, move: string, round: number) =>
  write(route, 'Hunt.Attack', {
    Move: move, Round: String(round), ActionId: actionId('attack'),
  }, (reply) => !!reply && !reply.error && reply.status === 'lost');

export const declineCapture = (route: HuntRoute) => write(route, 'Hunt.Decline');

/*
  The three actions whose outbox crosses back to the game authority take a
  CONFIRMATION READ, because the push cannot answer for them.

  A `push&slot=N` whose slot holds an outbox does not return on this node:
  measured 2026-09-08 on production, no response at 300 s, 200 s, 180 s and
  120 s across four such slots on two processes, against 0.39 s for a slot with
  an empty outbox — `dev_push` recurses into `push_downstream_remote` for the
  next hop and that inner request never comes back. With no `confirm`,
  `deliverSlot` falls back to the push's HTTP status, which is an abort, and
  every one of these threw `OutboxDeliveryError` over work that had landed.

  Live, on run `h3`: the authority applied the capture (`h3-capture-1`, 1 Rune
  and 1 Scroll spent, roll 83 against 50) and the client reported the delivery
  had failed. A player looking at that error retries and pays twice — which is
  precisely what `OutboxDeliveryError` exists to stop, and it cannot do that
  while it fires on every successful capture.

  The reads are free published state on the game process, and `deliverSlot`
  leaves the push socket running once they answer, so nothing here shortens the
  delivery it is observing.
*/
/**
 * A capture, all the way back.
 *
 * Two hops, and the second one is the one HUNT.md is about. The worker's
 * `Hunt.Settle` reaches the authority on this action's own push; the
 * authority's `Hunt.Settled` back to the worker rides a slot NOBODY pushes,
 * because the push that was supposed to cascade into it does not return on this
 * node. Left alone the run sits in `settling` forever with the Rune already
 * spent — measured live on run `h3`, 2026-09-08.
 *
 * So drive it: once the authority's receipt is on the account, ask it to
 * re-emit the acknowledgement at a slot this client can push, and wait for the
 * worker's own published run to leave `settling`. That costs one extra
 * authority slot per capture and it is the difference between a settled run and
 * a permanently stuck one.
 */
async function settleCapture(route: HuntRoute, run: HuntRun): Promise<HuntRun> {
  if (run.status !== 'settling') return run;
  try { await retryHuntAcknowledgement(route); } catch { /* the read below decides */ }
  return (await readHunt(route).catch(() => null)) ?? run;
}

export const capture = async (route: HuntRoute, runes: number) => settleCapture(
  route,
  await write(route, 'Hunt.Capture', {
    Runes: String(runes), ActionId: actionId('capture'),
  }, true, huntSettlementApplied(route.runId)),
);

/** Re-push a fixed capture result; it never rolls or charges a second time. */
export const retrySettlement = async (route: HuntRoute) => settleCapture(
  route,
  await write(route, 'Hunt.RetrySettlement', {}, true, huntSettlementApplied(route.runId)),
);

export const end = (route: HuntRoute) =>
  write(route, 'Hunt.End', {}, true, huntRouteReleased(route.runId));
