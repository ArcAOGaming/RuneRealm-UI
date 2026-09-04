/**
 * Daily worship — the realm's one faucet, kept in the top bar.
 *
 * It used to be a banner on the companion screen, which meant the one thing a
 * returning player should do first was invisible from every other page and
 * competed with the companion card for the top of the screen. It is a chip in
 * the header now: a button while it is claimable, a quiet countdown while it is
 * not, and never a button that exists all day and fails for twenty hours of it.
 */
import { useEffect, useState } from 'react';
import { useGame } from '../state/gameContext';
import * as api from '../lib/game';
import { Player } from '../lib/types';
import { article, countdown, LOOTBOX_TIER } from '../lib/format';
import { Button, cx } from './primitives';
import { Clock, Gift, Sparkle } from './icons';
import { Dialog } from './Dialog';

export function Worship() {
  const { player, run, isPending } = useGame();
  const [now, setNow] = useState(() => Date.now());
  const [reward, setReward] = useState<Player['dailyClaimed'] | null>(null);

  const readyAt = player?.dailyReadyAt ?? 0;
  const ready = readyAt === 0 || now >= readyAt;

  useEffect(() => {
    if (ready) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ready]);

  const claim = async () => {
    const reply = await run('daily', api.claimDaily);
    if (reply?.dailyClaimed) setReward(reply.dailyClaimed);
  };

  if (!player?.unlocked) return null;

  // The reward dialog has to survive the moment of claiming, which is exactly
  // when `ready` flips to false — so the not-ready branch cannot return early
  // past it.
  return (
    <>
      {ready ? (
        <Button
          size="sm" variant="primary" busy={isPending('daily')} onClick={claim}
          data-tour="worship"
          title="Claim your daily worship: Runes and a loot box"
          icon={<Sparkle className="h-4 w-4" />}
        >
          Worship
        </Button>
      ) : (
        <span
          data-tour="worship"
          title="Your next daily worship"
          className={cx(
            'hidden h-8 items-center gap-1.5 rounded-[3px] border border-edge',
            'bg-raised/60 px-2.5 text-xs text-muted sm:flex',
          )}
        >
          <Clock className="h-3.5 w-3.5 text-faint" />
          <span className="font-mono tabular-nums">{countdown(readyAt - now)}</span>
        </span>
      )}

      {reward && (
        <Dialog title="Daily worship" onClose={() => setReward(null)} size="sm" className="text-center">
          <div className="mt-4">
            <Sparkle className="mx-auto h-10 w-10 text-element" />
            {(() => {
              const tier = (LOOTBOX_TIER[reward.lootboxRarity]
                ?? `tier ${reward.lootboxRarity}`).toLowerCase();
              // A zero payout is a real, deliberate state — Rune emission ships
              // paused — so say what was actually received and why, rather than
              // printing "+0 Runes" and leaving the player to conclude the
              // faucet is broken. The reason is the process's own words.
              const paid = reward.runes > 0;
              return (
                <>
                  <p className="mt-4 text-sm text-muted">
                    Your offering is accepted:{' '}
                    {paid && (
                      <>
                        <span className="font-mono text-element">+{reward.runes}</span> Runes and{' '}
                      </>
                    )}
                    {`${article(tier)} ${tier} loot box.`}
                  </p>
                  {!paid && (
                    <p className="mt-2 text-xs text-faint">
                      {reward.runeRewardReason ?? 'Rune rewards are paused.'}
                    </p>
                  )}
                </>
              );
            })()}
            <Button className="mt-5 w-full" variant="primary" onClick={() => setReward(null)}
                    icon={<Gift className="h-4 w-4" />}>
              Thanks
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
