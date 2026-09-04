/**
 * The character creator, as a component rather than a screen.
 *
 * Compose a sheet from bundled layer art, dye each garment, and save the six
 * selected style/colour pairs to the game. The rendered sheet is derived data:
 * every client can rebuild it from the same local art, so no bitmap or atlas is
 * uploaded and changing clothes costs one ordinary game signature.
 *
 * This used to be the body of `screens/Customiser.tsx` and nothing else could
 * reach it, which is how the editor ended up with no route and no entry point
 * at once. It is a component now because there are three callers: the Companion
 * card, the Collection page, and the full-screen customiser — and a character
 * is a thing you touch once in a while from wherever you happen to be, not a
 * destination you navigate to.
 *
 * `variant` is the only thing the callers disagree about. `page` gets the
 * two-column workspace that fills whatever height the screen locked; `dialog`
 * stacks and takes a fixed stage height, because a modal has to stay a panel
 * laid over the hall rather than becoming the hall.
 */
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../state/gameContext';
import * as api from '../../lib/game';
import {
  CATEGORIES, composite, emptyOutfit, isBare, isNone, randomOutfit,
  type Facing, type Outfit,
} from '../../lib/sprites';
import { Button, ErrorNote, Panel, cx } from '../primitives';
import { useToast } from '../toastContext';
import { Portrait } from './Portrait';
import { Roam } from './Roam';
import { Wardrobe } from './Wardrobe';

/**
 * An outfit survives a reload.
 *
 * Six choices and six colours is twenty minutes of fiddling, and the only place
 * the save action would throw the current draft away. The saved player record
 * is the portable source of truth; this browser copy only protects unfinished
 * edits between refreshes.
 */
const DRAFT_PREFIX = 'runerealm.outfit.v2.';
const LEGACY_DRAFT_KEY = 'runerealm.outfit.v1';

/**
 * Garments that have been renamed since a draft could have been saved.
 *
 * The hair art shipped as `Boy` and `Girl` and is now `Short` and `Long`. A
 * draft naming the old file validates as "not a garment we have" and falls back
 * to `None`, which is safe but looks to the player like their hair vanished.
 * Two lines to carry it across instead. Deletable once nobody has a draft that
 * old — which, since none of this has been released, is soon.
 */
const RENAMED: Record<string, string> = { Boy: 'Short', Girl: 'Long' };

export function normaliseOutfit(saved: unknown): Outfit {
  const base = emptyOutfit();
  if (!saved || typeof saved !== 'object') return base;
  const record = saved as Partial<Outfit>;
  // Validated against the art rather than trusted: a garment can be renamed
  // or dropped between releases, and a saved recipe naming one that no longer
  // exists must fall back to `None` instead of compositing a null layer.
  for (const category of CATEGORIES) {
    const piece = record[category.name];
    if (!piece || typeof piece.style !== 'string') continue;
    const style = RENAMED[piece.style] ?? piece.style;
    if (!category.options.some((o) => o.name === style)) continue;
    base[category.name] = {
      style,
      color: /^#[0-9a-f]{6}$/i.test(piece.color) ? piece.color : base[category.name].color,
    };
  }
  return base;
}

function loadDraft(address: string | null, saved?: Outfit): Outfit {
  try {
    const local = address ? localStorage.getItem(`${DRAFT_PREFIX}${address}`) : null;
    if (local) return normaliseOutfit(JSON.parse(local));
    if (saved) return normaliseOutfit(saved);
    const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (legacy) return normaliseOutfit(JSON.parse(legacy));
  } catch {
    // A corrupt or unreadable draft is not worth a broken screen.
  }
  return saved ? normaliseOutfit(saved) : emptyOutfit();
}

export function CharacterEditor({
  variant = 'page', onSaved,
}: {
  variant?: 'page' | 'dialog';
  /** Fired after a successful save, so a modal caller can close itself. */
  onSaved?: () => void;
}) {
  const { address, player, refresh } = useGame();
  const toast = useToast();

  const [outfit, setOutfit] = useState<Outfit>(() => loadDraft(address, player?.outfit));
  const [view, setView] = useState<'portrait' | 'roam'>('portrait');
  const [facing, setFacing] = useState<Facing>('down');
  const [walking, setWalking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const hydratedAddress = useRef<string | null>(player && address ? address : null);
  const skipDraftWrite = useRef(false);

  // The full 576x60 sheet, offscreen. Every view is a crop of this, so the
  // layers are composited once per change rather than once per frame.
  const sheetRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  if (!sheetRef.current && typeof document !== 'undefined') {
    sheetRef.current = document.createElement('canvas');
  }

  // Recomposite whenever anything worn or dyed changes.
  useEffect(() => {
    let cancelled = false;
    const sheet = sheetRef.current;
    if (!sheet) return;
    composite(outfit, sheet)
      .then(() => { if (!cancelled) { setReady(true); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e); });
    return () => { cancelled = true; };
  }, [outfit]);

  useEffect(() => {
    if (!address || !player || player.address !== address || hydratedAddress.current === address) return;
    hydratedAddress.current = address;
    skipDraftWrite.current = true;
    setOutfit(loadDraft(address, player.outfit));
  }, [address, player]);

  useEffect(() => {
    if (!address || !player || player.address !== address) return;
    if (skipDraftWrite.current) {
      skipDraftWrite.current = false;
      return;
    }
    try {
      localStorage.setItem(`${DRAFT_PREFIX}${address}`, JSON.stringify(outfit));
    } catch { /* private mode */ }
  }, [address, player, outfit]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.spriteUpdate(outfit);
      await refresh();
      toast.success('Your character is saved.');
      onSaved?.();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const dialog = variant === 'dialog';
  const bare = isBare(outfit);
  const worn = CATEGORIES.filter((c) => !isNone(outfit[c.name]?.style ?? 'None')).length;
  const savedOutfit = player?.outfit ? normaliseOutfit(player.outfit) : null;
  const dirty = !savedOutfit || JSON.stringify(savedOutfit) !== JSON.stringify(outfit);

  return (
    <div className={cx(
      'character-editor flex flex-col gap-2.5',
      !dialog && 'min-h-0 flex-1 lg:overflow-hidden',
    )}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        {!dialog && <h1 className="font-display text-xl font-semibold tracking-tight">Character</h1>}
        <span className="hidden font-mono text-[11px] text-faint sm:inline">
          {worn}/{CATEGORIES.length} layers on
        </span>

        <div className="customiser-toolbar ml-0 flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <Button size="sm" variant="quiet" onClick={() => setOutfit(randomOutfit())}>
            Shuffle
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setOutfit(emptyOutfit())}>
            Reset
          </Button>
          {view === 'portrait' && (
            <Button
              size="sm"
              variant={walking ? 'ghost' : 'quiet'}
              onClick={() => setWalking((w) => !w)}
            >
              {walking ? 'Walking' : 'Standing'}
            </Button>
          )}
          {/* Two views of one thing, so a segmented control rather than two
              buttons. */}
          <div className="inline-flex rounded-[3px] border border-edge bg-void/40 p-0.5">
            {([['portrait', 'Portrait'], ['roam', 'Roam']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                aria-pressed={view === key}
                className={cx(
                  'customiser-view-button h-11 rounded-[2px] px-3 text-[12px] transition-colors lg:h-7',
                  view === key ? 'bg-element/15 text-element' : 'text-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/*
        The middle row takes everything the other two do not.

        `min-h-0` is the whole trick. A grid or flex child defaults to refusing
        to go below its content's height, so without it this row grows past the
        container it was told to fit, and the page scrolls again — which is the
        exact thing the layout exists to stop.
      */}
      <div className={cx(
        'customiser-workspace grid min-h-0 gap-2.5',
        // A dialog cannot take "whatever is left of the window" — there is no
        // window left, only the panel. So the row is given ONE height above
        // `lg` and both columns fill it, which is what keeps the dye grid from
        // being the only thing that overflows.
        dialog
          ? 'lg:h-[23rem] lg:grid-cols-[minmax(0,1fr)_18rem]'
          : 'flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]',
      )}>
        <Panel className="flex min-h-0 flex-col p-3">
          <div className={cx(
            'relative flex-1 overflow-hidden rounded-[3px] border border-edge/70 bg-void/30',
            dialog ? 'min-h-[15rem]' : 'min-h-[300px]',
          )}>
            {view === 'portrait' ? (
              <Portrait
                sheet={sheetRef.current}
                ready={ready}
                facing={facing}
                onFacing={setFacing}
                walking={walking}
              />
            ) : (
              <Roam sheet={sheetRef.current} ready={ready} />
            )}
          </div>
        </Panel>

        <Panel className="flex min-h-0 flex-col p-4">
          <Wardrobe outfit={outfit} onChange={setOutfit} />
        </Panel>
      </div>

      {/*
        The save bar. `shrink-0`, so an error appearing takes its space out
        of the stage above rather than making the page taller than the window.
      */}
      <Panel className="shrink-0 px-4 py-2.5">
        {error ? (
          <ErrorNote error={error} onRetry={() => setError(null)} />
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button size="sm" variant="primary" busy={saving} disabled={!dirty} onClick={save}>
              {dirty ? 'Save character' : 'Character saved'}
            </Button>
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-faint">
              {bare
                ? 'Nothing on yet. A bare character is valid and can still be saved.'
                : dirty
                  ? 'Your preview is local until you save its clothing and colour choices to the game.'
                  : 'Saved as game data. No image upload, mint, gateway, or permanent atlas required.'}
            </p>
            {player?.outfit && (
              <span className="shrink-0 font-mono text-[11px] text-faint">
                saved in game
              </span>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
