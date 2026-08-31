#!/usr/bin/env node
/**
 * Turbo credits: check them, and buy more without a card.
 *
 *   node backend/native/turbo.mjs balance
 *   node backend/native/turbo.mjs balance --address <arweave address>
 *   node backend/native/turbo.mjs topup 1.5              # 1.5 AR -> credits
 *   node backend/native/turbo.mjs topup 0.05 --token solana
 *   node backend/native/turbo.mjs price 45              # what 45 MiB costs
 *
 * Credits are held against an ADDRESS, not against a wallet type, and
 * `turboCreditDestinationAddress` decouples the two: pay from a Solana or
 * Ethereum key and credit the Arweave address that actually signs the uploads.
 * That is why `--token` exists and why the destination defaults to DEPLOY_KEY's
 * address rather than to the payer's.
 *
 * A card top-up at https://turbo.ar.io does the same job. It is also the
 * expensive door: measured 2026-08-30, the fiat rate priced 1 GiB at $39.41
 * while the same bytes cost 12.199 AR, about $25.74 at spot. If the wallet
 * already holds AR, spend that.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const USAGE = 'usage: turbo.mjs balance|topup <amount>|price <MiB> [--token <t>] [--address <a>] [--yes]';
const ar = (winc) => (Number(winc) / 1e12).toFixed(6);
const isId = (value) => /^[A-Za-z0-9_-]{43}$/.test(value || '');

/** Arweave address of an RSA JWK: sha256 of the raw modulus, base64url. */
const addressOf = (jwk) =>
  crypto.createHash('sha256').update(Buffer.from(jwk.n, 'base64url')).digest('base64url');

function arweaveKey() {
  const configured = (process.env.DEPLOY_KEY || '').trim();
  if (configured) {
    const text = configured.startsWith('{')
      ? configured
      : Buffer.from(configured.replace(/\s+/g, ''), 'base64').toString('utf8');
    return JSON.parse(text);
  }
  const file = process.env.HB_WALLET;
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  throw new Error('set DEPLOY_KEY (base64 JWK) or HB_WALLET (path to a keyfile)');
}

const { TurboFactory } = await import('@ardrive/turbo-sdk');

// balance --------------------------------------------------------------------

if (command === 'balance') {
  const explicit = flag('--address');
  const address = explicit ?? addressOf(arweaveKey());
  if (!isId(address)) throw new Error(`not an Arweave address: ${address}`);

  const turbo = TurboFactory.unauthenticated();
  let balance;
  try {
    balance = await turbo.getBalance(address);
  } catch (error) {
    // Turbo answers "User Not Found" for an address that has never held
    // credits, which is a zero balance and not a failure.
    if (/not found/i.test(String(error?.message))) balance = { winc: '0', effectiveBalance: '0' };
    else throw error;
  }

  console.log(`address          ${address}`);
  console.log(`credits          ${balance.winc} winc  (~${ar(balance.winc)} AR of upload power)`);
  if (balance.effectiveBalance && balance.effectiveBalance !== balance.winc) {
    console.log(`incl. approvals  ${balance.effectiveBalance} winc`);
  }
  const perGiB = await turbo.getUploadCosts({ bytes: [1024 ** 3] });
  const gib = Number(balance.winc) / Number(perGiB[0].winc);
  console.log(`buys             ${gib.toFixed(3)} GiB at today's price`);
  process.exit(0);
}

// price ----------------------------------------------------------------------

if (command === 'price') {
  const mebibytes = Number(argv[1]);
  if (!Number.isFinite(mebibytes) || mebibytes <= 0) throw new Error(USAGE);
  const bytes = Math.round(mebibytes * 1024 * 1024);
  const turbo = TurboFactory.unauthenticated();
  const [cost] = await turbo.getUploadCosts({ bytes: [bytes] });
  console.log(`${mebibytes} MiB = ${bytes} bytes`);
  console.log(`costs            ${cost.winc} winc  (~${ar(cost.winc)} AR of credit)`);
  console.log('note             data items under 100 KiB are free and need no credits at all');
  process.exit(0);
}

// topup ----------------------------------------------------------------------

if (command === 'topup') {
  const amount = Number(argv[1]);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(USAGE);

  const token = flag('--token') || 'arweave';
  const destination = flag('--address') || addressOf(arweaveKey());
  if (!isId(destination)) throw new Error(`not an Arweave address: ${destination}`);

  // Smallest unit per token: winston for AR, lamports for SOL, wei for ETH.
  const SMALLEST_UNIT = { arweave: 1e12, solana: 1e9, ethereum: 1e18, 'base-eth': 1e18 };
  const scale = SMALLEST_UNIT[token];
  if (!scale) {
    throw new Error(`--token ${token} needs its smallest-unit scale adding to SMALLEST_UNIT`);
  }
  const tokenAmount = BigInt(Math.round(amount * scale)).toString();

  // The payer's key: the Arweave JWK for AR, or TURBO_FUND_KEY for anything
  // else. Nothing else in this repo holds a non-Arweave key, deliberately.
  const privateKey = token === 'arweave' ? arweaveKey() : process.env.TURBO_FUND_KEY;
  if (!privateKey) throw new Error(`TURBO_FUND_KEY is required to pay with ${token}`);

  const turbo = TurboFactory.authenticated({ privateKey, token });
  const quote = await turbo.getWincForToken({ tokenAmount });

  console.log(`paying           ${amount} ${token}`);
  console.log(`crediting        ${destination}`);
  console.log(`buys             ${quote.winc} winc  (~${ar(quote.winc)} AR of upload power)`);

  if (!argv.includes('--yes')) {
    console.log('');
    console.log('This spends real funds. Re-run with --yes to execute.');
    process.exit(0);
  }

  const result = await turbo.topUpWithTokens({
    tokenAmount,
    turboCreditDestinationAddress: destination,
  });
  console.log('');
  console.log('=== TOP UP SUBMITTED ===');
  console.log(`TX=${result.id ?? result.transactionId ?? '(see response)'}`);
  console.log(`WINC=${result.winc ?? quote.winc}`);
  console.log(`DESTINATION=${destination}`);
  process.exit(0);
}

throw new Error(USAGE);
