/**
 * The wardrobe: what is worn, and what colour it is dyed.
 *
 * One category at a time. The parked customiser stacked all six on the page as
 * a dropdown and a rainbow bar each, which meant the control you wanted was
 * always below the fold and the character you were dressing was never on the
 * same screen as it. Six chips pick a category, the garments in it are shown as
 * the body actually wearing them, and the dye grid underneath belongs to
 * whichever one is selected.
 *
 * The tiles are the real win. A list of the words "None / Coat / Shirt /
 * T-shirt" tells you nothing about a T-shirt, and every one of these is four
 * frames of 48x60 pixel art that the browser has already downloaded — so each
 * tile is the body wearing that garment, in the colour it is currently dyed,
 * cropped to the sprite's own bounding box.
 *
 * This is a fixed-height column, because the page it sits on does not scroll.
 * The chips and the tiles claim what they need; the dye grid takes whatever is
 * left. That ordering matters: a garment tile that shrinks stops being
 * recognisable, whereas a swatch that goes from a square to a letterbox is
 * still a swatch.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CATEGORIES, compositeOne, blitFrame, hsl, isNone, SPRITE_CROP,
  type CategoryName, type Outfit, type Piece,
} from '../../lib/sprites';
import { Button, cx } from '../primitives';
import { Swatches } from './Swatches';

const CROP = SPRITE_CROP;
const TILE_SCALE = 3;

/**
 * Tile width, fixed rather than a share of the row.
 *
 * A grid whose columns divide by the number of options makes a two-option
 * category (Hat, Gloves, Shoes) draw two tiles twice the size of the five in
 * Pants, and switching between them resizes the block and shoves the dye grid
 * down the panel. Fixed width, centred, so every category is the same height
 * and only the number of tiles changes.
 */
const TILE_W = 56;

/** The frame a tile poses in: facing the viewer, standing still. */
const TILE_FRAME = 'idle_down_00.png';

export function Wardrobe({
  outfit, onChange,
}: {
  outfit: Outfit;
  onChange: (next: Outfit) => void;
}) {
  const [active, setActive] = useState<CategoryName>(CATEGORIES[0]?.name ?? 'Hair');
  const category = CATEGORIES.find((c) => c.name === active) ?? CATEGORIES[0];
  const piece = outfit[active];
  const worn = piece && !isNone(piece.style);

  const set = (name: CategoryName, next: Partial<Piece>) =>
    onChange({ ...outfit, [name]: { ...outfit[name], ...next } });

  if (!category || !piece) return null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
      {/* Which category. Each chip carries its own dye, so the outfit's whole
          palette is readable without opening anything. */}
      <div className="grid shrink-0 grid-cols-3 gap-1.5">
        {CATEGORIES.map((c) => {
          const p = outfit[c.name];
          const on = p && !isNone(p.style);
          const selected = c.name === active;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => setActive(c.name)}
              aria-pressed={selected}
              className={cx(
                'wardrobe-tab flex min-h-11 items-center gap-2 rounded-[3px] border px-2 py-1 text-left lg:min-h-0',
                'text-[12px] transition-colors',
                selected
                  ? 'border-element/60 bg-element/10 text-element'
                  : 'border-edge bg-raised/60 text-muted hover:text-ink',
              )}
            >
              <span
                aria-hidden
                className={cx('h-3 w-3 shrink-0 rounded-[1px]', !on && 'border border-dashed border-faint/70')}
                style={on ? { background: p.color, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.4)' } : undefined}
              />
              <span className="truncate">{c.name}</span>
            </button>
          );
        })}
      </div>

      <div className="inlay shrink-0" />

      {/* The garments in the selected category. */}
      <div className="shrink-0">
        {/* No heading over these. The selected chip above already names the
            category and every tile is labelled with its own garment, so a
            "HAIR / Short" row was twenty-four pixels spent restating two things
            that were already on screen — and on a short window those pixels
            came out of the dye grid. */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {category.options.map((option) => (
            <Tile
              key={option.name}
              category={category.name}
              option={option.name}
              color={piece.color}
              active={option.name === piece.style}
              onSelect={() => set(category.name, { style: option.name })}
            />
          ))}
        </div>
      </div>

      <div className="inlay shrink-0" />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex shrink-0 items-baseline justify-between gap-3">
          <span className="eyebrow">Dye</span>
          <Button
            size="sm" variant="quiet"
            disabled={!worn}
            onClick={() => set(category.name, {
              color: hsl(Math.random() * 360, 0.25 + Math.random() * 0.4, 0.28 + Math.random() * 0.3),
            })}
          >
            Surprise me
          </Button>
        </div>
        {/*
          With nothing on, the grid stays exactly where it is — dimmed, inert,
          and captioned. It used to be swapped for a dashed placeholder box,
          which was a different shape from the thing it replaced: the column is
          a fixed height with one flexible child, so a substitute of a different
          size made every other row redistribute, and picking `None` visibly
          shoved the tiles and the chips around. Nothing on is a state of this
          control, not a different control.
        */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Swatches
            value={piece.color}
            disabled={!worn}
            onChange={(color) => set(category.name, { color })}
          />
          {!worn && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded-[3px] border border-edge/70 bg-void/85 px-2.5 py-1 text-center text-[11px] text-muted backdrop-blur-sm">
                Nothing on — choose one above to dye it
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One garment, on the body, in its current dye.
 *
 * The sheet is composited into a scratch canvas owned by this tile rather than
 * a shared one: the composite is async, four of these mount at once, and a
 * shared scratch means whichever finishes last is the one every tile ends up
 * cropping from.
 */
function Tile({
  category, option, color, active, onSelect,
}: {
  category: string;
  option: string;
  color: string;
  active: boolean;
  onSelect: () => void;
}) {
  const viewRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const none = isNone(option);

  useEffect(() => {
    let dead = false;
    const view = viewRef.current;
    if (!view) return;

    const sheet = scratchRef.current ?? (scratchRef.current = document.createElement('canvas'));

    compositeOne(category, option, color, sheet).then(() => {
      if (dead) return;
      const ctx = view.getContext('2d');
      if (!ctx) return;

      view.width = CROP.w * TILE_SCALE;
      view.height = CROP.h * TILE_SCALE;
      ctx.clearRect(0, 0, view.width, view.height);
      blitFrame(sheet, ctx, TILE_FRAME, 0, 0, TILE_SCALE, CROP);
    }).catch(() => { /* a missing layer is already reported by the compositor */ });

    return () => { dead = true; };
  }, [category, option, color]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={option}
      style={{ width: TILE_W }}
      className={cx(
        'garment-tile group relative overflow-hidden rounded-[3px] border p-1 transition-colors',
        active
          ? 'border-element/70 bg-element/10'
          : 'border-edge bg-void/40 hover:border-element/40 hover:bg-raised/50',
      )}
    >
      {/* A plinth of element light, so the sprite stands on something. */}
      <span
        aria-hidden
        className={cx(
          'pointer-events-none absolute inset-x-0 bottom-0 h-2/3 transition-opacity',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60',
        )}
        style={{
          background: 'radial-gradient(70% 100% at 50% 118%, rgb(var(--element) / 0.35), transparent 70%)',
        }}
      />
      <canvas
        ref={viewRef}
        aria-hidden
        className="relative mx-auto block w-full [image-rendering:pixelated]"
        style={{ aspectRatio: `${CROP.w} / ${CROP.h}` }}
      />
      <span
        className={cx(
          'relative mt-0.5 block truncate text-center text-[11px]',
          active ? 'text-element' : 'text-faint group-hover:text-muted',
        )}
      >
        {none ? 'None' : option}
      </span>
    </button>
  );
}
