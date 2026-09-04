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
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import * as api from '../lib/game';
import { type Ctx, GameContext } from './gameContext';
import { isAbort, usePoll } from './usePoll';
import {
  connectWallet, disconnectWallet, restoreWallet, withWritePhase,
  GAME_PROCESS, HB_NODE, type WritePhase,
} from '../lib/hyperbeam';
import { type WalletConnection, type WalletProviderId } from '../lib/wallet';
import { MonsterIndexView, Catalog, Faction, LeaderboardRow, OpenChallenge, Player, Tuning } from '../lib/types';
import { useToast } from '../ui/toastContext';
import { WalletDialog } from '../ui/WalletDialog';

const FACTION_POLL_MS = 30_000;
/**
 * How many background polls pass between re-reads of the access flag.
 *
 * It used to ride along with every one of them, which made the background tick
 * six concurrent reads — the browser allows six connections to an HTTP/1.1
 * origin, so the tick filled the pipe and a click landing near it queued behind
 * the lot. Public access is deployment configuration changed by an admin
 * action, not gameplay state, so five minutes is the right cadence for it and
 * thirty seconds never was.
 */
const ACCESS_EVERY = 10;

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
  const [monsterIndex, setMonsterIndex] = useState<MonsterIndexView | null>(null);
  const [challenges, setChallenges] = useState<OpenChallenge[] | null>(null);
  const [publicAccess, setPublicAccess] = useState(false);
  // A set, not a single slot: two writes in flight used to cross wires, the
  // second clearing the first button's spinner and the first's cleanup clearing
  // the second's.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * Which wait each in-flight write is in — see `WritePhase` in hyperbeam.ts.
   *
   * Separate from `pending` on purpose: a button still goes busy on the click,
   * because that is what stops a second click, but nothing that ANIMATES may
   * start until the wallet has actually been signed.
   */
  const [phases, setPhases] = useState<ReadonlyMap<string, WritePhase>>(() => new Map());
  // Mirrored into a ref for the visibility listener: it is registered once per
  // connected wallet, so it cannot close over `pending` and still see it.
  //
  // Written SYNCHRONOUSLY by `run`, not from an effect. The background poll
  // reads it to stand down while a write is in flight, and a poll that only
  // learns about the write one commit later is a poll that has already taken
  // the connection the write wanted.
  const pendingRef = useRef(0);
  // Likewise: `refresh` is rebuilt only when the wallet changes, so it reads
  // "do we already have a player" from here rather than closing over it.
  const havePlayer = useRef(false);
  useEffect(() => { havePlayer.current = !!player; }, [player]);
  // The record as last rendered. `run` needs to project an optimistic result
  // from it BEFORE calling `setPlayer`, and a state updater is not the place to
  // compute one — React may call an updater more than once.
  const playerRef = useRef<Player | null>(null);
  useEffect(() => { playerRef.current = player; }, [player]);
  // The wallet the signed fallback below has already been spent on, so it is
  // asked for at most once per connected address per session.
  const signedFallbackFor = useRef<string | null>(null);
  /**
   * Which read is the current one.
   *
   * Bumped by every call to `refresh`, and each call keeps its own number: a
   * read whose number has been superseded — by a later read, or by the player
   * connecting a different wallet while this one was in flight — throws its
   * answer away instead of writing a record the screen has moved on from.
   */
  const readGeneration = useRef(0);
  /** The account read currently in flight, so a newer one can cancel it. */
  const refreshAbort = useRef<AbortController | null>(null);
  useEffect(() => () => refreshAbort.current?.abort(), []);

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

  /*
    The wallet extension fires this when the active address changes.

    Not only when the player switches accounts, though: an extension the player
    was SIGNED OUT of fires it the moment they sign in, which is in the middle
    of the connect handshake — ten seconds after they pressed the button, and
    right on top of the first read of their account.

    So this must not throw the record away unless the wallet really is a
    different one. It used to, unconditionally, and the account was then never
    re-read, because the re-read was armed by the address CHANGING and the
    address had not changed. That is the "Reading your mark" that never ends.
  */
  useEffect(() => {
    const onSwitch = () => {
      setLoadingPlayer(true);
      restoreWallet().then((connection) => {
        const next = connection?.address ?? null;
        setAddress(next);
        setWalletProvider(connection?.provider ?? null);
        setWalletProviderName(connection?.providerName ?? null);
        setPlayer((current) => (current && current.address === next ? current : null));
        // Always, whatever came back. This event is finished with: either there
        // is no wallet, or the record on screen belongs to the one there is, or
        // it was dropped and the effect below is already reading the new one —
        // which turns the flag back on itself. Leaving it set here is the other
        // half of the mark that was read forever.
        setLoadingPlayer(false);
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
    const generation = ++readGeneration.current;
    // Supersede rather than accumulate: the previous read is abandoned the
    // moment a newer one starts, so a hung account read cannot sit on one of
    // six connections while every later refresh queues behind it.
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;
    const { signal } = controller;
    /** False once a newer read has started. Nothing stale may be written. */
    const isCurrent = () => generation === readGeneration.current;
    // Only the FIRST read announces itself. A re-read on tab focus already has
    // a player on screen, and flipping this would flash the divining panel at
    // somebody who was in the middle of looking at something.
    if (!havePlayer.current) setLoadingPlayer(true);
    setLoginError(null);
    try {
      const published = await api.readPlayer(address, { signal });
      if (!isCurrent()) return;
      if (published) {
        setPlayer(published);
      } else if (publicAccess || (await api.readAccess({ signal }).catch(() => null))?.publicAccess) {
        if (!isCurrent()) return;
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
        const signed = await api.login().catch(() => blankPlayer(address));
        if (!isCurrent()) return;
        setPlayer(signed);
      }
    } catch (err) {
      if (isCurrent() && !isAbort(err)) setLoginError(err);
    } finally {
      if (refreshAbort.current === controller) refreshAbort.current = null;
      // A superseded read must not put the spinner out: the read that replaced
      // it is still running, and this is the flag that says so.
      if (isCurrent()) setLoadingPlayer(false);
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

  /*
    A connected wallet with no record on screen is a read waiting to happen.

    This used to fire on the address changing instead, and that is a different
    question with a different answer: everything that clears the player without
    changing the address — the extension signing in mid-connect, a switch back
    to the wallet already loaded — left the screen with no record and nothing
    on its way to fetch one, which is a spinner with no end.

    It cannot spin: every path through `refresh` either sets a player or sets
    `loginError`, and neither leaves this condition true with the same deps.
  */
  useEffect(() => {
    if (address && !player) void refresh();
  }, [address, player, refresh]);

  /*
    First load, in two waves of three.

    Six reads at once is exactly the browser's connection limit for an HTTP/1.1
    origin, and the player's own record — the one thing the screen is actually
    waiting for — was the seventh. So the wave is split: what the first paint
    needs goes first (`catalog` carries the combat tuning, `access` decides
    whether the page shows a game or a locked door, `factions` is the first
    screen a new player sees), and the rest follows once those connections are
    free.

    `catalog` and `monsterindex` are read through `api`'s constant cache, which
    is what stops this racing the copy `joined()` used to fetch from inside the
    very first read — the same 15 KB of constants, pulled twice, concurrently,
    on every cold load.

    The first pull retries quickly, because a read can take seconds while the
    process works through a backlog of writes — and on a thirty-second timer a
    single missed first read leaves the faction screen showing skeletons for
    half a minute.

    It retries UNTIL THE CONSTANTS ARE HERE, not until factions are. The cache
    keeps a miss, so nothing else in the app will ever go and get them: a gate
    that only checked factions left a tab whose `catalog` GET happened to fail
    with no combat tuning and no move definitions — every companion card blank
    — until the player reloaded. Each attempt asks only for what is still
    missing, and only a retry passes `fresh`, so the successful first attempt is
    still exactly one fetch of each.
  */
  // False while the first pull still owns the constants. The poll's retry waits
  // on it so the two cannot both hold a `fresh` fetch open at once — the first
  // pull's six attempts span 31 s and the poll's first tick lands at 30.
  const firstPullSettled = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const have = { catalog: false, factions: false, monsterIndex: false };

    const first = async (attempt: number): Promise<boolean> => {
      // Attempt 0 shares whatever the cache already has, which is the point of
      // the cache. A retry is here BECAUSE the cached answer is a miss, so it
      // must replace it rather than read it back.
      const fresh = attempt > 0;
      const [c, access, f] = await Promise.all([
        // No signal on the two constants: they are one shared fetch per tab and
        // aborting it would abort it for every other caller too. See `where`
        // in lib/game.ts.
        have.catalog ? null : api.readCatalog({ fresh }).catch(() => null),
        api.readAccess({ signal }).catch(() => null),
        have.factions ? null : api.readFactions({ signal }).catch(() => null),
      ]);
      if (signal.aborted) return true;
      if (c) { have.catalog = true; setCatalog(c); }
      if (access) setPublicAccess(access.publicAccess === true);
      if (f) { have.factions = true; setFactions(f); }

      const [b, l, ch] = await Promise.all([
        have.monsterIndex ? null : api.readMonsterIndex({ fresh }).catch(() => null),
        api.readLeaderboard({ signal }).catch(() => null),
        api.readChallenges({ signal }).catch(() => null),
      ]);
      if (signal.aborted) return true;
      if (b) { have.monsterIndex = true; setMonsterIndex(b); }
      if (l) setLeaderboard(l);
      if (ch) setChallenges(ch);
      return have.catalog && have.factions && have.monsterIndex;
    };

    const firstPull = async (attempt = 0) => {
      const got = await first(attempt);
      if (got || signal.aborted || attempt >= 5) {
        firstPullSettled.current = true;
        return;
      }
      retry = setTimeout(() => void firstPull(attempt + 1), 1000 * 2 ** attempt);
    };

    void firstPull();
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
    };
  }, []);

  /*
    The background refresh: three reads, one at a time, thirty seconds apart.

    It used to be six issued together on a bare interval, which filled the
    origin's six connections on every tick — so a click that landed near one
    waited for the whole tick to drain before its own request could even open.
    Now it is serial, it stands down entirely while a signed write is in flight
    or the tab is hidden, and `usePoll` schedules the next tick from the END of
    this one, so a thirty-second read cannot stack up thirty-second reads.

    The two constants are not REFRESHED by it: `catalog` and `monsterindex` do
    not change without a redeploy, and a redeploy is a new process id. They are
    still RETRIED by it, once the first pull has given up — see below.
  */
  const pollTick = useRef(0);
  usePoll(async (signal) => {
    const f = await api.readFactions({ signal }).catch(() => null);
    if (f) setFactions(f);
    const l = await api.readLeaderboard({ signal }).catch(() => null);
    if (l) setLeaderboard(l);
    const ch = await api.readChallenges({ signal }).catch(() => null);
    if (ch) setChallenges(ch);

    let access: { publicAccess: boolean } | null = null;
    if (++pollTick.current % ACCESS_EVERY === 0) {
      access = await api.readAccess({ signal }).catch(() => null);
      if (access) setPublicAccess(access.publicAccess === true);
    }

    /*
      The constants' last retry, and the only one after the first pull's six
      attempts are spent.

      Guarded on the state itself, so once they are here this issues NOTHING —
      the duplicate fetch that used to happen on every load stays gone and the
      steady-state tick is still the same three reads. `fresh` is required:
      without it the cached miss answers instantly and the tab stays broken
      forever, which is the failure this exists to end. Cheap to leave in the
      poll rather than in an effect of its own, because the alternative to a
      missing catalog is a game with no combat tuning and no move definitions.
    */
    let constants = false;
    if (firstPullSettled.current) {
      if (!catalog) {
        const c = await api.readCatalog({ fresh: true }).catch(() => null);
        if (c) { setCatalog(c); constants = true; }
      }
      if (!monsterIndex) {
        const b = await api.readMonsterIndex({ fresh: true }).catch(() => null);
        if (b) { setMonsterIndex(b); constants = true; }
      }
    }

    // Nothing readable at all is a node that is not answering. Throwing is how
    // the poll is told to back off rather than keep asking on the same beat.
    if (!f && !l && !ch && !access && !constants) throw new Error('published state unavailable');
  }, {
    intervalMs: FACTION_POLL_MS,
    paused: () => pendingRef.current > 0,
  });

  const refreshChallenges = useCallback(async (signal?: AbortSignal) => {
    const open = await api.readChallenges({ signal }).catch(() => null);
    if (open) setChallenges(open);
  }, []);

  const run = useCallback(async function run<T extends Player>(
    key: string, fn: () => Promise<T>, success?: string,
    optimistic?: (player: Player) => Player,
  ): Promise<T | null> {
    pendingRef.current += 1;
    setPending((all) => new Set(all).add(key));
    setPhases((all) => new Map(all).set(key, 'signing'));

    /*
      Paint the expected result on the SIGNATURE, keep what it replaced.

      A write is sign, schedule, push, read. Only the last three are the
      chain's one to forty-five seconds; the first is the player reading their
      wallet's dialog, and it ends in an approval or a rejection. This used to
      paint on the CLICK, which meant a rejected signature moved the energy
      bar, spent a berry on screen and then took both back — the projection
      animating a decision the player had not made yet.

      So the paint waits for `settling`: the item is signed, it is the chain's
      now, and every projection standing on that is one the player asked for.

      Only callers that pass a projection get this, and the rule for which may
      is in state/optimistic.ts: deterministic, discardable, visibly
      reversible. No rewards, ever.

      The rollback is identity-checked rather than unconditional. Between the
      click and the failure the record can legitimately have been replaced — by
      a visibility refresh, or by a second write finishing first — and putting
      the pre-click record back on top of that would undo somebody else's
      answer as well as this one.
    */
    let before = playerRef.current;
    let projected: Player | null = null;
    const paint = () => {
      // Re-read: the record may have moved between the click and the approval.
      before = playerRef.current;
      if (!optimistic || !before || projected) return;
      projected = optimistic(before);
      playerRef.current = projected;
      setPlayer(projected);
    };
    const rollback = () => {
      if (!projected) return;
      setPlayer((current) => (current === projected ? before : current));
      if (playerRef.current === projected) playerRef.current = before;
    };

    try {
      const reply = await withWritePhase((phase) => {
        setPhases((all) => new Map(all).set(key, phase));
        if (phase === 'settling') paint();
      }, fn);
      // Every player-facing handler answers with the whole player record, so
      // one assignment keeps every screen current. Passing whole records around
      // rather than hand-picked fields is deliberate — the Dumverse port traced
      // three separate crashes to a view that dropped them.
      if (reply && typeof reply === 'object' && 'address' in reply) {
        playerRef.current = reply as Player;
        setPlayer(reply as Player);
      } else {
        // A verb that does not answer with a record leaves the projection
        // standing on nothing. Drop it and let the next read decide.
        rollback();
      }
      if (success) toast.success(success);
      return reply;
    } catch (err) {
      rollback();
      toast.error(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      setPending((all) => {
        const next = new Set(all);
        next.delete(key);
        return next;
      });
      setPhases((all) => {
        const next = new Map(all);
        next.delete(key);
        return next;
      });
    }
  }, [toast]);

  const isPending = useCallback((key: string) => pending.has(key), [pending]);
  const writePhase = useCallback(
    (key: string) => phases.get(key) ?? null, [phases],
  );

  const value = useMemo<Ctx>(() => ({
    address, connecting, connect, disconnect, hasWallet,
    walletProvider, walletProviderName, publicAccess,
    player,
    // Connected but nothing known yet is still loading, however briefly the
    // request itself has been running.
    loadingPlayer: loadingPlayer || (!!address && !player && !loginError),
    loginError, refresh,
    factions, leaderboard, catalog, monsterIndex,
    tuning: catalog?.tuning ?? FALLBACK_TUNING,
    challenges, refreshChallenges,
    busy: pending.size > 0, isPending, writePhase, run,
    processId: GAME_PROCESS, node: HB_NODE,
  }), [
    address, connecting, connect, disconnect, hasWallet,
    walletProvider, walletProviderName, publicAccess,
    player, loadingPlayer, loginError, refresh,
    factions, leaderboard, catalog, monsterIndex, challenges, refreshChallenges,
    pending, isPending, writePhase, run,
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
