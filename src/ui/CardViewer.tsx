/**
 * The card, in the hand.
 *
 * A minted card is the one thing a player owns outright and can trade, and
 * everywhere else in the app it is a picture on a page. Here it is an object:
 * full viewport, lit, with weight — lean it with the pointer, drag it over to
 * read the back. It is the plain portrait card, not the extended dashboard
 * version, because this is the card that gets signed.
 *
 * The face comes from `lib/card/browser`, the same painter the preview and the
 * worker use. Nothing about the picture is decided here.
 *
 * No WebGL, or a face that would not paint, and this falls back to the flat
 * preview at the same size — which is the card, so nothing is lost but the
 * turning.
 */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { drawCard } from '../lib/card/browser';
import { cardSize } from '../lib/card/layout.mjs';
import { CardObject, createCardObject } from '../gfx/cardObject';
import { Monster } from '../lib/types';
import { CardPreview } from './CardPreview';
import { X } from './icons';
import { Spinner, cx } from './primitives';

export function CardViewer({ monster, onClose, footer }: {
  monster: Monster;
  onClose: () => void;
  /**
   * Anything the caller needs the viewer to be able to act on — the market
   * puts the asking price and its buy here, so inspecting a listing and
   * buying it are the same screen rather than two dialogs of the same card.
   */
  footer?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const object = useRef<CardObject | null>(null);
  const [state, setState] = useState<'painting' | 'held' | 'flat'>('painting');

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Painted offscreen at the layout's own 648x1065 and handed over as a
      // texture. Drawing into the visible canvas would fight the renderer for it.
      const size = cardSize({});
      const face = document.createElement('canvas');
      face.width = size.width;
      face.height = size.height;
      try {
        await drawCard(face, monster, {});
      } catch {
        if (!cancelled) setState('flat');
        return;
      }
      if (cancelled || !canvasRef.current) return;
      object.current = createCardObject(canvasRef.current, {
        face, element: monster.elementType,
      });
      setState(object.current ? 'held' : 'flat');
    })();
    return () => {
      cancelled = true;
      object.current?.dispose();
      object.current = null;
    };
  }, [monster]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${monster.name} card`}
      className="card-viewer fixed inset-0 z-50 animate-fade"
    >
      {/* Clicking off closes; the card itself takes its own pointer events, so
          dragging it over never dismisses the thing you are turning. */}
      <div className="absolute inset-0 bg-void/95 backdrop-blur-sm" onClick={onClose} />

      <div className="card-viewer-stage pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        <div className="pointer-events-auto relative h-full max-h-[78vh] w-full max-w-[400px]">
          {state !== 'flat' && (
            <canvas
              ref={canvasRef}
              className={cx(
                'h-full w-full cursor-grab touch-none active:cursor-grabbing',
                state === 'held' ? 'opacity-100' : 'opacity-0',
                'transition-opacity duration-300',
              )}
            />
          )}
          {state === 'painting' && (
            <div className="absolute inset-0 grid place-items-center text-faint">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {state === 'flat' && (
            <div className="grid h-full place-items-center">
              <CardPreview monster={monster} eager className="max-h-full" />
            </div>
          )}
        </div>
      </div>

      <button
        onClick={onClose}
        aria-label="Close"
        className={cx(
          'safe-corner-button absolute right-4 top-4 rounded-[3px] border border-edge/70 bg-void/60 p-2',
          'text-faint backdrop-blur transition-colors hover:text-ink sm:right-6 sm:top-6',
        )}
      >
        <X className="h-4 w-4" />
      </button>

      <div className="safe-bottom-copy pointer-events-none absolute inset-x-0 bottom-0 pb-6 text-center sm:pb-8">
        <p className="eyebrow">{monster.name}</p>
        {state === 'held' && (
          <p className="mt-2 text-[13px] text-faint">Drag to turn it over</p>
        )}
        {footer && (
          <div className="pointer-events-auto mt-4 flex justify-center px-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default CardViewer;
