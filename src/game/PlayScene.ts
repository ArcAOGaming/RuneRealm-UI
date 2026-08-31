/** A looping game of fetch in one of the dedicated play scenes. */
import Phaser from 'phaser';
import { FRAME, ROW, STAND_FRAME, playUrl, rowFrames, sheetUrl } from './assets';
import { reducedMotion } from './boot';

export type PlayInit = {
  sprite: string;
  backdrop: string;
  /** Locally composed 576x60 player sheet. Omitted when the account has no character. */
  playerSprite?: string;
  element?: [number, number, number];
};

const FLOOR_Y = 180;
const CYCLE_MS = 8200;

const ease = (t: number) => Phaser.Math.Easing.Sine.InOut(Phaser.Math.Clamp(t, 0, 1));
const between = (from: number, to: number, t: number) => Phaser.Math.Linear(from, to, ease(t));

export class PlayScene extends Phaser.Scene {
  static readonly KEY = 'play';

  private init_!: PlayInit;
  private pet!: Phaser.GameObjects.Sprite;
  private petShadow!: Phaser.GameObjects.Ellipse;
  private player?: Phaser.GameObjects.Sprite;
  private ball!: Phaser.GameObjects.Image;
  private started = 0;
  private quiet = false;
  private lastPetAnimation = '';

  constructor() {
    super(PlayScene.KEY);
  }

  init(data: PlayInit) {
    this.init_ = data;
    this.quiet = reducedMotion();
  }

  preload() {
    this.load.image('play-backdrop', playUrl(this.init_.backdrop));
    this.load.spritesheet('play-pet', sheetUrl(this.init_.sprite), {
      frameWidth: FRAME.w, frameHeight: FRAME.h,
    });
    if (this.init_.playerSprite) {
      this.load.spritesheet('play-player', this.init_.playerSprite, {
        frameWidth: 48, frameHeight: 60,
      });
    }
  }

  create() {
    const { width: W, height: H } = this.scale;
    this.add.image(0, 0, 'play-backdrop').setOrigin(0).setDisplaySize(W, H);

    for (const direction of ['walkLeft', 'walkRight'] as const) {
      const key = `play-${direction}`;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers('play-pet', { frames: rowFrames(ROW[direction]) }),
        frameRate: 10,
        repeat: -1,
      });
    }

    if (this.textures.exists('play-player')) {
      this.anims.create({
        key: 'play-player-right',
        frames: this.anims.generateFrameNumbers('play-player', { frames: [6, 7, 8, 7] }),
        frameRate: 9,
        repeat: -1,
      });
      this.add.ellipse(292, FLOOR_Y + 1, 20, 5, 0x000000, 0.3);
      this.player = this.add.sprite(292, FLOOR_Y, 'play-player', 7).setOrigin(0.5, 1);
    }

    this.petShadow = this.add.ellipse(216, FLOOR_Y + 1, 28, 7, 0x000000, 0.34);
    this.pet = this.add.sprite(216, FLOOR_Y, 'play-pet', STAND_FRAME).setOrigin(0.5, 1);

    this.makeBallTexture();
    this.ball = this.add.image(270, FLOOR_Y - 31, 'fetch-ball').setVisible(false);

    const [r, g, b] = this.init_.element ?? [180, 140, 90];
    const colour = Phaser.Display.Color.GetColor(r, g, b);
    const light = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(0);
    for (let i = 4; i > 0; i -= 1) {
      light.fillStyle(colour, 0.025);
      light.fillEllipse(W / 2, FLOOR_Y + 3, W * (0.42 + i * 0.13), 30 + i * 8);
    }

    this.pet.setDepth(3);
    this.ball.setDepth(4);
    this.player?.setDepth(3);
    this.started = this.time.now;

    if (this.quiet) this.drawQuietPose();
  }

  private makeBallTexture() {
    if (this.textures.exists('fetch-ball')) return;
    const canvas = this.textures.createCanvas('fetch-ball', 9, 9);
    if (!canvas) return;
    const ctx = canvas.getContext();
    const [r, g, b] = this.init_.element ?? [255, 176, 80];
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(2, 1, 5, 7);
    ctx.fillRect(1, 2, 7, 5);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(2, 2, 5, 5);
    ctx.fillStyle = '#fff4cf';
    ctx.fillRect(2, 2, 2, 2);
    canvas.refresh();
  }

  private drawQuietPose() {
    this.pet.setPosition(216, FLOOR_Y).setFrame(STAND_FRAME);
    this.player?.setPosition(292, FLOOR_Y).setFrame(7);
    this.ball.setPosition(244, FLOOR_Y - 7).setVisible(true);
  }

  update(now: number) {
    if (!this.pet || this.quiet) return;
    const t = (now - this.started) % CYCLE_MS;
    const throwX = this.player ? 270 : 384;

    this.player?.setPosition(292, FLOOR_Y).setRotation(0);
    this.ball.setVisible(false).setRotation(t * 0.012);

    let petX = 216;
    let walking: 'left' | 'right' | null = null;
    let jump = 0;
    let playerMoving = false;

    if (t < 850) {
      // Both wait for the next throw.
    } else if (t < 1850) {
      const p = (t - 850) / 1000;
      this.ball
        .setVisible(true)
        .setPosition(Phaser.Math.Linear(throwX, -18, p), FLOOR_Y - 8 - Math.sin(p * Math.PI) * 73);
      if (this.player) {
        this.player.setRotation(Math.sin(p * Math.PI) * -0.12);
        playerMoving = p < 0.55;
      }
      petX = between(216, 160, p);
      walking = 'left';
    } else if (t < 2650) {
      const p = (t - 1850) / 800;
      petX = between(160, -35, p);
      walking = 'left';
    } else if (t < 3300) {
      petX = -35;
    } else if (t < 5650) {
      const p = (t - 3300) / 2350;
      petX = between(-35, 226, p);
      walking = 'right';
      this.ball.setVisible(true).setPosition(petX + 18, FLOOR_Y - 28 + Math.sin(p * 16) * 1.5);
    } else if (t < 6900) {
      petX = 226;
      this.ball.setVisible(true).setPosition(244, FLOOR_Y - 25);
      jump = Math.sin(((t - 5650) / 1250) * Math.PI) * 5;
    } else {
      const p = (t - 6900) / (CYCLE_MS - 6900);
      petX = between(226, 216, p);
      this.ball.setVisible(true).setPosition(between(244, throwX, p), FLOOR_Y - 25);
    }

    this.pet.setPosition(petX, FLOOR_Y - jump);
    this.petShadow
      .setPosition(petX, FLOOR_Y + 1)
      .setSize(walking ? 24 : 28, walking ? 6 : 7)
      .setAlpha(0.34 * (1 - jump / 10));

    if (this.player) {
      if (playerMoving) {
        if (this.player.anims.currentAnim?.key !== 'play-player-right' || !this.player.anims.isPlaying) {
          this.player.play('play-player-right');
        }
      } else {
        this.player.anims.stop();
        this.player.setFrame(7);
      }
    }

    if (walking) {
      const key = `play-walk${walking === 'left' ? 'Left' : 'Right'}`;
      if (key !== this.lastPetAnimation || !this.pet.anims.isPlaying) {
        this.pet.setFlipX(false).play(key);
        this.lastPetAnimation = key;
      }
    } else {
      this.pet.anims.stop();
      this.pet.setFrame(STAND_FRAME).setFlipX(t >= 5650 && t < 6900);
      this.lastPetAnimation = '';
    }
  }
}
