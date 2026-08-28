/**
 * The room — where your companion actually lives.
 *
 * A thin React shell now: it decides WHICH room and hands that to Phaser, and
 * everything that moves lives in `game/RoomScene.ts`. The scene owns the pixel
 * grid, so the scale is a whole number by construction rather than by hope —
 * see the header of `game/boot.ts` for what that fixes.
 *
 * Nothing here re-renders on a frame. The scene runs its own loop; React only
 * gets involved when the companion's status or sprite changes, which is when
 * the room genuinely is a different place.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Element, Monster } from '../lib/types';
import { cx } from './primitives';
import { mountGame } from '../game/boot';
import { RoomScene } from '../game/RoomScene';
import { roomUrl } from '../game/assets';

/** The plate is 384x192. The world is that, exactly, at a whole-number zoom. */
const BASE_W = 384;
const BASE_H = 192;

/**
 * Where the companion is, as a place rather than a status string.
 *
 * Play and Quest are places it IS — it roams them the same way it roams the
 * house. Only the arena takes it out of the scene, which is what `away` dims.
 */
const SCENE: Record<string, { room: string }> = {
  Home: { room: 'house-cottage' },
  Play: { room: 'house-workshop' },
  Quest: { room: 'house-burrow' },
  Battle: { room: 'house-cottage' },
};

/** The faction colours, matching `--ember/--tide/--gale/--stone` in index.css. */
const ELEMENT_RGB: Record<Element, [number, number, number]> = {
  fire: [255, 122, 67],
  water: [74, 176, 255],
  air: [126, 226, 200],
  rock: [201, 162, 93],
};

export default function RoomStage({ monster, className }: { monster: Monster; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const scene = SCENE[monster.status.type] ?? SCENE.Home;
  const away = monster.status.type === 'Battle';

  // A room whose art is missing must not take the screen down — fall back to
  // whatever house did bundle rather than booting a scene with no backdrop.
  const room = useMemo(
    () => (roomUrl(scene.room) ? scene.room : 'house-cottage'),
    [scene.room],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const mounted = mountGame(host, BASE_W, BASE_H, [RoomScene], {
      maxZoom: 4,
      onScale: () => setReady(true),
    });
    mounted.game.scene.start(RoomScene.KEY, {
      sprite: monster.sprite,
      backdrop: room,
      away,
      element: ELEMENT_RGB[monster.elementType],
    });

    return () => mounted.destroy();
  }, [monster.sprite, monster.elementType, room, away]);

  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-[3px] border border-edge/70 bg-void/60',
        className,
      )}
    >
      {/* Aspect-locked to the plate so the canvas fills the box at a whole
          zoom instead of leaving a band of panel under it. */}
      <div
        ref={hostRef}
        // `overflow-hidden` is load-bearing, not tidiness: a grid box takes its
        // automatic minimum size from its content, so a SECOND canvas in here
        // — a stale one that has not finished tearing down — stacks into a
        // second row and the aspect lock loses to it. The room came out square
        // and pushed everything under it off the page. Clipping sets that
        // minimum to zero, so the plate is the plate whatever is inside it.
        className="grid w-full place-items-center overflow-hidden"
        style={{ aspectRatio: `${BASE_W} / ${BASE_H}` }}
        aria-label={`${monster.name} at home`}
        role="img"
      />

      {!ready && <div className="absolute inset-0 animate-pulse bg-raised/40" />}

      {/* No caption plate. Where the companion is was being said twice on the
          companion screen — a grey "Away at the arena" in this corner and the
          status badge over in the activities heading — and twice in different
          words. The screen puts ONE badge over the top-right of the room now;
          the room's own contribution is the room, which has already changed to
          the beach by the time either of them would say so. */}
    </div>
  );
}
