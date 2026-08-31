/**
 * One provider holding everything the screens need: the wallet, the player, and
 * the two published lists.
 *
 * The split that matters here is reads versus writes.
 *
 *   - A WRITE prompts the wallet, so it only ever happens because a player
 *     clicked something. `run()` is the single path for those: it tracks which
 *     action is in flight, folds the reply into the player, and surfaces the
 *     error instead of swallowing it.
 *
 *   - A READ is free and silent, so factions, the leaderboard AND the player's
 *     own record are plain unsigned GETs. The old client polled with `dryrun`,
 *     which is a signed speculative execution — every ten seconds, forever.
 *     There is no equivalent here and that is a straight improvement.
 *
 * Connecting a wallet is a read. It used to sign a `User.Login` write, which
 * meant a wallet prompt stood between opening the page and seeing your own
 * companion — a signature for looking at something. The process now publishes
 * each player under their own address, so connecting grants ACCESS_ADDRESS,
 * that address names a key, and the account appears. Nothing is signed until
 * the player actually does something.
 *
 * Nothing polls on a timer while a battle is on. Combat is turn-based and each
 * reply carries the whole new battle, so there is nothing a poll would learn.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import * as api from '../lib/game';
import {
  connectWallet, disconnectWallet, restoreWallet, GAME_PROCESS, HB_NODE,
} from '../lib/hyperbeam';
import { type WalletConnection, type WalletProviderId } from '../lib/wallet';
import { Catalog, Faction, LeaderboardRow, OpenChallenge, Player, Tuning } from '../lib/types';
import { useToast } from '../ui/Toast';
import { WalletDialog } from '../ui/WalletDialog';

const FACTION_POLL_MS = 30_000;

/**
 * Used only until the process's own `catalog` arrives, so that a first paint
 * before the network settles shows plausible numbers rather than zeroes. These
 * must never be the source of truth — see `Tuning` in types.ts for why.
 */
const FALLBACK_TUNING: Tuning = {
  attackBase: 1, variance: 0.15, hpPerHealth: 12, shieldPerDefense: 4,
  healPerPoint: 0.04, shieldRegenShare: 0.2, moveUses: 3, struggleDamage: 2,
  baseHitChance: 0.7, minHitChance: 0.3, maxHitChance: 0.95,
  criticalChance: 0.09, criticalMultiplier: 1.6,
};

/**
 * A wallet the process has never heard of.
 *
 * The same shape as a real record rather than a three-field stub, and for the
 * same reason the Lua handler answers that way: the header renders before
 * anything else and reads `inventory.rune`, so a partial player takes the page
 * down before the "no access" screen can say what is wrong.
 */
const blankPlayer = (address: string, unlocked = false): Player => ({
  address, exists: false, unlocked,
  inventory: {}, gold: 0, lootboxes: [], battlesRemaining: 0,
  wins: 0, losses: 0, questsCompleted: 0, joinedAt: 0, dailyReadyAt: 0,
});

type Ctx = {
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
  /** The engine's combat constants. Never hardcode these in a screen. */
  tuning: Tuning;
  /** Open PvP challenges, from published state. Free to refresh. */
  challenges: OpenChallenge[] | null;
  refreshChallenges: () => Promise<void>;

  /** True while any write is in flight. */
  busy: boolean;
  /** True while this particular action is in flight. */
  isPending: (key: string) => boolean;
  /** Run a write. Returns the reply, or null if it failed. */
  run: <T extends Player>(key: string, fn: () => Promise<T>, success?: string) => Promise<T | null>;

  processId: string;
  node: string;
};

export const GameContext = createContext<Ctx | null>(null);

export function useGame(): Ctx {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [busyProvider, setBusyProvider] = useState<WalletProviderId | null>(null);
  const [walletDialog, setWalletDialog] = useState(false);
  const [createdWallet, setCreatedWallet] = useState<WalletConnection | null>(null);
  const [walletProvider, setWalletProvider] = useState<WalletProviderId | null>(null);
  const [walletProviderName, setWalletProviderName] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  // Starts true while the wallet extension answers whether a session already
  // exists. Without this restoration window, a direct visit to /companion or
  // /arena renders once with no address and redirects home before the silent
  // reconnect has a chance to finish.
  const [loadingPlayer, setLoadingPlayer] = useState(true);
  const [loginError, setLoginError] = useState<unknown>(null);
  const [factions, setFactions] = useState<Faction[] | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [challenges, setChallenges] = useState<OpenChallenge[] | null>(null);
  const [publicAccess, setPublicAccess] = useState(false);
  // A set, not a single slot: two writes in flight used to cross wires, the
  // second clearing the first button's spinner and the first's cleanup clearing
  // the second's.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  // Mirrored into a ref for the visibility listener: it is registered once per
  // connected wallet, so it cannot close over `pending` and still see it.
  const pendingRef = useRef(0);
  useEffect(() => { pendingRef.current = pending.size; }, [pending]);
  // Likewise: `refresh` is rebuilt only when the wallet changes, so it reads
  // "do we already have a player" from here rather than closing over it.
  const havePlayer = useRef(false);
  useEffect(() => { havePlayer.current = !!player; }, [player]);
  // The wallet the signed fallback below has already been spent on, so it is
  // asked for at most once per connected address per session.
  const signedFallbackFor = useRef<string | null>(null);

  // A browser-local signer is always available, even when there is no wallet
  // extension on the device.
  const hasWallet = typeof window !== 'undefined';

  // Reconnect silently if the wallet already granted permission, so a reload
  // does not throw a consent dialog at someone mid-session.
  useEffect(() => {
    let cancelled = false;
    restoreWallet()
      .then((connection) => {
        if (cancelled) return;
        if (connection) {
          setAddress(connection.address);
          setWalletProvider(connection.provider);
          setWalletProviderName(connection.providerName);
        }
        else setLoadingPlayer(false);
      })
      .catch(() => { if (!cancelled) setLoadingPlayer(false); });
    return () => { cancelled = true; };
  }, []);

  // The wallet extension fires this when the user switches accounts.
  useEffect(() => {
    const onSwitch = () => {
      setLoadingPlayer(true);
      restoreWallet().then((connection) => {
        setAddress(connection?.address ?? null);
        setWalletProvider(connection?.provider ?? null);
        setWalletProviderName(connection?.providerName ?? null);
        setPlayer(null);
        if (!connection) setLoadingPlayer(false);
      }).catch(() => setLoadingPlayer(false));
    };
    window.addEventListener('walletSwitch', onSwitch);
    return () => window.removeEventListener('walletSwitch', onSwitch);
  }, []);

  const connect = useCallback(async () => {
    setCreatedWallet(null);
    setWalletDialog(true);
  }, []);

  const chooseWallet = useCallback(async (provider: WalletProviderId) => {
    setConnecting(true);
    setBusyProvider(provider);
    try {
      const connection = await connectWallet(provider);
      setLoadingPlayer(true);
      setPlayer(null);
      signedFallbackFor.current = null;
      setAddress(connection.address);
      setWalletProvider(connection.provider);
      setWalletProviderName(connection.providerName);
      if (connection.created) setCreatedWallet(connection);
      else setWalletDialog(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not connect');
    } finally {
      setConnecting(false);
      setBusyProvider(null);
    }
  }, [toast]);

  const disconnect = useCallback(async () => {
    await disconnectWallet();
    setAddress(null);
    setPlayer(null);
    setWalletProvider(null);
    setWalletProviderName(null);
    setLoadingPlayer(false);
  }, []);

  /**
   * Pull this wallet's account.
   *
   * An unsigned GET of `player-<address>`, so it costs nothing and prompts
   * nothing — which is why it is safe to call on connect, on a retry, and every
   * time the tab comes back to the foreground.
   *
   * A null answer means the process has no record under that key — normally
   * "no Eternal Pass", because unlocking a wallet mints a record for it.
   *
   * Normally. A process deployed before per-address keys existed publishes NONE
   * of them, so on one of those every wallet reads as null and the whole game
   * tells every pass holder they do not have a pass. That is exactly what
   * happened between this change landing in the client and the process being
   * redeployed. So a null falls back to the signed `User.Login`, which is
   * authoritative on any process ever deployed.
   *
   * It costs a signature, and only ever in the case that would otherwise be
   * answered wrongly: a wallet with a pass never reaches it. Signing to be told
   * "you have no account" is a fair price for never telling a paying player
   * that by mistake.
   *
   * A network error is different again, and sets `loginError` so the screen can
   * offer a retry instead of a verdict.
   *
   * The record carries the player's battle if one is in progress, which is what
   * makes a reload mid-fight survivable.
   */
  const refresh = useCallback(async () => {
    if (!address) return;
    // Only the FIRST read announces itself. A re-read on tab focus already has
    // a player on screen, and flipping this would flash the divining panel at
    // somebody who was in the middle of looking at something.
    if (!havePlayer.current) setLoadingPlayer(true);
    setLoginError(null);
    try {
      const published = await api.readPlayer(address);
      if (published) {
        setPlayer(published);
      } else if (publicAccess || (await api.readAccess().catch(() => null))?.publicAccess) {
        // In an open deployment an unknown wallet deliberately has no
        // published player key yet. It becomes a durable account on its first
        // signed action; showing the blank unlocked shape here preserves the
        // rule that merely connecting signs nothing.
        setPublicAccess(true);
        setPlayer(blankPlayer(address, true));
      } else if (signedFallbackFor.current === address) {
        // Already asked once for this wallet. Refresh runs on every return to
        // the tab, and a prompt each time somebody switches windows would be
        // worse than the wrong answer it is guarding against.
        setPlayer((current) => current ?? blankPlayer(address));
      } else {
        signedFallbackFor.current = address;
        // The wallet may refuse and the process may be unreachable; either way a
        // blank player is a better answer than a spinner that never resolves.
        setPlayer(await api.login().catch(() => blankPlayer(address)));
      }
    } catch (err) {
      setLoginError(err);
    } finally {
      setLoadingPlayer(false);
    }
  }, [address, publicAccess]);

  // Coming back to the tab re-reads the account. It is free, so there is no
  // reason to show a stale companion to somebody who left a quest running.
  useEffect(() => {
    if (!address) return;
    const onVisible = () => {
      // Never while a write is in flight: the published record is the state
      // BEFORE that write, and landing it on top of the reply would undo the
      // action on screen for a second.
      if (document.visibilityState === 'visible' && pendingRef.current === 0) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [address, refresh]);

  const lastLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (address && lastLoaded.current !== address) {
      lastLoaded.current = address;
      void refresh();
    }
  }, [address, refresh]);

  // Published reads: free, unsigned, and safe to poll.
  //
  // The first pull retries quickly, because a read can take seconds while the
  // process works through a backlog of writes — and on a thirty-second timer a
  // single missed first read leaves the faction screen showing skeletons for
  // half a minute. Once something has landed it settles into the slow poll.
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const pull = async (): Promise<boolean> => {
      const [f, l, c, ch, access] = await Promise.all([
        api.readFactions().catch(() => null),
        api.readLeaderboard().catch(() => null),
        api.readCatalog().catch(() => null),
        api.readChallenges().catch(() => null),
        api.readAccess().catch(() => null),
      ]);
      if (cancelled) return true;
      if (f) setFactions(f);
      if (l) setLeaderboard(l);
      if (c) setCatalog(c);
      if (ch) setChallenges(ch);
      if (access) setPublicAccess(access.publicAccess === true);
      return !!f;
    };

    const firstPull = async (attempt = 0) => {
      const got = await pull();
      if (got || cancelled || attempt >= 5) return;
      retry = setTimeout(() => void firstPull(attempt + 1), 1000 * 2 ** attempt);
    };

    void firstPull();
    const timer = setInterval(() => { void pull(); }, FACTION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (retry) clearTimeout(retry);
    };
  }, []);

  const refreshChallenges = useCallback(async () => {
    const open = await api.readChallenges().catch(() => null);
    if (open) setChallenges(open);
  }, []);

  const run = useCallback(async function run<T extends Player>(
    key: string, fn: () => Promise<T>, success?: string,
  ): Promise<T | null> {
    setPending((all) => new Set(all).add(key));
    try {
      const reply = await fn();
      // Every player-facing handler answers with the whole player record, so
      // one assignment keeps every screen current. Passing whole records around
      // rather than hand-picked fields is deliberate — the Dumverse port traced
      // three separate crashes to a view that dropped them.
      if (reply && typeof reply === 'object' && 'address' in reply) {
        setPlayer(reply as Player);
      }
      if (success) toast.success(success);
      return reply;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setPending((all) => {
        const next = new Set(all);
        next.delete(key);
        return next;
      });
    }
  }, [toast]);

  const isPending = useCallback((key: string) => pending.has(key), [pending]);

  const value = useMemo<Ctx>(() => ({
    address, connecting, connect, disconnect, hasWallet,
    walletProvider, walletProviderName, publicAccess,
    player,
    // Connected but nothing known yet is still loading, however briefly the
    // request itself has been running.
    loadingPlayer: loadingPlayer || (!!address && !player && !loginError),
    loginError, refresh,
    factions, leaderboard, catalog,
    tuning: catalog?.tuning ?? FALLBACK_TUNING,
    challenges, refreshChallenges,
    busy: pending.size > 0, isPending, run,
    processId: GAME_PROCESS, node: HB_NODE,
  }), [
    address, connecting, connect, disconnect, hasWallet,
    walletProvider, walletProviderName, publicAccess,
    player, loadingPlayer, loginError, refresh,
    factions, leaderboard, catalog, challenges, refreshChallenges,
    pending, isPending, run,
  ]);

  return (
    <GameContext.Provider value={value}>
      {children}
      {walletDialog && (
        <WalletDialog
          onClose={() => setWalletDialog(false)}
          onChoose={(provider) => { void chooseWallet(provider); }}
          busyProvider={busyProvider}
          createdWallet={createdWallet}
          onContinue={() => {
            setCreatedWallet(null);
            setWalletDialog(false);
          }}
          connected={address ? { address, providerName: walletProviderName } : null}
          onDisconnect={() => {
            void disconnect().then(() => setWalletDialog(false));
          }}
        />
      )}
    </GameContext.Provider>
  );
}
