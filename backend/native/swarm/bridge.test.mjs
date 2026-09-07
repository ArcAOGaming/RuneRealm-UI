import assert from 'node:assert/strict';
import test from 'node:test';

import { makeBridge } from './bridge.mjs';

class OutboxDeliveryError extends Error {
  constructor(slot) {
    super('accepted but unconfirmed');
    this.accepted = true;
    this.durable = true;
    this.slot = slot;
  }
}

const result = (action, player, detail) => ({ action, player, ...detail });

test('accepted Rune bridge deliveries become reconcilable outcomes, not retries', async () => {
  const api = {
    OutboxDeliveryError,
    withdrawRune: async () => { throw new OutboxDeliveryError(7); },
    depositRuneToGame: async () => { throw new OutboxDeliveryError(8); },
  };
  const bridge = makeBridge({ api, address: 'a'.repeat(43), result, random: () => 0.5 });
  const player = { address: 'a'.repeat(43) };
  assert.deepEqual(await bridge.withdraw(player, 2), {
    action: 'rune.withdraw', player, amount: 2,
    deliveryState: 'accepted-delivery-unconfirmed', slot: 7,
  });
  assert.deepEqual(await bridge.deposit(player, '2000000'), {
    action: 'rune.deposit', player, amount: '2000000',
    deliveryState: 'accepted-delivery-unconfirmed', slot: 8,
  });
});

test('an unaccepted bridge failure is still fatal', async () => {
  const expected = new Error('not scheduled');
  const api = {
    OutboxDeliveryError,
    withdrawRune: async () => { throw expected; },
    depositRuneToGame: async () => { throw expected; },
  };
  const bridge = makeBridge({ api, address: 'a'.repeat(43), result, random: () => 0.5 });
  await assert.rejects(bridge.withdraw({}, 1), expected);
  await assert.rejects(bridge.deposit({}, '1000000'), expected);
});
