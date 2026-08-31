/**
 * The room — where your companion actually lives.
 *
 * A lazy boundary, and that is the whole file. The scene behind it pulls in
 * Phaser, which is ~1.5MB before gzip: bundled into the entry it would be
 * downloaded by everyone who opens the front door, to draw something only two
 * routes ever show. Behind `lazy()` it becomes a chunk that is fetched when a
 * companion is first put on screen.
 *
 * The fallback is a plate-shaped block rather than a spinner, so the page does
 * not reflow when the scene arrives.
 */
import { Suspense, lazy } from 'react';
import { ActivityReceipt, CharacterOutfit, Monster } from '../lib/types';
import { cx } from './primitives';

const RoomStage = lazy(() => import('./RoomStage'));

export function Room({
  monster,
  playerOutfit,
  playerSpriteTxId,
  activityReceipt,
  className,
}: {
  monster: Monster;
  playerOutfit?: CharacterOutfit;
  playerSpriteTxId?: string;
  activityReceipt?: ActivityReceipt;
  className?: string;
}) {
  return (
    <Suspense
      fallback={(
        <div
          className={cx(
            'animate-pulse rounded-[3px] border border-edge/70 bg-raised/40',
            className,
          )}
          style={{ aspectRatio: '384 / 192' }}
        />
      )}
    >
      <RoomStage
        monster={monster}
        playerOutfit={playerOutfit}
        playerSpriteTxId={playerSpriteTxId}
        activityReceipt={activityReceipt}
        className={className}
      />
    </Suspense>
  );
}
