/**
 * Mounting Phaser inside React, on one coherent pixel grid.
 *
 * Everything in here exists to protect one property: **one art pixel is always
 * a whole number of screen pixels.** That is the thing the old canvas Room got
 * wrong and could not have got right — it derived its scale from the panel
 * height (`clientHeight / 96`, which is 1.917 at the size the panel actually
 * is), so the backdrop and the sprite were drawn at different fractional
 * scales, on grids that did not line up with each other or with the screen.
 * No amount of `image-rendering: pixelated` fixes that; it only decides which
 * neighbouring pixel gets doubled.
 *
 * The fix is ONE BUFFER. Everything — backdrop, sprite, shadow, effects, the
 * floating damage numbers — is drawn into a single surface at the art's own
 * resolution, and that whole surface is then scaled up uniformly to fill the
 * panel. Every element is on the same grid by construction, because there is
 * only one grid. Whether the final blit is 2x or 1.63x, nothing inside it can
 * drift relative to anything else.
 *
 * Integer-only scaling was tried first and abandoned for a real reason: the
 * companion panel is about 627px wide, 384 * 2 = 768 does not fit, so flooring
 * pins the scene at 1x and leaves 240px of dead margin around a postage stamp.
 * A uniform fractional blit of a coherent buffer looks far better than a
 * correctly-scaled scene nobody can see. `pixelArt` keeps that blit
 * nearest-neighbour, so it doubles pixel rows rather than blurring them.
 *
 * `roundPixels` and `pixelArt` are both on. `pixelArt` sets NEAREST filtering
 * on every texture; `roundPixels` snaps sprite positions to whole pixels at
 * draw time — in WORLD space, which is art space, so a tweened lunge advances
 * a pixel at a time instead of shimmering between two of them.
 */
import Phaser from 'phaser';

/**
 * React 18 StrictMode mounts every effect twice in development, and two Phaser
 * games sharing one parent element render as garbage — the second one appends
 * a canvas over the first and both keep their own rAF loop running.
 *
 * Keyed on the parent element rather than held in a ref, because the effect
 * that would own the ref is itself the thing being run twice. Whatever is
 * already live on this element is destroyed before a replacement is made.
 */
const LIVE = new WeakMap<HTMLElement, Phaser.Game>();

export type Mounted = {
  game: Phaser.Game;
  /** The running scene, once it has booted. Null until `create()` has run. */
  scene<T extends Phaser.Scene>(key: string): T | null;
  destroy(): void;
};

/**
 * Boot a game whose world is exactly `baseW x baseH` art pixels.
 *
 * The buffer never changes size; only the blit to the parent does, and Phaser
 * recalculates that whenever the parent is resized. `onScale` reports the
 * resulting factor, which callers use only to know the scene is up.
 */
export function mountGame(
  parent: HTMLElement,
  baseW: number,
  baseH: number,
  scenes: Phaser.Types.Scenes.SceneType[],
  opts: { data?: object; maxZoom?: number; onScale?: (zoom: number) => void } = {},
): Mounted {
  LIVE.get(parent)?.destroy(true);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    // Phaser prints a coloured version banner to the console on every boot.
    // The scene mounts and remounts as screens come and go, so that is a line
    // of noise per mount in the one place real errors have to be visible.
    banner: false,
    width: baseW,
    height: baseH,
    transparent: false,
    backgroundColor: '#000000',
    pixelArt: true,
    roundPixels: true,
    // No physics: nothing here needs collision or gravity, and the arcade
    // world is an extra step per frame plus a debug draw in dev.
    // FIT scales the canvas to the parent with the aspect preserved, so the
    // scene fills the panel and the buffer stays exactly baseW x baseH.
    // NO_CENTER, deliberately. Phaser's own centring sets a margin on the
    // canvas computed from the parent it measured, and when the parent is also
    // centring with CSS the two disagree -- the canvas ended up flush against
    // the right edge of a very wide panel. Let the parent's `place-items:center`
    // do it; there is then one thing positioning the canvas instead of two.
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: baseW,
      height: baseH,
    },
    audio: { noAudio: true },
    scene: scenes,
  });
  LIVE.set(parent, game);

  // A handle on the live game, in development only.
  //
  // Everything interesting in a scene — the playback queue, a fighter's
  // position, whether a promise is still outstanding — is unreachable from the
  // DOM, so a scene that stalls can only be diagnosed by staring at it. This
  // costs nothing in a production build, where `import.meta.env.DEV` folds to
  // false and the branch is dropped.
  if (import.meta.env.DEV) {
    (window as unknown as { __phaser?: Phaser.Game }).__phaser = game;
  }

  const apply = () => {
    const { clientWidth: cw, clientHeight: ch } = parent;
    if (!cw || !ch) return;
    game.scale.refresh();
    // Nearest-neighbour on the way up. Without this the browser bilinearly
    // smooths the final blit and every hard pixel edge in the art goes soft --
    // which is the single most visible thing that separates pixel art from a
    // photograph of pixel art.
    game.canvas.style.imageRendering = 'pixelated';
    opts.onScale?.(cw / baseW);
  };

  // ResizeObserver rather than a window listener: the panel changes width when
  // the grid reflows around it, which no window resize event reports.
  const ro = new ResizeObserver(apply);
  ro.observe(parent);
  apply();

  return {
    game,
    scene<T extends Phaser.Scene>(key: string) {
      const s = game.scene.getScene(key);
      // `sys.isActive()` is false while the scene is still booting, and a
      // caller that touches an un-created scene gets undefined children.
      return s && s.sys.isActive() ? (s as T) : null;
    },
    destroy() {
      ro.disconnect();
      if (LIVE.get(parent) === game) LIVE.delete(parent);
      game.destroy(true);
    },
  };
}

/** Whether the viewer has asked for less motion. Scenes go still, not blank. */
export const reducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
