/**
 * The loot box ceremony, wired to the chain.
 *
 * The order matters and it is the whole point: the overlay opens the instant
 * the player clicks, with the chest already sealed and straining, and the write
 * is only then in flight. When the process answers, the seal breaks. The player
 * never waits at a spinner — they wait at a chest that is about to open, which
 * is the same number of seconds spent very differently.
 *
 * Two things were wrong with the first cut, and both were the frame around it.
 *
 * It lived in a `Dialog`, so the ceremony was rendered into a 248px letterbox
 * inside a panel: the blast, the shockwave ring and the lid's whole arc were
 * cropped off by the panel's own `overflow-hidden`. It is a full-viewport
 * overlay now. The chest has the entire screen to open into, which is what it
 * was built to do.
 *
 * And the rewards appeared as an HTML table under the canvas the moment the lid
 * moved, which cut the opening off mid-swing and replaced it with a list. The
 * rewards come out of the chest now — see `launchSpoils` in `gfx/vault` — and
 * nothing is written anywhere else until they have landed. When the ceremony is
 * over the overlay stands down on its own and leaves a small receipt behind,
 * dismissible, over a page you can already use again. The numbers are on the
 * receipt; the moment is in the room.
 *
 * If the write fails there is no reveal: the caller closes this and the toast
 * says why, rather than a chest bursting open on nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createVault, Spoil, Vault } from '../gfx/vault';
import { ITEM_ELEMENT, LOOTBOX_TIER } from '../lib/format';
import { LootResult } from '../lib/types';
import { ITEM_ART } from './art';
import { RUNE_PATH, X } from './icons';
import { cx } from './primitives';

/**
 * A picture for a reward that has none.
 *
 * `ITEM_ART` covers the berries and scrolls. It does not cover
 * Runes — and Runes are not only a drop, they are the FLOOR: a box that rolls
 * nothing at all is topped up with one (see `Game.OpenLootbox` in game.lua). So
 * the one haul most likely to arrive with no art was the one that came up
 * empty, and the chest opened onto nothing.
 *
 * The mark is struck to a canvas instead. It is the same path the Rune icon
 * draws everywhere else in the app.
 */
const GLYPH_CACHE = new Map<string, string>();

function glyphArt(colour: string): string {
  const hit = GLYPH_CACHE.get(colour);
  if (hit) return hit;

  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const k = size / 24;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 8;
    ctx.stroke(new Path2D(RUNE_PATH));
  }
  const url = c.toDataURL();
  GLYPH_CACHE.set(colour, url);
  return url;
}

const FADE_MS = 420;

export function LootVault({
  rarity, result, onClose,
}: {
  rarity: number;
  /** Null while the write is still in flight. */
  result: LootResult | null;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const vaultRef = useRef<Vault | null>(null);

  const [stage, setStage] = useState<'ceremony' | 'receipt'>('ceremony');
  const [leaving, setLeaving] = useState(false);
  const [caught, setCaught] = useState(false);

  const tier = LOOTBOX_TIER[result?.rarity ?? rarity] ?? `Tier ${rarity}`;

  // Stand the overlay down: fade, then hand over to the receipt. If there is
  // nothing to show — the write never answered — close outright.
  const standDown = useRef(() => {});
  standDown.current = () => {
    if (leaving) return;
    if (!result) { onClose(); return; }
    setLeaving(true);
    setTimeout(() => setStage('receipt'), FADE_MS);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // The vault builds its own canvas inside this box — see the note on
    // `createVault`. Handing it one is what let two instances share a context.
    const vault = createVault(stage, {
      rarity: result?.rarity ?? rarity,
      onReveal: () => setCaught(true),
      onDone: () => standDown.current(),
    });
    vaultRef.current = vault;
    return () => {
      vault.dispose();
      vaultRef.current = null;
    };
    // Built once per opening. Re-creating it when the reply lands would restart
    // the ceremony from a cold chest.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The reply. The chest breaks its seal and throws exactly what the process
  // said was in it — art and counts, straight from the reward list.
  useEffect(() => {
    if (!result) return;
    // Nothing is dropped for want of a picture: anything without art is thrown
    // as the realm's own mark.
    const spoils: Spoil[] = result.rewards.map((r) => ({
      url: ITEM_ART[r.item] ?? glyphArt('#d6c8a2'),
      amount: r.amount,
    }));
    vaultRef.current?.open(spoils);
  }, [result]);

  // Hold the page still underneath it — a ceremony you can scroll away from is
  // a video, not a moment. The fade in is a CSS animation rather than a state
  // flip on the next frame: a backgrounded tab gets no animation frames, so an
  // overlay that waits for one opens at opacity zero and stays there.
  useEffect(() => {
    if (stage !== 'ceremony') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') standDown.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [stage]);

  if (stage === 'receipt' && result) {
    return <Receipt tier={tier} result={result} onClose={onClose} />;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Opening a ${tier.toLowerCase()} loot box`}
      onClick={() => { if (caught) standDown.current(); }}
      className={cx(
        'loot-vault fixed inset-0 z-50 transition-opacity',
        leaving ? 'opacity-0' : 'animate-fade opacity-100',
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      {/* The page is dimmed almost out rather than blurred behind a panel: the
          chest is the only lit thing on screen for the length of this. */}
      <div className="absolute inset-0 bg-void/95 backdrop-blur-sm" />

      <div ref={stageRef} className="absolute inset-0" />

      <button
        onClick={(e) => { e.stopPropagation(); standDown.current(); }}
        aria-label="Skip"
        className={cx(
          'safe-corner-button absolute right-4 top-4 rounded-[3px] border border-edge/70 bg-void/60 p-2',
          'text-faint backdrop-blur transition-colors hover:text-ink sm:right-6 sm:top-6',
        )}
      >
        <X className="h-4 w-4" />
      </button>

      <div className="safe-bottom-copy pointer-events-none absolute inset-x-0 bottom-0 pb-8 text-center sm:pb-12">
        <p className="eyebrow">{tier} box</p>
        <p className="mt-2 text-[13px] text-faint">
          {!result
            ? 'The lock is answering to the chain…'
            : caught
              ? 'Click anywhere to take it'
              : 'The seal is breaking'}
        </p>
      </div>
    </div>,
    document.body,
  );
}

/**
 * What was in it, in writing.
 *
 * Deliberately not a dialog. The haul has already been shown — in the room, at
 * size, coming out of the chest — and this exists so the exact items and counts
 * are still readable a minute later. It sits in the corner, over a page that is
 * fully usable again, and goes away when it is dismissed.
 */
function Receipt({
  tier, result, onClose,
}: { tier: string; result: LootResult; onClose: () => void }) {
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'loot-receipt fixed bottom-4 z-40 w-auto animate-rise',
        'inset-x-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-80',
      )}
    >
      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="eyebrow">{tier} box</span>
          <button
            onClick={onClose}
            aria-label="Dismiss"
            className="touch-icon-button -m-1 rounded p-1 text-faint transition-colors hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-1.5">
          {result.rewards.map((r, i) => (
            <div
              key={r.item}
              data-element={ITEM_ELEMENT[r.item]}
              className="flex animate-rise items-center gap-2.5 rounded-[3px] border border-edge/60 bg-void/50 px-2.5 py-1.5"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <img
                src={ITEM_ART[r.item] ?? glyphArt('#d6c8a2')}
                alt=""
                className="h-6 w-6 shrink-0 object-contain"
              />
              <span className="min-w-0 flex-1 truncate text-left text-[13px]">{r.name}</span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-element">
                +{r.amount}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
