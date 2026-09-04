/**
 * The Rune bridge and the AMM pair.
 *
 * These are the two things the swarm has never touched. The bridge was proven
 * once by hand and then never exercised again; the pair had no actor able to
 * fund it, so it has sat at zero reserves through every soak while the coverage
 * report called the economy covered.
 *
 * Four actions, and they are deliberately a CYCLE rather than four independent
 * probes:
 *
 *   withdraw   game Rune  -> TEST-RUNE in the wallet   (queued mint, async)
 *   liquidity  TEST-RUNE + TEST-RELIC -> pool shares   (deposit twice, then add)
 *   trade      swap one side of the pair for the other
 *   deposit    TEST-RUNE -> game Rune                  (burn, via Burn-Notice)
 *
 * A fleet that only withdrew would drain the game's Rune into wallets and stop
 * being able to quest or fight; one that only deposited would run out. Both
 * halves carry weight on every role that has either.
 *
 * Everything goes through the shipped client verbs, same rule as the rest of
 * the worker. The AMM's deposit protocol is two writes on purpose -- a transfer
 * the token turns into a Credit-Notice, then the action that spends the
 * credited balance -- so `liquidity` and `trade` fund themselves first and
 * report what they actually had to work with.
 */

/** Atomic units are strings everywhere in the token and AMM protocols. */
const big = (value) => {
  try { return BigInt(String(value ?? '0')); } catch { return 0n; }
};

export function makeBridge({ api, address, result, random }) {
  /**
   * What this wallet has credited to the pool but not yet spent.
   *
   * A credited deposit that went unconsumed -- a swap that failed its slippage
   * guard, an add-liquidity that only used the pool-ratio portion -- stays
   * here. Spending it before transferring more is cheaper, and it is the thing
   * most likely to expose a mis-credited balance.
   */
  async function credited() {
    try {
      const deposit = await api.readAmmDeposit(address);
      return { base: big(deposit?.base), quote: big(deposit?.quote) };
    } catch {
      return { base: 0n, quote: 0n };
    }
  }

  /** Top a credited side up to `want`, transferring only the shortfall. */
  async function fund(token, have, want, funded) {
    if (have >= want) return have;
    const balance = big(await api.readTokenBalance(token, address).catch(() => '0'));
    const short = want - have;
    const move = balance < short ? balance : short;
    if (move <= 0n) return have;
    await api.depositToken(token, move.toString());
    funded.push({ token, quantity: move.toString() });
    return have + move;
  }

  /** The faucet is public and refills a dry quote wallet. */
  async function topUpQuote(want, held, funded) {
    const balance = big(await api.readTokenBalance(api.QUOTE_PROCESS, address).catch(() => '0'));
    if (held >= want || balance >= want - held) return;
    await api.claimQuoteFaucet();
    funded.push({ token: api.QUOTE_PROCESS, quantity: 'faucet' });
  }

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
    return result('rune.withdraw', updated, {
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

  /**
   * Put both sides into the pair.
   *
   * The first provider sets the price, so the opening ratio is chosen rather
   * than random: one whole TEST-RELIC per TEST-RUNE. After that the pool's own
   * ratio decides how much of each deposit is consumed and the remainder stays
   * credited -- which is why this reports `baseUsed`/`quoteUsed` rather than
   * what it asked for.
   *
   * Amounts are small on purpose. Fifty actors each adding a little is a better
   * test of the share arithmetic than one actor adding a lot.
   */
  async function liquidity(player) {
    const pool = await api.readAmmPool().catch(() => null);
    if (!pool?.configured) {
      return result('amm.liquidity.skipped', player, { reason: 'pool is not configured' });
    }
    if (pool.paused) {
      return result('amm.liquidity.skipped', player, { reason: 'pool is paused' });
    }
    const funded = [];
    let { base, quote } = await credited();

    const wantBase = 2n;
    const quoteUnit = 10n ** BigInt(Number(pool.quoteDenomination ?? 6));
    let wantQuote = wantBase * quoteUnit;
    if (big(pool.reserveBase) > 0n && big(pool.reserveQuote) > 0n) {
      // Match the pool. Excess would simply stay credited and nothing would
      // break, but matching means the share reflects what was deposited.
      wantQuote = (wantBase * big(pool.reserveQuote)) / big(pool.reserveBase) + 1n;
    }

    await topUpQuote(wantQuote, quote, funded);
    await fund(pool.baseToken, base, wantBase, funded);
    await fund(pool.quoteToken, quote, wantQuote, funded);

    // Re-read what the pool has actually CREDITED, and add only that.
    //
    // A deposit is a transfer that the token turns into a Credit-Notice, and
    // the AMM credits it when that notice lands -- so the balance is not
    // credited the instant `depositToken` returns. Adding liquidity against a
    // local estimate of what was just transferred is how this earned eight
    // straight "Deposit both token amounts before adding liquidity" refusals:
    // the transfers were fine, they simply had not been credited yet.
    //
    // Nothing is lost by waiting. A credited deposit persists until it is spent,
    // so the next tick adds it.
    ({ base, quote } = await credited());
    if (base <= 0n || quote <= 0n) {
      return result('amm.liquidity.skipped', player, {
        reason: 'transfer sent; pool has not credited it yet',
        base: base.toString(), quote: quote.toString(), funded,
      });
    }

    const added = await api.ammAddLiquidity(base.toString(), quote.toString());
    return result('amm.liquidity.add', player, {
      shares: added?.shares ?? null,
      baseUsed: added?.baseUsed ?? null,
      quoteUsed: added?.quoteUsed ?? null,
      funded,
    });
  }

  /**
   * Swap one side of the pair for the other.
   *
   * `minOutput` is a real slippage guard derived from the pool the actor just
   * read, never zero. Zero would make every swap succeed no matter what the
   * pool did to the price, which is precisely the failure this exists to catch
   * -- fifty actors trading concurrently is the only situation where that guard
   * is ever load-bearing.
   */
  async function trade(player) {
    const pool = await api.readAmmPool().catch(() => null);
    if (!pool?.configured || pool.paused) {
      return result('amm.trade.skipped', player, {
        reason: pool?.paused ? 'pool is paused' : 'pool is not configured',
      });
    }
    if (big(pool.reserveBase) <= 0n || big(pool.reserveQuote) <= 0n) {
      return result('amm.trade.skipped', player, { reason: 'pool has no reserves' });
    }

    const funded = [];
    const useBase = random() < 0.5;
    const token = useBase ? pool.baseToken : pool.quoteToken;
    let { base, quote } = await credited();

    // Size the input from the LIVE reserves, never a fixed amount.
    //
    // TEST-RUNE has a denomination of ZERO, so the pool can only ever pay out
    // whole units of it, and the constant-product curve takes a 30 bps fee by
    // integer division before it divides again. Both roundings go to zero at
    // small size: one unit in is `1 * 9970 / 10000 = 0` before the curve is even
    // reached, and one whole TEST-RELIC against a ten-unit base reserve quotes
    // 0.9 and floors to nothing. Nine straight swaps skipped on "pool quotes
    // zero output" for exactly this reason, and a fixed input would keep doing
    // so until the reserves happened to grow past it.
    //
    // So walk the input up until the pool quotes at least one whole unit out,
    // and stop at a fifth of the reserve -- past that a single actor is moving
    // the price rather than trading against it.
    const reserveIn = big(useBase ? pool.reserveBase : pool.reserveQuote);
    const ceiling = reserveIn / 5n;
    let want = useBase ? 2n : 10n ** BigInt(Number(pool.quoteDenomination ?? 6)) / 10n;
    while (want <= ceiling && big(api.quoteFromPool(pool, token, want.toString())) <= 0n) {
      want *= 2n;
    }
    if (want > ceiling || big(api.quoteFromPool(pool, token, want.toString())) <= 0n) {
      return result('amm.trade.skipped', player, {
        reason: 'reserves too thin to quote a whole unit out',
        ticker: useBase ? pool.baseTicker : pool.quoteTicker,
        reserveIn: reserveIn.toString(), tried: want.toString(),
      });
    }

    if (useBase) {
      await fund(pool.baseToken, base, want, funded);
    } else {
      await topUpQuote(want, quote, funded);
      await fund(pool.quoteToken, quote, want, funded);
    }
    // Same rule as `liquidity`: a swap spends the CREDITED deposit, and a
    // transfer sent a moment ago may not be credited yet.
    ({ base, quote } = await credited());
    const held = useBase ? base : quote;
    if (held < want) {
      return result('amm.trade.skipped', player, {
        reason: 'transfer sent; pool has not credited it yet',
        ticker: useBase ? pool.baseTicker : pool.quoteTicker,
        held: held.toString(), want: want.toString(), funded,
      });
    }

    const expected = big(api.quoteFromPool(pool, token, want.toString()));
    if (expected <= 0n) {
      return result('amm.trade.skipped', player, { reason: 'pool quotes zero output', funded });
    }
    // Five percent of room: tight enough that a broken curve trips it, loose
    // enough that honest concurrent trading does not.
    const minOutput = (expected * 95n) / 100n;
    const swapped = await api.ammSwap(
      token, want.toString(), minOutput.toString(), Date.now() + 120_000,
    );
    return result('amm.trade.swap', player, {
      inputTicker: useBase ? pool.baseTicker : pool.quoteTicker,
      input: want.toString(),
      expected: expected.toString(),
      minOutput: minOutput.toString(),
      output: swapped?.swap?.output ?? null,
      funded,
    });
  }

  return { withdraw, deposit, liquidity, trade };
}
