/**
 * The companion's room.
 *
 * What this replaces, and why none of it survived:
 *
 *  - The scale was fractional. `clientHeight / 96` is 1.917 at the size the
 *    panel actually is, and the backdrop was separately stretched with
 *    `object-cover` to a different fraction again. Two pixel grids, neither
 *    landing on the screen's. Here the world IS the plate's own resolution and
 *    boot.ts only ever applies a whole-number zoom.
 *  - Movement advanced by `SPEED / 60` per FRAME while the walk cycle advanced
 *    off the wall clock, so on a 120Hz display the companion slid at double
 *    speed with the same leg animation — the exact desync the old file's header
 *    claimed to have fixed. Everything here is driven by `delta`.
 *  - The position was rounded to CSS pixels, not art pixels, so the sprite's
 *    own grid slid against the room's grid as it walked. Phaser's `roundPixels`
 *    snaps in world space, which is art space, which is the grid that matters.
 *  - Two of the six sheet rows were ever drawn. Idle was row 0 frame 0, held
 *    perfectly still: for the ~45% of the time the companion was not walking it
 *    was a photograph.
 */
import Phaser from 'phaser';
import { FRAME, ROW, STAND_FRAME, rowFrames, roomUrl, sheetUrl } from './assets';
import { reducedMotion } from './boot';

export type RoomInit = {
  sprite: string;
  backdrop: string;
  /** Dimmed and still — the companion is away at the arena. */
  away?: boolean;
  /** rgb triple of the faction colour, for the floor light. */
  element?: [number, number, number];
};

const WALK_FPS = 7;
const SPEED = 26;           // art px per second
const MARGIN = 26;          // how close to the edges it will walk

type Mode = 'idle' | 'walk' | 'look';

export class RoomScene extends Phaser.Scene {
  static readonly KEY = 'room';

  private init_!: RoomInit;
  private pet!: Phaser.GameObjects.Sprite;
  private shadow!: Phaser.GameObjects.Ellipse;
  private mode: Mode = 'idle';
  private facing: 1 | -1 = 1;
  private until = 0;
  private still = false;
  private emoting = false;
  private nextEmote = 0;

  constructor() {
    super(RoomScene.KEY);
  }

  init(data: RoomInit) {
    this.init_ = data;
    this.still = !!data.away || reducedMotion();
  }

  preload() {
    this.load.image('backdrop', roomUrl(this.init_.backdrop));
    this.load.spritesheet('pet', sheetUrl(this.init_.sprite), {
      frameWidth: FRAME.w, frameHeight: FRAME.h,
    });
  }

  create() {
    const { width: W, height: H } = this.scale;

    this.add.image(0, 0, 'backdrop').setOrigin(0, 0).setDisplaySize(W, H);

    // The floor line. The house plates are composed with a clear walking band
    // across the bottom, so the companion's feet belong just above the frame
    // edge rather than centred in the panel.
    const floorY = H - 10;

    for (const [name, row] of Object.entries(ROW)) {
      if (this.anims.exists(name)) continue;
      this.anims.create({
        key: name,
        frames: this.anims.generateFrameNumbers('pet', { frames: rowFrames(row) }),
        // The two standing rows are one-shot emotes; only walking loops.
        frameRate: name === 'idle' || name === 'emote' ? 6 : WALK_FPS,
        repeat: name === 'idle' || name === 'emote' ? 0 : -1,
      });
    }

    // A cast-looking contact shadow. Drawn as its own object so it can squash
    // while walking and stay put while the sprite bobs — a shadow that bobs
    // with the feet is what makes a sprite look like a sticker.
    this.shadow = this.add.ellipse(W / 2, floorY + 1, 30, 7, 0x000000, 0.34);

    this.pet = this.add.sprite(W / 2, floorY, 'pet', 0)
      .setOrigin(0.5, 1);

    if (this.init_.away) {
      this.pet.setAlpha(0.45);
      this.shadow.setAlpha(0.15);
    }

    this.elementLight(W, H, floorY);
    this.dust(W, H);

    this.until = this.time.now + 500;
    if (this.still) this.pet.setFrame(rowFrames(ROW.walkDown)[0]);
  }

  /**
   * A pool of light on the floor in the faction's colour, and a vignette.
   *
   * Both are drawn INTO the scene rather than layered over the canvas in CSS,
   * which is how the old room did it — a CSS gradient sitting on top of a
   * pixel-art panel is a smooth gradient over hard pixels, and it reads as a
   * sheet of glass in front of the room rather than as light in it.
   */
  private elementLight(W: number, H: number, floorY: number) {
    const [r, g, b] = this.init_.element ?? [180, 140, 90];
    const colour = Phaser.Display.Color.GetColor(r, g, b);

    const glow = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 6; i > 0; i -= 1) {
      glow.fillStyle(colour, 0.030);
      glow.fillEllipse(W / 2, floorY + 2, W * (0.35 + i * 0.14), 26 + i * 7);
    }

    const vignette = this.add.graphics();
    for (let i = 0; i < 10; i += 1) {
      vignette.fillStyle(0x05070c, 0.055);
      vignette.fillRect(0, 0, W, 3 + i * 2);
      vignette.fillRect(0, H - (3 + i * 2), W, 3 + i * 2);
      vignette.fillRect(0, 0, 3 + i * 2, H);
      vignette.fillRect(W - (3 + i * 2), 0, 3 + i * 2, H);
    }
  }

  /**
   * Dust in the air.
   *
   * One-pixel motes on an additive blend, drifting up and across very slowly.
   * This is the cheapest thing in the scene and does more for "the room is a
   * place" than anything else in it — a still pixel-art plate with a sprite on
   * it reads as a screenshot until something in the air moves.
   */
  private dust(W: number, H: number) {
    if (reducedMotion()) return;
    const dot = this.textures.createCanvas('dust', 1, 1);
    if (dot) {
      const ctx = dot.getContext();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 1, 1);
      dot.refresh();
    }
    this.add.particles(0, 0, 'dust', {
      x: { min: 0, max: W },
      y: { min: H * 0.3, max: H },
      lifespan: { min: 6000, max: 12000 },
      speedY: { min: -5, max: -1 },
      speedX: { min: -3, max: 3 },
      scale: { min: 1, max: 2 },
      // Fade in and back out over the mote's life, so none ever pops into or
      // out of existence. `alpha` as a start/end pair can only ramp one way;
      // the callback form is what allows a curve.
      alpha: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * 0.6,
      emitting: true,
      frequency: 900,
      quantity: 1,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(5);
  }

  /** Choose what to do next. Idle more than it walks. */
  private choose(now: number) {
    const roll = Math.random();
    if (roll < 0.45) {
      this.mode = 'walk';
      if (Math.random() < 0.5) this.facing = this.facing === 1 ? -1 : 1;
      this.until = now + 1200 + Math.random() * 2200;
    } else if (roll < 0.62) {
      // Turn and look at the room — the up and down rows, which the old
      // implementation never once drew.
      this.mode = 'look';
      this.until = now + 900 + Math.random() * 1400;
    } else {
      this.mode = 'idle';
      this.until = now + 1400 + Math.random() * 2600;
    }
  }

  update(now: number, delta: number) {
    if (!this.pet) return;
    if (this.still) {
      this.pet.anims.stop();
      return;
    }

    if (now > this.until) this.choose(now);

    // A stretch or a shake every so often, so standing still is not the same
    // as being a photograph. One shot, then back to the neutral frame.
    if (!this.emoting && this.mode === 'idle' && now > this.nextEmote) {
      this.nextEmote = now + 7000 + Math.random() * 9000;
      this.emoting = true;
      this.pet.play(Math.random() < 0.5 ? 'idle' : 'emote');
      this.pet.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.emoting = false;
        this.pet?.setFrame(STAND_FRAME);
      });
    }
    if (this.emoting && this.mode !== 'idle') {
      this.emoting = false;
    }

    const W = this.scale.width;
    if (this.mode === 'walk') {
      // Delta-time, so the walk is the same speed on a 60Hz and a 144Hz screen
      // and always agrees with the leg animation.
      this.pet.x += (this.facing * SPEED * delta) / 1000;
      if (this.pet.x < MARGIN) { this.pet.x = MARGIN; this.facing = 1; }
      if (this.pet.x > W - MARGIN) { this.pet.x = W - MARGIN; this.facing = -1; }
      // Rows are authored facing right; left is the same row flipped.
      this.pet.setFlipX(this.facing === -1);
      this.play('walkRight');
    } else if (this.mode === 'look') {
      this.pet.setFlipX(false);
      this.play(Math.floor(now / 1600) % 2 === 0 ? 'walkDown' : 'walkUp');
    } else {
      // Standing means HOLDING the neutral frame. Playing the standing row as
      // a loop looked like the companion repeatedly swiping at nothing, because
      // three of its four frames are an emote.
      this.pet.setFlipX(this.facing === -1);
      if (!this.emoting) {
        this.pet.anims.stop();
        this.pet.setFrame(STAND_FRAME);
      }
    }

    const walking = this.mode === 'walk';
    this.shadow.x = this.pet.x;
    this.shadow.setSize(walking ? 26 : 30, walking ? 6 : 7);
  }

  private play(key: string) {
    if (this.pet.anims.currentAnim?.key !== key) this.pet.play(key);
  }
}
