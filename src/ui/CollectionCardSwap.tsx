import { useEffect, useRef } from 'react';
import { drawCard } from '../lib/card/browser';
import { cardSize } from '../lib/card/layout.mjs';
import type { Monster } from '../lib/types';
import type {
  CollectionCardRect, CollectionCardSwap as CollectionCardSwapHandle,
} from '../gfx/collectionCards';

export type CollectionSwapRequest = {
  from: Monster;
  to: Monster;
  fromStart: CollectionCardRect;
  toStart: CollectionCardRect;
  fromFace: HTMLCanvasElement;
  toFace: HTMLCanvasElement;
};

export async function renderCollectionSwapFace(monster: Monster) {
  const size = cardSize({});
  const full = document.createElement('canvas');
  full.width = size.width;
  full.height = size.height;
  await drawCard(full, monster, {});
  const face = document.createElement('canvas');
  face.width = 216;
  face.height = 355;
  const ctx = face.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(full, 0, 0, face.width, face.height);
  return face;
}

export function CollectionCardSwap({ request, onComplete }: {
  request: CollectionSwapRequest;
  onComplete: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<CollectionCardSwapHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    let startFrame = 0;

    // Wait for the confirmed Player record to replace the DOM cards, then
    // target the two new sockets while they remain visually empty. Faces were
    // rendered behind the confirmation dialog, so the 3D exchange begins
    // immediately instead of showing two blank spaces while canvases are built.
    startFrame = requestAnimationFrame(() => {
      if (cancelled || !canvas.current) return;
      const root = canvas.current.closest('.collection-page');
      const fromTarget = root?.querySelector<HTMLElement>(
        `[data-collection-card-target="${request.from.id}"]`,
      );
      const toTarget = root?.querySelector<HTMLElement>(
        `[data-collection-card-target="${request.to.id}"]`,
      );
      if (!fromTarget || !toTarget) {
        onComplete();
        return;
      }

      import('../gfx/collectionCards').then(({ createCollectionCardSwap }) => {
        if (cancelled || !canvas.current) return;
        scene.current = createCollectionCardSwap(canvas.current, [
          {
            face: request.fromFace, element: request.from.elementType,
            start: request.fromStart, target: fromTarget,
          },
          {
            face: request.toFace, element: request.to.elementType,
            start: request.toStart, target: toTarget,
          },
        ], () => {
          fromTarget.classList.add('is-swap-arriving');
          toTarget.classList.add('is-swap-arriving');
          onComplete();
          window.setTimeout(() => {
            fromTarget.classList.remove('is-swap-arriving');
            toTarget.classList.remove('is-swap-arriving');
          }, 320);
        });
        if (!scene.current) onComplete();
      }).catch(onComplete);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(startFrame);
      scene.current?.dispose();
      scene.current = null;
    };
  }, [onComplete, request]);

  return (
    <div className="collection-swap-scene pointer-events-none absolute inset-0 z-20" aria-hidden>
      <canvas ref={canvas} className="h-full w-full [image-rendering:pixelated]" />
    </div>
  );
}
