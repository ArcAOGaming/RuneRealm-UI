/** Client for the separate Hunt process. Account ownership stays in game.ts. */
import { HB_NODE, readJSON, send } from './hyperbeam';
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
) => unwrap<HuntRun>(await send<Reply<HuntRun>>([
  { name: 'Action', value: action },
  ...tags(route, extra),
], {
  process: route.processId,
  node: route.node || HB_NODE,
  requiredOutbox,
}));

export const readHunt = (route: HuntRoute) =>
  readJSON<HuntRun>(`hunt-run-${route.runId}`, {
    process: route.processId,
    node: route.node || HB_NODE,
  });

export const search = (route: HuntRoute) =>
  write(route, 'Hunt.Search', { ActionId: actionId('search') });

export const attack = (route: HuntRoute, move: string, round: number) =>
  write(route, 'Hunt.Attack', {
    Move: move, Round: String(round), ActionId: actionId('attack'),
  }, (reply) => !!reply && !reply.error && reply.status === 'lost');

export const declineCapture = (route: HuntRoute) => write(route, 'Hunt.Decline');

export const capture = (route: HuntRoute, runes: number) =>
  write(route, 'Hunt.Capture', {
    Runes: String(runes), ActionId: actionId('capture'),
  }, true);

/** Re-push a fixed capture result; it never rolls or charges a second time. */
export const retrySettlement = (route: HuntRoute) =>
  write(route, 'Hunt.RetrySettlement', {}, true);

export const end = (route: HuntRoute) => write(route, 'Hunt.End', {}, true);
