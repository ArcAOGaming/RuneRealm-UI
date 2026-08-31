/**
 * PARKED FEATURE: this screen has no application route during the integrated
 * economy launch. Existing source and recovered character recipes stay here,
 * but normal navigation and Sprite.Update both remain disabled.
 *
 * The character creator.
 *
 * Compose a sheet from bundled layer art, dye each garment, and save the six
 * selected style/colour pairs to the game. The rendered sheet is derived data:
 * every client can rebuild it from the same local art, so no bitmap or atlas is
 * uploaded and changing clothes costs one ordinary game signature.
 *
 * Legacy Arweave characters still render elsewhere, but every new save uses
 * the outfit map and becomes independent of gateways and upload fees.
 *
 * THE SCREEN DOES NOT SCROLL. `useFitViewport` below is how, and the note on
 * each row says what gives way when the window is short.
 */
import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGame } from '../state/GameProvider';
import * as api from '../lib/game';
import {
  CATEGORIES, composite, emptyOutfit, isBare, isNone, randomOutfit,
  type Facing, type Outfit,
} from '../lib/sprites';
import { Button, ErrorNote, Panel, cx } from '../ui/primitives';
import { useToast } from '../ui/Toast';
import { Portrait } from '../ui/character/Portrait';
import { Roam } from '../ui/character/Roam';
import { Wardrobe } from '../ui/character/Wardrobe';

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

/** Below this the screen would be squeezing controls rather than fitting them. */
const MIN_LOCKED_HEIGHT = 430;

function normaliseOutfit(saved: unknown): Outfit {
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

/**
 * Pin the screen to exactly the space left below the header.
 *
 * MEASURED, not calculated. The obvious version of this is
 * `h-[calc(100dvh-136px)]`, where 136 is the header plus the main element's
 * padding — and it is wrong the first time anyone touches `Shell.tsx`, which
 * has already happened once during this feature's life. Worse, it fails
 * quietly: the page grows a scrollbar, or a dead band at the bottom, and
 * nothing points at the constant that went stale.
 *
 * So it reads the two numbers off the live DOM instead: where this element
 * actually starts, and whatever bottom padding `main` actually has (`pb-28` on
 * phones to clear the tab bar, `pb-12` above that). A `ResizeObserver` on
 * `main` catches the header changing height, a webfont landing and the window
 * resizing, all through one path.
 *
 * Only above `lg`. Below it the layout is a single column — stage and wardrobe
 * stacked — and there is no honest way to fit both on a phone without shrinking
 * the garment tiles past the point of being recognisable. A phone scrolls.
 */
function useFitViewport(ref: RefObject<HTMLDivElement>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const main = el.closest('main');
    const wide = window.matchMedia('(min-width: 1024px)');

    const measure = () => {
      if (!wide.matches) {
        if (el.style.height) el.style.height = '';
        return;
      }
      const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const next = `${Math.max(MIN_LOCKED_HEIGHT, window.innerHeight - top - pad)}px`;
      // Guarded because this runs inside a ResizeObserver, and writing a height
      // that is already set would keep waking the observer up forever.
      if (el.style.height !== next) el.style.height = next;
    };

    measure();
    const ro = new ResizeObserver(measure);
    if (main) ro.observe(main);
    window.addEventListener('resize', measure);
    wide.addEventListener('change', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      wide.removeEventListener('change', measure);
    };
  }, [ref]);
}

export default function Customiser() {
  const { address, player, loadingPlayer, refresh } = useGame();
  const toast = useToast();

  const [outfit, setOutfit] = useState<Outfit>(() => loadDraft(address, player?.outfit));
  const [view, setView] = useState<'portrait' | 'roam'>('portrait');
  const [facing, setFacing] = useState<Facing>('down');
  const [walking, setWalking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const hydratedAddress = useRef<string | null>(player && address ? address : null);
  const skipDraftWrite = useRef(false);

  const rootRef = useRef<HTMLDivElement>(null);
  useFitViewport(rootRef);

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
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  if (!address) {
    if (loadingPlayer) {
      return <Panel className="h-48 p-6"><div className="shimmer h-full w-full rounded-[3px]" /></Panel>;
    }
    return (
      <Panel className="p-6">
        <h1 className="font-display text-xl font-semibold tracking-tight">Character</h1>
        <p className="mt-2 text-[13px] text-faint">
          Connect a wallet to make one.
        </p>
      </Panel>
    );
  }

  const bare = isBare(outfit);
  const worn = CATEGORIES.filter((c) => !isNone(outfit[c.name]?.style ?? 'None')).length;
  const savedOutfit = player?.outfit ? normaliseOutfit(player.outfit) : null;
  const dirty = !savedOutfit || JSON.stringify(savedOutfit) !== JSON.stringify(outfit);

  return (
    <div ref={rootRef} className="customiser-screen flex flex-col gap-2.5 lg:overflow-hidden">
      {/*
        One line, not a title block.

        The heading used to carry a rule and a sentence of explanation under it:
        ninety pixels of prose at the top of a screen whose whole job is to be
        looked at. Saving is explained beside the Save button, where somebody
        is actually deciding, and that is where it went.
      */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-xl font-semibold tracking-tight">Character</h1>
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
      <div className="customiser-workspace grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel className="flex min-h-0 flex-col p-3">
          <div className="relative min-h-[300px] flex-1 overflow-hidden rounded-[3px] border border-edge/70 bg-void/30">
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
