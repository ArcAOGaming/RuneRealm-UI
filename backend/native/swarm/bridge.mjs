/**
 * The Rune bridge: game balance out to a wallet, and back in.
 *
 * These are the two things the swarm had never touched. The bridge was proven
 * once by hand and then never exercised again, so it sat unexercised through
 * every soak while the coverage report called the economy covered.
 *
 * Two actions, and they are deliberately a CYCLE rather than two independent
 * probes:
 *
 *   withdraw   game Rune  -> TEST-RUNE in the wallet   (queued mint, async)
 *   deposit    TEST-RUNE  -> game Rune                 (burn, via Burn-Notice)
 *
 * A fleet that only withdrew would drain the game's Rune into wallets and stop
 * being able to quest or fight; one that only deposited would run out. Both
 * halves carry weight on every role that has either.
 *
 * The pool verbs that used to live here -- liquidity, trade, refund and
 * removeLiquidity -- went with the AMM. What trades the token pair is an order
 * book, and when its process exists the swarm should exercise it the way it
 * exercises the internal book: by placing and taking resting orders, not by
 * swapping against a curve.
 *
 * Everything goes through the shipped client verbs, same rule as the rest of
 * the worker.
 */

/** Atomic units are strings everywhere in the token protocol. */
const big = (value) => {
  try { return BigInt(String(value ?? '0')); } catch { return 0n; }
};

export function makeBridge({ api, address, result, random }) {
  /**
   * Withdraw game Rune to the token.
   *
   * The reply comes back `pending`: the game deducts, queues, and pushes a mint
   * to the token, and only settlement makes it real. That asynchrony is exactly
   * why this is worth doing repeatedly rather than once by hand -- a bridge
   * that deducts and never delivers is indistinguishable from a working one for
   * a single request, and only shows up as a queue that stops draining.
   */
  async function withdraw(player, amount) {
    const updated = await api.withdrawRune(amount);
    /*
      Keep the player we came in with when the reply does not carry one.

      `withdrawRune` normally answers with the account, but when the token's
      confirmation read times out it falls through to a status-only verdict —
      deliberately, because reporting a success that did not happen is the worse
      error. That verdict is the truth about the WITHDRAWAL and is not a player,
      so passing it through as one printed `L- undefinedr undefinedbox` for every
      withdraw in the 2026-09-04 soak and threw away the actor's state for that
      tick. The withdrawal detail below is unaffected either way.
    */
    return result('rune.withdraw', updated?.address ? updated : player, {
      amount,
      reference: updated?.withdrawal?.reference ?? null,
      state: updated?.withdrawal?.state ?? 'pending',
    });
  }

  /** Burn tokens back into the game balance. The other half of the bridge. */
  async function deposit(player, amount) {
    const receipt = await api.depositRuneToGame(String(amount));
    return result('rune.deposit', player, {
      amount: String(amount),
      reference: receipt?.Reference ?? null,
      tokenBalance: receipt?.Balance ?? null,
    });
  }

  return { withdraw, deposit };
}
