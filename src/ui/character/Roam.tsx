/**
 * Walk around, and see the outfit move.
 *
 * The parked customiser did this with Phaser: a scene, a spritesheet loader, a
 * texture cache and a `Phaser.Game` per mount, to move one 48x60 sprite over a
 * 320x160 background. That is a 1.3MB renderer for a job the rest of this
 * codebase already does by hand — the companion's room (`ui/Room.tsx`) is the
 * same shape and is one rAF loop and one `drawImage`. The dependency is not
 * back; the feature is.
 *
 * It also gets something Phaser was actively in the way of: the character is
 * drawn straight off the SAME composited sheet the wardrobe and the publish
 * button use, so a dye lands here on the next frame with no texture to
 * regenerate and no cache to invalidate. The old scene kept its own coloured
 * copies of every layer and rebuilt them on each change, which is why colours
 * arrived late in the walking view and instantly in the still one.
 *
 * Nothing in the loop touches React state. Position, facing and the walk cycle
 * all advance from one clock and are written to the canvas; a component that
 * setStates sixty times a second to move a sprite is how the old screen ended
 * up re-rendering the entire page mid-stride.
 */
import { useEffect, useRef, useState } from 'react';
import MAP_URL from '../../assets/Map.png?url';
import { animationFrames, blitFrame, type Facing } from '../../lib/sprites';
import { cx } from '../primitives';

/** The map is 320x160 pixel art, and every number below is in ITS pixels. */
const MAP = { w: 320, h: 160 };

/** Map pixels per second. Running is not a separate animation — the atlas
    names `run_*` but carries no frames for them — so it is the walk cycle
    played faster over faster movement, which is what it looked like anyway. */
const WALK_SPEED = 54;
const RUN_SPEED = 100;
const WALK_FRAME_MS = 155;
const RUN_FRAME_MS = 105;

/**
 * Where the feet may go.
 *
 * The sprite is drawn from a 48x60 cell centred on the character's x with the
 * cell's bottom on its y, and the art inside that cell runs from y 10 to y 60.
 * So a top bound of 56 is what keeps the head on the map rather than sliced off
 * by the frame, and the side bounds keep the shoulders inside the picture.
 */
const BOUNDS = { left: 22, right: MAP.w - 22, top: 58, bottom: MAP.h - 4 };

type Dir = 'up' | 'down' | 'left' | 'right';

/** `event.code`, so the controls are physical keys and survive a layout. */
const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

/** Typing somewhere should never move the character. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}

export function Roam({
  sheet, ready,
}: {
  sheet: HTMLCanvasElement | null;
  ready: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** Whether anything is being held, so the hint can retire once it is read. */
  const [moved, setMoved] = useState(false);

  // The loop reads these rather than closing over them, so it is started once
  // and the character does not teleport back to the middle of the beach every
  // time a colour changes.
  const live = useRef({ sheet, ready });
  live.current = { sheet, ready };

  /** Held directions, from the keyboard and from the on-screen pad separately —
      releasing a key must not cancel a finger that is still down. */
  const keys = useRef(new Set<Dir>());
  const pad = useRef(new Set<Dir>());
  const running = useRef(false);

  const press = (dir: Dir, down: boolean) => {
    if (down) { pad.current.add(dir); setMoved(true); } else pad.current.delete(dir);
  };

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const map = new Image();
    map.src = MAP_URL;

    // Start in the middle of the sand, facing the viewer.
    let x = MAP.w / 2;
    let y = MAP.h * 0.72;
    let facing: Facing = 'down';
    let anim = 0;
    let last = 0;
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0;
      last = now;

      const cw = box.clientWidth;
      const ch = box.clientHeight;
      if (!cw || !ch) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(cw * dpr);
      const h = Math.round(ch * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;

      // Contain, not cover. The stage is no longer a fixed 2:1 box — it takes
      // whatever height is left over once the rest of the screen has been laid
      // out — so covering would crop the map along whichever axis is tight, and
      // a cropped map is one the character can walk off the side of. Contained,
      // the whole beach is always on screen and the leftover is void, which is
      // what the panel behind it already is.
      //
      // One sprite pixel stays exactly one map pixel either way, which is the
      // rule that keeps the character from reading as a sticker on a photo.
      const scale = Math.min(cw / MAP.w, ch / MAP.h);
      const ox = (cw - MAP.w * scale) / 2;
      const oy = (ch - MAP.h * scale) / 2;

      // Move. Diagonals are normalised, so cutting across the beach is not a
      // 41% speed bonus.
      let dx = 0;
      let dy = 0;
      for (const set of [keys.current, pad.current]) {
        if (set.has('left')) dx -= 1;
        if (set.has('right')) dx += 1;
        if (set.has('up')) dy -= 1;
        if (set.has('down')) dy += 1;
      }
      dx = Math.sign(dx);
      dy = Math.sign(dy);
      const moving = dx !== 0 || dy !== 0;
      if (moving) {
        const k = dx && dy ? Math.SQRT1_2 : 1;
        const speed = running.current ? RUN_SPEED : WALK_SPEED;
        x += dx * speed * k * dt;
        y += dy * speed * k * dt;
        x = Math.max(BOUNDS.left, Math.min(BOUNDS.right, x));
        y = Math.max(BOUNDS.top, Math.min(BOUNDS.bottom, y));

        if (dx > 0) facing = 'right';
        else if (dx < 0) facing = 'left';
        else if (dy > 0) facing = 'down';
        else facing = 'up';

        anim += dt * 1000;
      } else {
        anim = 0;
      }

      ctx.clearRect(0, 0, cw, ch);
      if (map.complete && map.naturalWidth) {
        ctx.drawImage(map, ox, oy, MAP.w * scale, MAP.h * scale);
      }

      const { sheet: s, ready: ok } = live.current;
      if (!s || !ok) return;

      // Clipped to the map, so a character pressed against the edge is cut off
      // by the world rather than drawn over the frame around it.
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, MAP.w * scale, MAP.h * scale);
      ctx.clip();

      // Contact shadow. Squashed while walking, so the step lands.
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(
        ox + x * scale, oy + (y - 1) * scale,
        (moving ? 7 : 8) * scale, 2.4 * scale, 0, 0, Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();

      const stepMs = running.current ? RUN_FRAME_MS : WALK_FRAME_MS;
      const names = animationFrames(facing, moving);
      const name = names[Math.floor(anim / stepMs) % names.length];
      blitFrame(s, ctx, name, ox + (x - 24) * scale, oy + (y - 60) * scale, scale);

      ctx.restore();
    };

    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') running.current = true;
      const dir = KEYS[e.code];
      if (!dir || isTyping(e.target)) return;
      e.preventDefault();
      keys.current.add(dir);
      setMoved(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') running.current = false;
      const dir = KEYS[e.code];
      if (dir) keys.current.delete(dir);
    };
    // A tab switch or a dragged-away pointer never delivers the keyup, and the
    // character walks into the sea for as long as the page is left alone.
    const clear = () => { keys.current.clear(); pad.current.clear(); running.current = false; };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden bg-void">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full [image-rendering:pixelated]" />

      {/* The world ends by fading rather than by stopping. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(130% 110% at 50% 45%, transparent 52%, rgb(var(--void) / 0.72))',
        }}
      />

      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-void/60 text-[12px] text-faint">
          dressing…
        </div>
      )}

      <div
        className={cx(
          'pointer-events-none absolute left-3 top-3 rounded-[3px] border border-edge/60 bg-void/75',
          'px-2 py-1 text-[11px] text-muted backdrop-blur-sm transition-opacity duration-500',
          moved && 'opacity-0',
        )}
      >
        WASD or arrows to walk · hold shift to run
      </div>

      <Pad onPress={press} />
    </div>
  );
}

/**
 * The on-screen pad.
 *
 * Not only for phones. A page whose only control is the keyboard gives no sign
 * that it HAS one, and the hint above fades; the pad is the affordance that
 * stays. Pointer events rather than mouse or touch, so one set of handlers
 * covers a finger, a mouse and a stylus.
 */
function Pad({ onPress }: { onPress: (dir: Dir, down: boolean) => void }) {
  const cell = (dir: Dir, path: string, className: string) => (
    <button
      type="button"
      aria-label={`Walk ${dir}`}
      className={cx(
        'roam-control flex h-11 w-11 items-center justify-center rounded-[3px] border border-edge/70 sm:h-9 sm:w-9',
        'bg-void/70 text-muted backdrop-blur-sm transition-colors',
        'hover:border-element/60 hover:text-ink active:bg-element/20 active:text-element',
        className,
      )}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); onPress(dir, true); }}
      onPointerUp={() => onPress(dir, false)}
      onPointerCancel={() => onPress(dir, false)}
      onPointerLeave={() => onPress(dir, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="butt" strokeLinejoin="miter">
        <path d={path} />
      </svg>
    </button>
  );

  return (
    <div className="absolute bottom-3 right-3 grid grid-cols-3 grid-rows-3 gap-1 opacity-80 hover:opacity-100">
      {cell('up', 'M12 5.5 5.5 12M12 5.5 18.5 12M12 5.5V19', 'col-start-2 row-start-1')}
      {cell('left', 'M5.5 12 12 5.5M5.5 12 12 18.5M5.5 12H19', 'col-start-1 row-start-2')}
      {cell('right', 'M18.5 12 12 5.5M18.5 12 12 18.5M18.5 12H5', 'col-start-3 row-start-2')}
      {cell('down', 'M12 18.5 5.5 12M12 18.5 18.5 12M12 18.5V5', 'col-start-2 row-start-3')}
    </div>
  );
}
