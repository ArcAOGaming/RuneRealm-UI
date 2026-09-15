/**
 * A real side-scrolling quest: three repeating layers, each moving at its own
 * speed, with the companion's stride locked to the ground speed.
 */
import Phaser from 'phaser';
import { questLayerUrl } from './assets';
import { reducedMotion } from './boot';
import { MonsterRig, monsterRig } from './MonsterRig';

export type QuestInit = {
  sprite: string;
  entryNo?: number;
  route: string;
  /** Admin Studio drafts use the production scene before entering the bundle. */
  layerUrls?: Partial<Record<'sky' | 'far' | 'mid', string>>;
  element?: [number, number, number];
};

const BASE_W = 384;
const BASE_H = 192;
// The quest alone renders at 2x. A half-art-pixel scroll then becomes one real
// render pixel, so motion can update at 60fps without resampling the source art.
export const QUEST_RENDER_SCALE = 2;
/** Both production and Studio keep the 2x buffer whole when the fit is close. */
export const QUEST_SNAP_TOLERANCE = 0.06;
const SCROLL_SPEED = { sky: 2, far: 6, mid: 30 } as const;
const FEET_Y = 168;

export class QuestScene extends Phaser.Scene {
  static readonly KEY = 'quest';

  private init_!: QuestInit;
  private sky!: Phaser.GameObjects.TileSprite;
  private far!: Phaser.GameObjects.TileSprite;
  private mid!: Phaser.GameObjects.TileSprite;
  private pet!: Phaser.GameObjects.Sprite;
  private quiet = false;
  private rig!: MonsterRig;
  private travelSeconds = 0;
  private renderScale = QUEST_RENDER_SCALE;

  constructor() {
    super(QuestScene.KEY);
  }

  init(data: QuestInit) {
    this.init_ = data;
    this.rig = monsterRig({ entryNo: data.entryNo, sprite: data.sprite });
    this.quiet = reducedMotion();
    this.travelSeconds = 0;
  }

  preload() {
    this.load.image('quest-sky', this.init_.layerUrls?.sky ?? questLayerUrl(this.init_.route, 'sky'));
    this.load.image('quest-far', this.init_.layerUrls?.far ?? questLayerUrl(this.init_.route, 'far'));
    this.load.image('quest-mid', this.init_.layerUrls?.mid ?? questLayerUrl(this.init_.route, 'mid'));
    this.rig.preload(this, 'quest-pet');
  }

  create() {
    const { width: W, height: H } = this.scale;
    this.renderScale = W / BASE_W;
    const px = (value: number) => value * this.renderScale;
    // These y positions are the 216px authored composition cropped by 24px at
    // the top to fit the room plate. The walk line then lands at base y=168.
    this.sky = this.add.tileSprite(0, 0, W, H, 'quest-sky')
      .setOrigin(0).setTileScale(this.renderScale);
    this.far = this.add.tileSprite(0, px(BASE_H - 28 - 104), W, px(104), 'quest-far')
      .setOrigin(0).setTileScale(this.renderScale);
    this.mid = this.add.tileSprite(0, px(BASE_H - 176), W, px(176), 'quest-mid')
      .setOrigin(0).setTileScale(this.renderScale);

    this.rig.register(this, 'quest-pet', 'quest-pet');

    this.rig.createShadow(this, px(112), px(FEET_Y), 0x000000, 0.32)
      .setDepth(5).setScale(this.renderScale);
    this.pet = this.rig.createSprite(this, 'quest-pet', px(112), px(FEET_Y)).setDepth(6);
    this.pet.setScale(this.pet.scaleX * this.renderScale, this.pet.scaleY * this.renderScale);
    if (this.quiet) this.rig.hold(this.pet, 'right');
    else this.rig.loop(this.pet, 'quest-pet', 'walk.right');

    this.makeRuneTexture();
    if (!this.quiet) {
      this.add.particles(0, 0, 'quest-rune-mote', {
        x: { min: 0, max: W }, y: { min: px(76), max: px(FEET_Y - 8) },
        lifespan: { min: 2800, max: 5200 },
        speedX: { min: px(-14), max: px(-5) }, speedY: { min: px(-3), max: px(2) },
        alpha: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * 0.48,
        scale: { start: this.renderScale, end: 0 },
        frequency: 520, quantity: 1,
        blendMode: Phaser.BlendModes.ADD,
      }).setDepth(7);
    }

    const [r, g, b] = this.init_.element ?? [180, 140, 90];
    const colour = Phaser.Display.Color.GetColor(r, g, b);
    const trail = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(4);
    for (let i = 4; i > 0; i -= 1) {
      trail.fillStyle(colour, 0.025);
      trail.fillEllipse(px(112), px(FEET_Y + 2), px(38 + i * 14), px(7 + i * 3));
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
    this.travelSeconds += Math.min(delta, 50) / 1000;
    const atRenderPixel = (speed: number) => (
      Math.round(this.travelSeconds * speed * this.renderScale) / this.renderScale
    );
    this.sky.tilePositionX = atRenderPixel(SCROLL_SPEED.sky);
    this.far.tilePositionX = atRenderPixel(SCROLL_SPEED.far);
    this.mid.tilePositionX = atRenderPixel(SCROLL_SPEED.mid);

    // The atlas owns the stride. Keeping the sprite and shadow on one fixed
    // baseline means every frame meets the same authored walk row.
    this.pet.y = FEET_Y * this.renderScale;
  }
}
