/**
 * The companion screen's window onto a fight already in progress.
 *
 * While a companion is at the arena its room is empty, and the old screen said
 * so by dimming the house and desaturating a sprite standing in it — which is
 * a picture of an absence. The fight is the more interesting thing and it is
 * already rendered; this shows that instead, and clicking it goes there.
 *
 * Scene only. No move grid, no timeline, no corner plates — this is a glance,
 * not a second copy of the arena screen. The bars over the fighters stay,
 * because "how is it going" is the whole reason to look.
 *
 * It occupies EXACTLY the room's box — 384x192, the house plates' own shape —
 * so switching between "at home" and "at the arena" does not resize the panel
 * or shove everything under it up and down the page. The arena plates are
 * 384x216, so the difference is cropped off the top: 24 rows of ceiling or sky,
 * which is the part of an arena with nothing happening in it. The floor, both
 * fighters and the bars over them are all below the cut.
 */

/** The room's box. The arena scene is taller and is cropped into it. */
const BOX_W = 384;
const BOX_H = 192;
const SCENE_H = 216;
import { Link } from 'react-router-dom';
import { Battle } from '../lib/types';
import { BattleStage } from './BattleStage';
import { cx } from './primitives';

export function ArenaPeek({
  battle, address, className,
}: { battle: Battle; address?: string | null; className?: string }) {
  const iAmChallenger = battle.challenger?.address === address;
  const me = iAmChallenger ? battle.challenger : battle.accepter;
  const them = iAmChallenger ? battle.accepter : battle.challenger;
  if (!me || !them) return null;

  const over = battle.status === 'ended';

  return (
    <Link
      to="/arena"
      aria-label={over ? 'See how the fight ended' : 'Back to the fight'}
      className={cx(
        'group relative block overflow-hidden rounded-[3px] border border-edge/70',
        'transition-colors hover:border-element/50',
        className,
      )}
    >
      {/* The inner box keeps the scene's true 16:9 so nothing inside it is
          squashed; the outer one is shorter and clips. Anchored to the bottom,
          so the crop always eats the top. */}
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${BOX_W} / ${BOX_H}` }}>
        <div className="absolute bottom-0 left-0 w-full" style={{ aspectRatio: `${BOX_W} / ${SCENE_H}` }}>
          <BattleStage battle={battle} me={me} them={them} bare className="h-full border-0" />
        </div>
      </div>

      {/* No "at the arena" caption here: the companion screen already carries
          a status chip saying exactly that, and the panel would be announcing
          the same fact twice within an inch of itself. */}
      {/* The affordance only needs to be legible, not loud — the whole panel is
          the target, so this is a label for it rather than a button in it. */}
      <span className={cx(
        'pointer-events-none absolute bottom-3 right-3 rounded-[3px] border px-2 py-1',
        'text-[11px] backdrop-blur-sm transition-colors',
        'border-element/40 bg-void/70 text-element group-hover:bg-element/15',
      )}>
        {over ? 'See the result' : 'Return to the fight'} →
      </span>
    </Link>
  );
}
