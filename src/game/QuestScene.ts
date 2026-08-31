/**
 * A real side-scrolling quest: three repeating layers, each moving at its own
 * speed, with the companion's stride locked to the ground speed.
 */
import Phaser from 'phaser';
import { FRAME, ROW, questLayerUrl, rowFrames, sheetUrl } from './assets';
import { reducedMotion } from './boot';

export type QuestInit = {
  sprite: string;
  route: string;
  element?: [number, number, number];
};

const GROUND_SPEED = 34;
const FEET_Y = 160;

export class QuestScene extends Phaser.Scene {
  static readonly KEY = 'quest';

  private init_!: QuestInit;
  private sky!: Phaser.GameObjects.TileSprite;
  private far!: Phaser.GameObjects.TileSprite;
  private mid!: Phaser.GameObjects.TileSprite;
  private pet!: Phaser.GameObjects.Sprite;
  private shadow!: Phaser.GameObjects.Ellipse;
  private quiet = false;

  constructor() {
    super(QuestScene.KEY);
  }

  init(data: QuestInit) {
    this.init_ = data;
    this.quiet = reducedMotion();
  }

  preload() {
    this.load.image('quest-sky', questLayerUrl(this.init_.route, 'sky'));
    this.load.image('quest-far', questLayerUrl(this.init_.route, 'far'));
    this.load.image('quest-mid', questLayerUrl(this.init_.route, 'mid'));
    this.load.spritesheet('quest-pet', sheetUrl(this.init_.sprite), {
      frameWidth: FRAME.w, frameHeight: FRAME.h,
    });
  }

  create() {
    const { width: W, height: H } = this.scale;
    // These y positions are the 216px authored composition cropped by 24px at
    // the top to fit the room plate. The ground line then lands at y=160.
    this.sky = this.add.tileSprite(0, 0, W, H, 'quest-sky').setOrigin(0);
    this.far = this.add.tileSprite(0, H - 28 - 104, W, 104, 'quest-far').setOrigin(0);
    this.mid = this.add.tileSprite(0, H - 176, W, 176, 'quest-mid').setOrigin(0);

    this.anims.create({
      key: 'quest-run',
      frames: this.anims.generateFrameNumbers('quest-pet', { frames: rowFrames(ROW.walkRight) }),
      frameRate: 10,
      repeat: -1,
    });

    this.shadow = this.add.ellipse(112, FEET_Y + 1, 27, 6, 0x000000, 0.32).setDepth(5);
    this.pet = this.add.sprite(112, FEET_Y, 'quest-pet').setOrigin(0.5, 1).setDepth(6);
    if (this.quiet) this.pet.setFrame(rowFrames(ROW.walkRight)[1]);
    else this.pet.play('quest-run');

    this.makeRuneTexture();
    if (!this.quiet) {
      this.add.particles(0, 0, 'quest-rune-mote', {
        x: { min: 0, max: W }, y: { min: 76, max: FEET_Y - 8 },
        lifespan: { min: 2800, max: 5200 },
        speedX: { min: -14, max: -5 }, speedY: { min: -3, max: 2 },
        alpha: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * 0.48,
        scale: { start: 1, end: 0 },
        frequency: 520, quantity: 1,
        blendMode: Phaser.BlendModes.ADD,
      }).setDepth(7);
    }

    const [r, g, b] = this.init_.element ?? [180, 140, 90];
    const colour = Phaser.Display.Color.GetColor(r, g, b);
    const trail = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(4);
    for (let i = 4; i > 0; i -= 1) {
      trail.fillStyle(colour, 0.025);
      trail.fillEllipse(112, FEET_Y + 2, 38 + i * 14, 7 + i * 3);
    }
  }

  private makeRuneTexture() {
    if (this.textures.exists('quest-rune-mote')) return;
    const canvas = this.textures.createCanvas('quest-rune-mote', 3, 3);
    if (!canvas) return;
    const ctx = canvas.getContext();
    const [r, g, b] = this.init_.element ?? [180, 140, 90];
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(1, 0, 1, 3);
    ctx.fillRect(0, 1, 3, 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 1, 1, 1);
    canvas.refresh();
  }

  update(_now: number, delta: number) {
    if (this.quiet || !this.pet) return;
    const moved = GROUND_SPEED * Math.min(delta, 50) / 1000;
    this.sky.tilePositionX += moved * 0.04;
    this.far.tilePositionX += moved * 0.20;
    this.mid.tilePositionX += moved;

    // The body advances slightly inside the frame while the world moves under
    // it. Both use the same clock, so the stride never turns into a moonwalk.
    const bob = Math.sin(this.time.now * 0.012) * 0.6;
    this.pet.y = FEET_Y + bob;
    this.shadow.setSize(25 + Math.cos(this.time.now * 0.012) * 2, 6);
  }
}
