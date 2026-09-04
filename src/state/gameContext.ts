/**
 * The game context, its type, and the hook that reads it — deliberately in a
 * module of their own, apart from `GameProvider.tsx`.
 *
 * React Fast Refresh can only preserve a module that exports components and
 * nothing else. `GameProvider.tsx` used to export the provider AND the context
 * object AND `useGame`, so every edit to the provider re-ran the module and
 * `createContext` handed back a NEW context object. Screens that had already
 * been refreshed against the previous one then read `null` from it, and the
 * app died with "useGame must be used inside <GameProvider>" while the
 * provider was demonstrably right there in the stack.
 *
 * Nothing here is a component, so this module refreshes as a plain dependency
 * and the context identity survives every edit to the provider.
 */
import { createContext, useContext } from 'react';
import {
  Catalog, Faction, LeaderboardRow, MonsterIndexView, OpenChallenge, Player, Tuning,
} from '../lib/types';
import { type WalletProviderId } from '../lib/wallet';
import { type WritePhase } from '../lib/hyperbeam';

export type Ctx = {
  /** Connected wallet address, or null. */
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  hasWallet: boolean;
  walletProvider: WalletProviderId | null;
  walletProviderName: string | null;
  /** Authoritative access mode published by the game process. */
  publicAccess: boolean;

  player: Player | null;
  /**
   * True from the moment a wallet is connected until the first answer lands —
   * not just while the request is in flight.
   *
   * Those are different windows and the difference is visible: a read can take
   * seconds while the node works through a write backlog, and for all of it
   * `player` is null. A screen that only checks "is a request running" renders
   * its no-account state at a returning player for the whole time.
   */
  loadingPlayer: boolean;
  loginError: unknown;
  refresh: () => Promise<void>;

  factions: Faction[] | null;
  leaderboard: LeaderboardRow[] | null;
  catalog: Catalog | null;
  monsterIndex: MonsterIndexView | null;
  /** The engine's combat constants. Never hardcode these in a screen. */
  tuning: Tuning;
  /** Open PvP challenges, from published state. Free to refresh. */
  challenges: OpenChallenge[] | null;
  refreshChallenges: (signal?: AbortSignal) => Promise<void>;

  /** True while any write is in flight. */
  busy: boolean;
  /** True while this particular action is in flight. */
  isPending: (key: string) => boolean;
  /**
   * Which wait this action is in, or null when it is not running.
   *
   * `'signing'` is the wallet dialog — nothing has been sent and rejecting
   * costs nothing. `'settling'` is the chain computing an item the player has
   * already approved. Anything that ANIMATES should start on `'settling'` and
   * finish when the reply lands; starting on the click animates through a
   * decision the player has not made yet.
   */
  writePhase: (key: string) => WritePhase | null;
  /**
   * Run a write. Returns the reply, or null if it failed.
   *
   * `optimistic` projects the expected result onto the record immediately and
   * is rolled back if the write is rejected. Only for actions that qualify —
   * see `state/optimistic.ts`, which is also where the projections live.
   */
  run: <T extends Player>(
    key: string, fn: () => Promise<T>, success?: string,
    optimistic?: (player: Player) => Player,
  ) => Promise<T | null>;

  processId: string;
  node: string;
};

export const GameContext = createContext<Ctx | null>(null);

export function useGame(): Ctx {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}
