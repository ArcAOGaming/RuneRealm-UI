/**
 * The arena floor, above the fighter cards.
 *
 * A lazy boundary over the Phaser scene, for the same reason as `Room.tsx`:
 * the engine is only worth downloading once there is a fight to draw.
 */
import { Suspense, lazy } from 'react';
import { Battle, Combatant } from '../lib/types';
import { cx } from './primitives';

const Impl = lazy(() => import('./BattleStageImpl'));

export function BattleStage(props: {
  battle: Battle; me: Combatant; them: Combatant; className?: string;
  /** Take height from the flex parent rather than the 16:9 aspect ratio. */
  fill?: boolean;
  /** Scene only — no corner plates. For the companion screen's glance at it. */
  bare?: boolean;
  /** Fires once the last round has finished PLAYING, not when it resolved. */
  onSettled?: () => void;
}) {
  return (
    <Suspense
      fallback={(
        <div
          className={cx(
            'animate-pulse rounded-[3px] border border-rune/12 bg-raised/40',
            props.fill && 'min-h-0 flex-1',
            props.className,
          )}
          style={props.fill ? undefined : { aspectRatio: '384 / 216' }}
        />
      )}
    >
      <Impl {...props} />
    </Suspense>
  );
}
