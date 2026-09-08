/**
 * The membership mark — "this wallet is in the game", remembered locally.
 *
 * Everything past the front door is gated on the process having a record for
 * the connected wallet, and that answer arrives over the network seconds after
 * the page does. Without a local copy the first paint of every deep link is
 * either a spinner or, worse, a redirect home that the real answer then has to
 * undo. So the moment a wallet is confirmed to be a player, the verdict is
 * written here and the next load renders the game immediately.
 *
 * Three things scope the mark, and all three have to match before it is
 * believed:
 *
 *   - the GAME PROCESS it was earned against. A redeploy is a different game
 *     with a different player list, and a mark from the old one is a wallet
 *     the new process has never heard of.
 *   - the WALLET. Marks are stored per address, so switching accounts in the
 *     extension cannot hand one player's access to another.
 *   - the browser's own storage being readable at all. Private mode throws on
 *     the accessor rather than returning null, so every call here is wrapped.
 *
 * The mark is a CACHE, never the authority. It decides what the first paint
 * shows; the account read that follows overwrites it, and clears it when the
 * process says the wallet is not a player after all. Forging one buys nothing
 * — every action is still a signed message the process verifies for itself.
 */
import { GAME_PROCESS } from './hyperbeam';

/** One key, holding the most recently confirmed wallet. */
const KEY = 'rr.member';

export type MemberMark = {
  /** The game process this verdict was reached against. */
  process: string;
  /** The wallet it belongs to. */
  address: string;
  /** The faction sworn at the time, or null if the oath was still to come. */
  faction: string | null;
  /** When it was written, for a human reading the storage inspector. */
  at: number;
};

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The remembered verdict, or null.
 *
 * A mark from another process is not stale, it is wrong — so it is dropped on
 * sight rather than left to be re-checked on every read.
 */
export function readMemberMark(): MemberMark | null {
  const local = store();
  if (!local) return null;
  try {
    const raw = local.getItem(KEY);
    if (!raw) return null;
    const mark = JSON.parse(raw) as Partial<MemberMark>;
    if (!mark || typeof mark.address !== 'string' || !mark.address) return null;
    if (mark.process !== GAME_PROCESS) {
      local.removeItem(KEY);
      return null;
    }
    return {
      process: GAME_PROCESS,
      address: mark.address,
      faction: typeof mark.faction === 'string' && mark.faction ? mark.faction : null,
      at: typeof mark.at === 'number' ? mark.at : 0,
    };
  } catch {
    return null;
  }
}

/** Remember that this wallet is a player, and what it had sworn. */
export function writeMemberMark(address: string, faction: string | null): MemberMark {
  const mark: MemberMark = { process: GAME_PROCESS, address, faction, at: Date.now() };
  try {
    store()?.setItem(KEY, JSON.stringify(mark));
  } catch {
    /* private mode: the mark is a cache, so losing it costs a spinner */
  }
  return mark;
}

/** Forget it — the wallet disconnected, or the process disowned it. */
export function clearMemberMark(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* nothing to do about a storage that will not answer */
  }
}
