/**
 * The walkthrough machinery — a spotlight, a card, and nothing else.
 *
 * There is no tutorial copy in this file, on purpose. Every screen that has a
 * walkthrough declares it in its own module with `useTourSteps`, so the
 * sentence describing what the arena charges sits a few hundred lines from the
 * code that charges it and changes in the same diff. A tour confidently
 * describing last month's rules is worse than no tour at all.
 *
 * What a walkthrough IS: a few steps, each pointing at a real element that is
 * on the screen right now, one line each. The page stays where it is and one
 * piece of it at a time is lit. It is deliberately not a separate screen
 * explaining an interface you cannot see while you read about it, and it is
 * deliberately not exhaustive — somebody shown five sentences reads five
 * sentences; the twenty-step version is the one people skip on step two, and
 * skipping is what teaches nothing.
 *
 * Steps whose target is not on the screen are DROPPED rather than pointed
 * vaguely at a corner. That is what lets one list cover a screen with states:
 * the hunt's capture step only exists while something is cornered, and the
 * companion's daily-worship step is not there on a phone, where the countdown
 * chip is not rendered at all.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  TourContext, useTour, type TourContextValue, type TourStep,
} from './tourContext';
import { Button, cx } from './primitives';
import { Arrow, Compass } from './icons';

/**
 * That this device has been through a given walkthrough, and how often it has
 * been past that screen without taking it.
 *
 * Per device and not per account: the thing being remembered is whether this
 * PERSON has been shown the interface, and one wallet opened on a borrowed
 * laptop is somebody who has not. It is also why none of it is process state —
 * teaching somebody where the market is does not belong in the game.
 */
const seenKey = (key: string) => `rr.tour.seen.${key}`;
const visitKey = (key: string) => `rr.tour.visits.${key}`;

/** How many times you can walk past a screen before its guide stops glowing. */
const FRESH_VISITS = 3;

const read = (key: string) => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
  try { window.localStorage.setItem(key, value); } catch { /* private mode */ }
};

/**
 * The first match that is actually on the screen.
 *
 * The tabs exist TWICE in the document — a row in the header and a bar at the
 * foot of a phone — and only one of them has a size at any given width. Taking
 * `querySelector`'s first answer lights an element of zero area behind the
 * page, which looks exactly like a broken tour.
 */
function findTarget(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return el;
  }
  return null;
}

type Page = { key: string; steps: TourStep[] };
type Box = { top: number; left: number; width: number; height: number };

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [fresh, setFresh] = useState(false);
  const navigate = useNavigate();

  // Read by callbacks that must not change identity: `register` is an effect
  // dependency in every screen that has a walkthrough, and a `register` that
  // changed each render would re-register each render.
  const pageRef = useRef<Page | null>(null);
  pageRef.current = page;

  const register = useCallback((key: string, steps: TourStep[]) => {
    setPage({ key, steps });
    // Counted on arrival rather than on departure: somebody who opens the arena
    // and immediately leaves has still been there, and the count only decides
    // how long the guide stays lit.
    const visits = Number(read(visitKey(key)) ?? '0') + 1;
    write(visitKey(key), String(visits));
    setFresh(read(seenKey(key)) !== '1' && visits <= FRESH_VISITS);
    return () => {
      setPage((current) => (current?.key === key ? null : current));
      setFresh(false);
    };
  }, []);

  const end = useCallback(() => {
    setRunning(false);
    setIndex(0);
    const key = pageRef.current?.key;
    if (key) { write(seenKey(key), '1'); setFresh(false); }
  }, []);

  const start = useCallback(() => {
    // Nothing registered means this screen has no walkthrough of its own. The
    // companion screen's is the one that explains the game and the tabs around
    // it, so that is where "show me around" goes.
    if (!pageRef.current) navigate('/companion');
    setIndex(0);
    setRunning(true);
  }, [navigate]);

  const offer = useCallback(() => {
    const key = pageRef.current?.key;
    if (!key || read(seenKey(key)) === '1') return;
    setIndex(0);
    setRunning(true);
  }, []);

  const value = useMemo<TourContextValue>(() => ({
    running,
    pageKey: page?.key ?? null,
    pageFresh: fresh,
    register, start, end, offer,
  }), [running, page, fresh, register, start, end, offer]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {running && page && (
        <TourOverlay steps={page.steps} index={index} onIndex={setIndex} onEnd={end} />
      )}
    </TourContext.Provider>
  );
}

/**
 * The control, in the header.
 *
 * Icon only, and exactly the height of the chips beside it, because the header
 * is one row and has to stay one row: a labelled button costs another fifty
 * pixels of a bar that already carries a rune count, the daily claim and an
 * address on a phone.
 *
 * Rendered on every game page whether or not that page has a walkthrough of its
 * own — a control that appears and disappears between routes shuffles
 * everything else in the bar sideways as you navigate, which is worse than an
 * extra icon. With nothing registered it falls back to the companion screen's,
 * which is the one that explains the game.
 *
 * Lit while this screen's walkthrough is still new, quiet forever after. Not a
 * countdown that removes it: somebody coming back after three weeks needs it
 * more than they did on day one.
 */
export function TourChip({ compact = false }: { compact?: boolean }) {
  const { pageKey, pageFresh, start, running } = useTour();
  const label = pageKey ? 'Show me around this page' : 'Show me around the game';
  return (
    <button
      type="button"
      data-tour="guide"
      onClick={start}
      aria-label={label}
      title={label}
      className={cx(
        'flex shrink-0 items-center justify-center rounded-[3px] border transition-colors',
        // `compact` is the corner cluster on a screen that has hidden its
        // header — it matches that cluster's 28px, not the header's 32.
        compact ? 'h-7 w-7 backdrop-blur-sm' : 'h-8 w-8',
        pageFresh && !running
          ? 'border-element/50 bg-element/10 text-element'
          : compact
            ? 'border-rune/20 bg-void/80 text-muted hover:border-element/50 hover:text-ink'
            : 'border-edge bg-raised/60 text-faint hover:text-ink',
      )}
    >
      <Compass className={compact ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />
    </button>
  );
}

function TourOverlay({
  steps, index, onIndex, onEnd,
}: {
  steps: TourStep[];
  index: number;
  onIndex: (n: number) => void;
  onEnd: () => void;
}) {
  const [visible, setVisible] = useState<TourStep[]>(
    () => steps.filter((s) => findTarget(s.target)),
  );
  const [box, setBox] = useState<Box | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = visible[Math.min(index, Math.max(0, visible.length - 1))];
  const last = index >= visible.length - 1;

  /*
    Follow the target, for as long as the tour is up.

    Not a resize listener: the things being pointed at move for reasons no event
    announces — a card finishing its first paint and changing height, a canvas
    settling, a poll landing a new rune count and reflowing the header. Which
    steps EXIST is a slower question and is asked four times a second rather
    than sixty, so this is one rect read a frame and a document walk now and
    then.
  */
  useLayoutEffect(() => {
    let raf = 0;
    let frame = 0;
    let scrolled = '';
    let known: TourStep[] = [];
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (frame % 15 === 0 || known.length === 0) {
        known = steps.filter((s) => findTarget(s.target));
        setVisible((current) => (
          current.length === known.length
            && current.every((s, i) => s.target === known[i].target)
            ? current : known
        ));
      }
      frame += 1;
      const active = known[Math.min(index, Math.max(0, known.length - 1))];
      const el = active ? findTarget(active.target) : null;
      if (!active || !el) { setBox(null); return; }
      // Once per step, and only if it is off screen: doing this every frame
      // fights the reader's own scrolling for as long as they look at it.
      if (scrolled !== active.target) {
        scrolled = active.target;
        const r = el.getBoundingClientRect();
        if (r.top < 8 || r.bottom > window.innerHeight - 8) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
      const r = el.getBoundingClientRect();
      const pad = 6;
      const wanted = {
        top: r.top - pad, left: r.left - pad,
        width: r.width + pad * 2, height: r.height + pad * 2,
      };
      setBox((current) => (
        current
          && Math.abs(current.top - wanted.top) < 0.5
          && Math.abs(current.left - wanted.left) < 0.5
          && Math.abs(current.width - wanted.width) < 0.5
          && Math.abs(current.height - wanted.height) < 0.5
          ? current : wanted
      ));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, steps]);

  /*
    Nothing on this screen answers to any of the steps.

    Ending is right — an overlay with no subject is a dim nobody can get out of
    — but not instantly. Starting the walkthrough from the wallet dialog
    navigates and starts in the same tick, so the first frame is always empty
    and an eager exit closed the tour before it ever drew.
  */
  useEffect(() => {
    if (visible.length > 0) return undefined;
    const timer = window.setTimeout(onEnd, 2500);
    return () => window.clearTimeout(timer);
  }, [visible.length, onEnd]);

  const next = useCallback(() => {
    if (last) onEnd(); else onIndex(index + 1);
  }, [last, index, onEnd, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onEnd(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); return; }
      if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); onIndex(index - 1); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [next, onEnd, onIndex, index]);

  // The step is a live region, not a dialog: the page behind it is the subject
  // and has to stay readable, so focus goes to the card without trapping in it.
  useEffect(() => { cardRef.current?.focus({ preventScroll: true }); }, [index]);

  if (!step || !box) return null;

  /*
    Above the subject or below it, whichever has the room. Measured rather than
    assumed, because the same step points at the header on a laptop and at the
    bottom tab bar on a phone, where "below" is off the screen entirely.
  */
  const CARD = 172;
  const below = box.top + box.height + 12 + CARD < window.innerHeight;
  const top = below ? box.top + box.height + 12 : Math.max(12, box.top - CARD - 12);
  const width = Math.min(320, window.innerWidth - 24);
  const left = Math.min(
    Math.max(12, box.left + box.width / 2 - width / 2),
    window.innerWidth - width - 12,
  );

  /*
    The overlay is portalled to `body`, which is outside the shell that carries
    `data-element` — so `--element` fell back to the page default and the ring
    round a fire player's card was drawn in arcane purple.
  */
  const element = document.querySelector('.app-shell')?.getAttribute('data-element');

  return createPortal(
    <div className="tour-layer fixed inset-0 z-[80]" data-element={element ?? undefined}>
      {/* The dim is this element's own shadow, spread far enough to cover any
          viewport. One box, no four-rectangle cutout to keep in sync, and the
          hole is exactly the element being described. */}
      <div
        aria-hidden
        className="tour-spot pointer-events-none absolute rounded-[4px]"
        style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
      />

      {/* Anywhere off the card ends it — the ordinary way out of a spotlight,
          and it means the dim is never a thing you are stuck in. */}
      <button
        type="button"
        aria-label="Close the walkthrough"
        onClick={onEnd}
        className="absolute inset-0 h-full w-full cursor-default"
      />

      <div
        ref={cardRef}
        role="region"
        aria-live="polite"
        aria-label={`Walkthrough, step ${index + 1} of ${visible.length}`}
        tabIndex={-1}
        className="tour-card panel absolute animate-rise p-4 shadow-glow outline-none"
        style={{ top, left, width }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-semibold tracking-tight">{step.title}</h3>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
            {index + 1}/{visible.length}
          </span>
        </div>
        <p className="mt-1.5 text-[13px] leading-6 text-muted">{step.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onEnd}
            className="py-1 text-[11px] uppercase tracking-[0.12em] text-faint hover:text-ink"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button size="sm" variant="quiet" onClick={() => onIndex(index - 1)}>Back</Button>
            )}
            <Button
              size="sm"
              variant="primary"
              onClick={next}
              icon={last ? undefined : <Arrow className="h-4 w-4" />}
            >
              {last ? 'Play' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default TourProvider;
