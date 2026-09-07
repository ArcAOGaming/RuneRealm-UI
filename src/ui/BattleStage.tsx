/**
 * The arena floor, above the fighter cards.
 *
 * A lazy boundary over the Phaser scene, for the same reason as `Room.tsx`:
 * the engine is only worth downloading once there is a fight to draw.
 */
import { Suspense, lazy } from 'react';
import { Battle, Combatant, Move, Tuning } from '../lib/types';
import { cx } from './primitives';

const Impl = lazy(() => import('./BattleStageImpl'));

/**
 * Rally and Mend, for the studs under each fighter's readout.
 *
 * Passed down rather than imported because they are process state: they are
 * deliberately absent from `movePools` so one cannot be smuggled into a stored
 * roster, which also means the client has no other way to learn they exist. A
 * process deployed before they did publishes none and no stud renders.
 */
export type FreeActions = {
  actions: Record<string, Omit<Move, 'name'> & { name?: string }>;
  tuning: Tuning;
  /** Locked while the fight is decided or somebody else is mid-round. */
  disabled: boolean;
  busy: boolean;
  isPending: (name: string) => boolean;
  onMove: (name: string) => void;
};

export function BattleStage(props: {
  battle: Battle; me: Combatant; them: Combatant; className?: string;
  /** Take height from the flex parent rather than the 16:9 aspect ratio. */
  fill?: boolean;
  /** Scene only — no corner plates. For the companion screen's glance at it. */
  bare?: boolean;
  /**
   * Rally and Mend, drawn on the floor beside the health and shield they
   * spend. Omitted by every read-only mount, which is why `bare` needs no say
   * in it.
   */
  free?: FreeActions;
  /** Fires once the last round has finished PLAYING, not when it resolved. */
  onSettled?: () => void;
  /** Fires the instant a blow connects, for the page's own reaction to it. */
  onImpact?: (side: 'challenger' | 'accepter', lethal: boolean) => void;
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
