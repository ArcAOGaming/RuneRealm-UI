/**
 * A move's own badge, cropped out of the card art.
 *
 * The move icons were already in the repo and already mapped. `5-moves/` holds
 * forty plates, each a full 648x1065 card layer carrying ONE 78x75 badge at one
 * of four known origins, and `lib/card/moves.mjs` maps every one of the game's
 * 42 moves to the badge that fits it — including the hand-made choices for the
 * moves whose art was drawn under a different name. The minted card has been
 * drawing them all along; nothing else had.
 *
 * So this shows the real badge rather than a generic element glyph.
 *
 * It crops with CSS, not a canvas: `background-position` walks the plate to the
 * badge and `background-size` scales it, which keeps one bundled image serving
 * every badge on it and costs no draw call. `image-rendering: pixelated` keeps
 * the upscale honest — these are small hand-drawn badges, and smoothing them is
 * the same mistake as smoothing the sprites.
 *
 * Falls back to a tinted type glyph when a move has no plate: `moveIcon`
 * returns null for anything not in the map, and a missing badge must not leave
 * a hole in the roster.
 */
import { moveIcon, ICON_W, ICON_H } from '../lib/card/moves.mjs';
import { cx } from './primitives';

/**
 * Every move plate, by the asset key `moveIcon()` returns.
 *
 * The same glob `lib/card/browser.ts` uses, keyed the same way, so the two
 * cannot disagree about which files exist.
 */
const PLATES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../assets/Monsters/cards/5-moves/*/*.png', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>,
  ).map(([key, url]) => [key.replace('../assets/', ''), url]),
);

export function hasMoveBadge(name: string): boolean {
  const icon = moveIcon(name);
  return !!icon && !!PLATES[icon.asset];
}

export function MoveBadge({
  name, size = 22, className,
}: { name: string; size?: number; className?: string }) {
  const icon = moveIcon(name);
  const url = icon ? PLATES[icon.asset] : null;
  if (!icon || !url) return null;

  // The badge is `size` tall; the whole plate is scaled by the same factor so
  // the crop lands on it.
  const scale = size / ICON_H;

  return (
    <span
      aria-hidden
      className={cx('block shrink-0 [image-rendering:pixelated]', className)}
      style={{
        width: ICON_W * scale,
        height: ICON_H * scale,
        backgroundImage: `url(${url})`,
        backgroundSize: `${648 * scale}px ${1065 * scale}px`,
        backgroundPosition: `-${icon.sx * scale}px -${icon.sy * scale}px`,
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}
