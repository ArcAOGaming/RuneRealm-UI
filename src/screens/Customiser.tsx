/**
 * The character creator, full screen.
 *
 * The editing itself lives in `ui/character/CharacterEditor` — the same
 * component the Companion and Collection pages open as a dialog. All this file
 * adds is the standalone framing: the wallet gate, and the height lock that
 * keeps the screen from scrolling.
 *
 * THE SCREEN DOES NOT SCROLL. `useFitViewport` below is how, and the note on
 * it says what gives way when the window is short.
 */
import { RefObject, useLayoutEffect, useRef } from 'react';
import { useGame } from '../state/gameContext';
import { Panel } from '../ui/primitives';
import { CharacterEditor } from '../ui/character/CharacterEditor';

/** Below this the screen would be squeezing controls rather than fitting them. */
const MIN_LOCKED_HEIGHT = 430;

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
 *
 * `mounted` is not decoration. Hooks run before the wallet gate below returns,
 * so the first pass finds `ref.current` null and bails — and a ref's identity
 * never changes, so nothing ever ran it again once the element appeared. The
 * screen then sized itself to its content and left a band of dead space under
 * the save bar, which is the exact failure the whole hook exists to prevent.
 */
function useFitViewport(ref: RefObject<HTMLDivElement>, mounted: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !mounted) return;
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
  }, [ref, mounted]);
}

export default function Customiser() {
  const { address, loadingPlayer } = useGame();
  const rootRef = useRef<HTMLDivElement>(null);
  useFitViewport(rootRef, Boolean(address));

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

  return (
    <div ref={rootRef} className="customiser-screen flex flex-col lg:overflow-hidden">
      <CharacterEditor variant="page" />
    </div>
  );
}
