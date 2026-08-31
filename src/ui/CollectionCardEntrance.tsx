import { useEffect, useRef, useState } from 'react';
import { drawCard } from '../lib/card/browser';
import { cardSize } from '../lib/card/layout.mjs';
import type { Monster } from '../lib/types';
import type { CollectionCardEntrance as CollectionCardEntranceHandle } from '../gfx/collectionCards';
import { cx } from './primitives';

export function CollectionCardEntrance({ monsters, onReveal, onComplete }: {
  monsters: Monster[];
  onReveal: () => void;
  onComplete: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<CollectionCardEntranceHandle | null>(null);
  const [leaving, setLeaving] = useState(false);
  // The entrance is a snapshot. Switching the active card must not replay it.
  const first = useRef(monsters);

  useEffect(() => {
    let cancelled = false;
    let release = 0;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !first.current.length) {
      onReveal();
      onComplete();
      return undefined;
    }
    (async () => {
      const size = cardSize({});
      const rendered = await Promise.all(first.current.map(async (monster) => {
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
        return { face, element: monster.elementType, id: monster.id };
      }));
      if (cancelled || !canvas.current) return;
      const root = canvas.current.closest('.collection-page') ?? document;
      const targets = new Map(
        Array.from(root.querySelectorAll<HTMLElement>('[data-collection-card-target]'))
          .map((target) => [target.dataset.collectionCardTarget, target] as const),
      );
      const faces = rendered.map(({ id, ...face }) => ({
        ...face,
        target: targets.get(id) ?? null,
      }));
      const { createCollectionCardEntrance } = await import('../gfx/collectionCards');
      if (cancelled || !canvas.current) return;
      scene.current = createCollectionCardEntrance(canvas.current, faces, onReveal, () => {
        setLeaving(true);
        onComplete();
        release = window.setTimeout(() => {
          scene.current?.dispose();
          scene.current = null;
        }, 380);
      });
      if (!scene.current) onComplete();
    })().catch(() => { if (!cancelled) onComplete(); });
    return () => {
      cancelled = true;
      window.clearTimeout(release);
      scene.current?.dispose();
      scene.current = null;
    };
  }, [onComplete, onReveal]);

  return (
    <div className={cx('collection-card-entrance pointer-events-none absolute inset-0 z-10', leaving && 'is-leaving')} aria-hidden>
      <canvas ref={canvas} className="h-full w-full [image-rendering:pixelated]" />
    </div>
  );
}
