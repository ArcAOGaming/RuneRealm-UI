/**
 * A modal dialog.
 *
 * There are two non-obvious reasons this is a shared component rather than
 * three hand-rolled overlays.
 *
 * **It has to be a portal.** `.panel` sets `backdrop-filter: blur(...)`, and a
 * non-`none` backdrop-filter establishes a containing block for `position:
 * fixed` descendants. A `fixed inset-0` overlay written INSIDE a panel
 * therefore resolves `inset-0` to the panel, not the viewport — and the
 * companion card is `overflow-hidden` besides, so the level-up dialog was being
 * clipped to a box smaller than itself and losing its own Confirm button. It
 * looked fine in the faction screen only because that one happened to be
 * rendered at the root.
 *
 * **A dialog is a keyboard trap by definition.** Escape closes it, focus moves
 * into it and stays there, the page behind it does not scroll, and it is
 * labelled. None of that was true before.
 *
 * `busy` is the other half of not losing work: while a write is in flight the
 * backdrop and Escape stop closing, so clicking off a half-signed oath — or off
 * a ten-point stat allocation — cannot silently discard it.
 */
import { ReactNode, useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './primitives';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * How many dialogs are open, so the scroll lock is released exactly once.
 *
 * Each dialog remembering "what overflow was before me" and restoring it is
 * wrong the moment two overlap: the second captures the first's `hidden`, and
 * closing them leaves the page locked with nothing on screen to explain it.
 */
let openDialogs = 0;

/**
 * The width, as a choice rather than a class the caller passes in.
 *
 * A `max-w-*` utility appended through `className` does NOT win: this project's
 * Tailwind emits `.max-w-md` after `.max-w-4xl`, so the default here beat every
 * caller that tried to widen itself and the character editor came out at a
 * confirm-dialog's width. Naming the sizes removes the guess.
 */
const WIDTH = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export function Dialog({
  title, onClose, busy, element, children, className, size = 'md',
}: {
  /** Also the accessible name. Rendered by the caller; passed here for aria. */
  title: string;
  onClose: () => void;
  /** While true, the backdrop and Escape will not close. */
  busy?: boolean;
  /** Faction/companion element, so the dialog inherits the right accent. */
  element?: string;
  children: ReactNode;
  className?: string;
  /** How wide it is allowed to get. A confirmation is `md`; an editor is `xl`. */
  size?: keyof typeof WIDTH;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const labelId = useId();

  const dismiss = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  // Move focus in, and put it back where it came from on the way out. The
  // frame delay is so the portal is actually in the document first.
  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      // `preventScroll` matters now that the body scrolls inside the panel.
      // The first focusable in a long dialog is usually a button at the FOOT of
      // it, and focusing it scrolls that button into view — so the faction
      // detail opened already scrolled past its own description.
      (first ?? panelRef.current)?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(id);
      restoreTo.current?.focus?.();
    };
  }, []);

  // Escape closes; Tab cycles inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismiss();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [dismiss]);

  // Don't let the page scroll behind the dialog.
  useEffect(() => {
    openDialogs += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      openDialogs -= 1;
      if (openDialogs === 0) document.body.style.overflow = '';
    };
  }, []);

  return createPortal(
    <div
      className="dialog-backdrop fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-void/85 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        data-element={element}
        className={cx(
          // Capped, and it scrolls inside itself.
          //
          // Without a ceiling a dialog grows to whatever its contents need and
          // then runs to both edges of the screen — the faction detail, with a
          // description, a companion, three tallies and a roster, filled a
          // laptop top to bottom and read as a page rather than as something
          // laid over one. The title stays put and the body takes the overflow,
          // so the thing you opened is always visibly a panel on top of the
          // hall.
          'dialog-panel panel my-auto flex max-h-[calc(100dvh-5rem)] w-full flex-col',
          'animate-rise p-6 shadow-glow outline-none',
          WIDTH[size],
          className,
        )}
      >
        <h3 id={labelId} className="shrink-0 text-lg font-semibold">{title}</h3>
        {/* `min-h-0` is load-bearing: a flex child will not shrink below its
            content without it, and the panel would grow right past its cap. */}
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
