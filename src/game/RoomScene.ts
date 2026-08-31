/**
 * The companion's home scene.
 *
 * Movement is destination-driven. The creature owns a position in the room,
 * moves toward a real waypoint with delta time, and chooses its animation from
 * that velocity. There is no separate "pretend to walk up" state: if the up
 * row is playing, its y coordinate is decreasing on the same frame.
 */
import Phaser from 'phaser';
import { FRAME, ROW, STAND_FRAME, homeUrl, rowFrames, sheetUrl } from './assets';
import { reducedMotion } from './boot';

export type RoomInit = {
  sprite: string;
  backdrop: string;
  /** Dimmed and still because the companion is away at the arena. */
  away?: boolean;
  /** rgb triple of the faction colour, for the floor light. */
  element?: [number, number, number];
};

const WALK_FPS = 8;
const SPEED = 31; // art pixels per second
const BACK_Y = 121;
const FRONT_Y = 181;
const ARRIVAL_EPSILON = 1.2;

type Mode = 'idle' | 'walk';
type Facing = 'left' | 'right' | 'up' | 'down';

const WALK_ANIMATION: Record<Facing, keyof typeof ROW> = {
  left: 'walkLeft', right: 'walkRight', up: 'walkUp', down: 'walkDown',
};

export class RoomScene extends Phaser.Scene {
  static readonly KEY = 'room';

  private init_!: RoomInit;
  private pet!: Phaser.GameObjects.Sprite;
  private shadow!: Phaser.GameObjects.Ellipse;
  private position = new Phaser.Math.Vector2();
  private target = new Phaser.Math.Vector2();
  private mode: Mode = 'idle';
  private facing: Facing = 'down';
  private until = 0;
  private still = false;
  private emoting = false;
  private nextEmote = 0;
  private feedingSince = 0;
  private feedingUntil = 0;

  constructor() {
    super(RoomScene.KEY);
  }

  init(data: RoomInit) {
    this.init_ = data;
    this.still = !!data.away || reducedMotion();
  }

  preload() {
    this.load.image('backdrop', homeUrl(this.init_.backdrop));
    this.load.spritesheet('pet', sheetUrl(this.init_.sprite), {
      frameWidth: FRAME.w, frameHeight: FRAME.h,
    });
  }

  create() {
    const { width: W, height: H } = this.scale;
    this.add.image(0, 0, 'backdrop').setOrigin(0, 0).setDisplaySize(W, H);

    for (const [name, row] of Object.entries(ROW)) {
      if (this.anims.exists(name)) continue;
      this.anims.create({
        key: name,
        frames: this.anims.generateFrameNumbers('pet', { frames: rowFrames(row) }),
        frameRate: name === 'idle' || name === 'emote' ? 7 : WALK_FPS,
        repeat: name === 'idle' || name === 'emote' ? 0 : -1,
      });
    }

    this.position.set(W / 2, FRONT_Y - 5);
    this.target.copy(this.position);
    this.shadow = this.add.ellipse(this.position.x, this.position.y + 1, 30, 7, 0x000000, 0.34);
    this.pet = this.add.sprite(this.position.x, this.position.y, 'pet', STAND_FRAME)
      .setOrigin(0.5, 1);

    if (this.init_.away) {
      this.pet.setAlpha(0.45);
      this.shadow.setAlpha(0.15);
    }

    this.elementLight(W, H);
    this.dust(W, H);
    this.until = this.time.now + 650;
    this.nextEmote = this.time.now + 3500 + Math.random() * 3500;
    this.setStandingFrame();
    this.applyPose(0);
  }

  /**
   * Called by React when a successful feed changes `totalTimesFed`.
   * The berry flight lives in the transparent Three.js layer; this is the
   * creature's matching catch/eat response inside the pixel world.
   */
  feed() {
    if (!this.pet) return;
    const now = this.time.now;
    this.mode = 'idle';
    this.feedingSince = now;
    this.feedingUntil = now + (this.still ? 500 : 1800);
    this.until = this.feedingUntil + 500;
    this.emoting = true;
    this.pet.play('emote', true);
    this.pet.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.emoting = false;
      this.setStandingFrame();
    });
  }

  /** Anchor for effects rendered by the transparent Three.js canvas above us. */
  petAnchor(): { x: number; y: number } {
    return {
      x: this.pet ? this.pet.x / this.scale.width : 0.5,
      y: this.pet ? (this.pet.y - 30 * this.pet.scaleY) / this.scale.height : 0.72,
    };
  }

  private elementLight(W: number, H: number) {
    const [r, g, b] = this.init_.element ?? [180, 140, 90];
    const colour = Phaser.Display.Color.GetColor(r, g, b);
    const glow = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 6; i > 0; i -= 1) {
      glow.fillStyle(colour, 0.030);
      glow.fillEllipse(W / 2, FRONT_Y + 2, W * (0.35 + i * 0.14), 26 + i * 7);
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

  private dust(W: number, H: number) {
    if (reducedMotion()) return;
    const dot = this.textures.createCanvas('room-dust', 1, 1);
    if (dot) {
      const ctx = dot.getContext();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 1, 1);
      dot.refresh();
    }
    this.add.particles(0, 0, 'room-dust', {
      x: { min: 0, max: W }, y: { min: H * 0.3, max: H },
      lifespan: { min: 6000, max: 12000 },
      speedY: { min: -5, max: -1 }, speedX: { min: -3, max: 3 },
      scale: { min: 1, max: 2 },
      alpha: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * 0.6,
      emitting: true, frequency: 900, quantity: 1,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(5);
  }

  /** The room is a trapezoid in perspective, so its x limits widen near us. */
  private xBounds(y: number): [number, number] {
    const t = Phaser.Math.Clamp((y - BACK_Y) / (FRONT_Y - BACK_Y), 0, 1);
    return [Phaser.Math.Linear(62, 28, t), Phaser.Math.Linear(322, 356, t)];
  }

  private choose(now: number) {
    if (Math.random() < 0.42) {
      this.mode = 'idle';
      this.until = now + 1100 + Math.random() * 2300;
      this.setStandingFrame();
      return;
    }

    const y = Phaser.Math.Between(BACK_Y, FRONT_Y);
    const [left, right] = this.xBounds(y);
    this.target.set(Phaser.Math.Between(Math.ceil(left), Math.floor(right)), y);

    // A roll that lands almost on the current point looks like the creature
    // started dragging and gave up. Push short walks to a useful distance.
    if (Phaser.Math.Distance.BetweenPoints(this.position, this.target) < 38) {
      this.target.x = this.position.x < this.scale.width / 2 ? right - 8 : left + 8;
    }
    this.mode = 'walk';
    this.until = now + 7000; // safety valve; arrival normally ends it first
  }

  update(now: number, delta: number) {
    if (!this.pet) return;

    if (this.feedingUntil > now) {
      const span = Math.max(1, this.feedingUntil - this.feedingSince);
      const progress = 1 - (this.feedingUntil - now) / span;
      this.applyPose(Math.sin(progress * Math.PI) * (this.still ? 0 : 8));
      return;
    }

    if (this.still) {
      this.pet.anims.stop();
      this.applyPose(0);
      return;
    }

    if (now > this.until) this.choose(now);

    let moving = false;
    if (this.mode === 'walk') {
      const dx = this.target.x - this.position.x;
      const dy = this.target.y - this.position.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= ARRIVAL_EPSILON) {
        this.position.copy(this.target);
        this.mode = 'idle';
        this.until = now + 700 + Math.random() * 2100;
        this.setStandingFrame();
      } else {
        const step = Math.min(distance, SPEED * Math.min(delta, 50) / 1000);
        const vx = dx / distance;
        const vy = dy / distance;
        this.position.x += vx * step;
        this.position.y += vy * step;

        // Defensive collision with the walkable trapezoid. Waypoints are
        // generated inside it, but a resized or future scripted move should
        // still land in a standing pose instead of pumping the walk cycle into
        // an edge forever.
        const unclampedX = this.position.x;
        const unclampedY = this.position.y;
        this.position.y = Phaser.Math.Clamp(this.position.y, BACK_Y, FRONT_Y);
        const [left, right] = this.xBounds(this.position.y);
        this.position.x = Phaser.Math.Clamp(this.position.x, left, right);
        const hitBoundary = this.position.x !== unclampedX || this.position.y !== unclampedY;

        // Stop on the arrival frame, not the frame after it. Letting the final
        // stride start and only noticing arrival on the next update is the
        // little foot-slide that makes a creature look as if it hit a wall.
        if (hitBoundary || step >= distance - ARRIVAL_EPSILON) {
          if (!hitBoundary) this.position.copy(this.target);
          this.mode = 'idle';
          this.until = now + 700 + Math.random() * 2100;
          this.setStandingFrame();
        } else {
          moving = true;

          // The row follows the dominant component of the velocity actually
          // applied above. A vertical animation can therefore never play while
          // y is standing still.
          if (Math.abs(vx) > Math.abs(vy)) this.facing = vx < 0 ? 'left' : 'right';
          else this.facing = vy < 0 ? 'up' : 'down';
          this.play(WALK_ANIMATION[this.facing]);
        }
      }
    }

    if (!moving && this.mode === 'idle') {
      if (!this.emoting && now > this.nextEmote) {
        this.nextEmote = now + 7000 + Math.random() * 9000;
        this.emoting = true;
        this.pet.play(Math.random() < 0.5 ? 'idle' : 'emote');
        this.pet.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          this.emoting = false;
          this.setStandingFrame();
        });
      } else if (!this.emoting) {
        this.setStandingFrame();
      }
    }

    this.applyPose(0, moving);
  }

  private applyPose(jump: number, moving = false) {
    const perspective = Phaser.Math.Clamp((this.position.y - BACK_Y) / (FRONT_Y - BACK_Y), 0, 1);
    const scale = Phaser.Math.Linear(0.76, 1, perspective);
    this.pet.setPosition(this.position.x, this.position.y - jump).setScale(scale);
    this.pet.setDepth(Math.round(this.position.y));
    this.shadow
      .setPosition(this.position.x, this.position.y + 1)
      .setSize((moving ? 25 : 29) * scale, (moving ? 5.5 : 7) * scale)
      .setDepth(Math.round(this.position.y) - 1)
      .setAlpha(this.init_.away ? 0.15 : 0.34 * (1 - jump / 14));
  }

  private setStandingFrame() {
    if (!this.pet || this.emoting) return;
    this.pet.anims.stop();
    this.pet.setFlipX(false);
    if (this.facing === 'up' || this.facing === 'down') {
      this.pet.setFrame(rowFrames(ROW[this.facing === 'up' ? 'walkUp' : 'walkDown'])[1]);
    } else {
      // The sheet's true neutral pose faces right; flipping it is correct for
      // a still left pose. Walking uses the authored left row and is not flipped.
      this.pet.setFrame(STAND_FRAME).setFlipX(this.facing === 'left');
    }
  }

  private play(key: keyof typeof ROW) {
    this.pet.setFlipX(false);
    if (this.pet.anims.currentAnim?.key !== key || !this.pet.anims.isPlaying) {
      this.pet.play(key);
    }
  }
}
