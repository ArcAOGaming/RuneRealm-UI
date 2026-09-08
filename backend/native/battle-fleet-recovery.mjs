/** Pure recovery planning for the Phase-1 battle fleet operator. */

const text = (value) => (typeof value === 'string' ? value : '');

export function settlementIdFor(row) {
  const workerId = text(row?.workerId);
  const battleId = text(row?.battleId);
  return workerId && battleId ? `${workerId}-${battleId}` : '';
}

/**
 * Select exactly one recovery operation for a live authority reservation.
 * Worker terminal delivery wins over cancellation; cancelling an already
 * settled worker is the failure mode this planner exists to prevent.
 */
export function planLiveFleetRecovery(row, battle, now = Date.now()) {
  if (!row || !text(row.reservationId)) return null;
  const common = {
    reservationId: row.reservationId,
    battleId: row.battleId,
    workerId: row.workerId,
    workerProcessId: row.workerProcessId,
  };

  if (battle?.id === row.battleId
      && battle.status === 'ended'
      && battle.settlementStatus === 'pending') {
    const settlementId = settlementIdFor(row);
    if (!settlementId || !text(row.workerProcessId)) return null;
    return {
      ...common,
      target: row.workerProcessId,
      action: 'Fleet.Settlement.Retry',
      tags: { SettlementId: settlementId },
      reason: 'worker-terminal-settlement-pending',
    };
  }

  if (battle?.id === row.battleId
      && battle.status === 'cancelled'
      && battle.cancellationStatus === 'pending'
      && text(row.cancelId) && text(row.workerProcessId)) {
    return {
      ...common,
      target: row.workerProcessId,
      action: 'Fleet.Cancellation.Retry',
      tags: { CancelId: row.cancelId },
      reason: 'worker-terminal-cancellation-pending',
    };
  }

  if (row.status === 'cancel-pending') {
    if (!battle) {
      return {
        ...common,
        target: 'game',
        action: 'Admin.RetryFleetOpen',
        tags: { ReservationId: row.reservationId },
        reason: 'cancel-pending-worker-open-outcome-missing',
      };
    }
    return {
      ...common,
      target: 'game',
      action: 'Admin.RetryFleetCancel',
      tags: { ReservationId: row.reservationId },
      reason: 'authority-cancellation-pending',
    };
  }

  // `reserved` means the authority has not durably observed Opened. Whether
  // the worker has an active battle or a retained rejection, replaying the
  // immutable Open makes it re-emit that exact stable outcome. Do this even
  // after ticket expiry: a worker that never saw it will deterministically
  // reject it, which is the authoritative refund path.
  if (row.status === 'reserved') {
    return {
      ...common,
      target: 'game',
      action: 'Admin.RetryFleetOpen',
      tags: { ReservationId: row.reservationId },
      reason: battle ? 'authority-open-not-observed' : 'worker-open-outcome-missing',
    };
  }

  if (Number(row.expiresAt || 0) <= Number(now)) {
    return {
      ...common,
      target: 'game',
      action: 'Admin.ExpireFleetBattle',
      tags: { ReservationId: row.reservationId, Reason: 'fleet-reconciler-overdue' },
      reason: 'authority-reservation-overdue',
    };
  }
  return null;
}

/**
 * Retry all non-force final ACKs while their authority tombstone is retained.
 * This deliberately includes deliveryConfirmed=true: the authority may have
 * recorded FinalAcked while its following Release was lost. The duplicate ACK
 * handshake regenerates the same confirmation and release without replaying a
 * reward/refund.
 */
export function planFinalFleetRecovery(row, now = Date.now(), replayWindow = 0) {
  if (!row || row.kind === 'force' || !text(row.reservationId)) return null;
  const finalizedAt = Number(row.finalizedAt || 0);
  /*
    The replay window bounds a CONFIRMED final only.

    A confirmed tombstone is chasing a lost `Fleet.FinalAcked.Release`, and
    `Authority.advance` prunes it once `protectUntil` passes — so retrying past
    the window is retrying something the authority is about to forget, and it is
    right to stop.

    An UNCONFIRMED one is the opposite. `advance` never prunes it ("a restore
    may never take something away" applies here too: the tombstone is the only
    record that the reward was already paid), and the worker holds its pending
    final forever against `pendingLimit`. Ageing it out of the plan is how a
    stall becomes permanent — measured on production 2026-09-08, where `fc11`
    sat unconfirmed for 5.9 hours and this planner had stopped offering it as a
    job while `battle-worker-02` still read `pendingFinals: 1`.
  */
  if (row.deliveryConfirmed === true
      && Number(replayWindow) > 0 && finalizedAt > 0
      && Number(now) > finalizedAt + Number(replayWindow)) return null;
  return {
    reservationId: row.reservationId,
    battleId: row.battleId,
    workerId: row.workerId,
    workerProcessId: row.workerProcessId,
    target: 'game',
    action: 'Admin.RetryFleetAck',
    tags: { ReservationId: row.reservationId },
    reason: row.deliveryConfirmed
      ? 'release-may-be-undelivered'
      : 'final-ack-unconfirmed',
  };
}
