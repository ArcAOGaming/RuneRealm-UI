/** Placeholder top-down Hunt world. Tiled layers can replace drawWorld later. */
import Phaser from 'phaser';
import { Element, Monster } from '../lib/types';
import { FRAME, ROW, rowFrames, sheetUrl, STAND_FRAME } from './assets';
import { reducedMotion } from './boot';

export const HUNT_WORLD = { w: 768, h: 432 } as const;

type Dir = 'up' | 'down' | 'left' | 'right';
type Init = {
  playerSheet: string;
  monsterSprite: string;
  element: Element;
  onTrailReady: () => void;
  onTravel: (travelled: number, target: number) => void;
};

const PLAYER_FRAMES: Record<Dir, number[]> = {
  down: [0, 1, 2, 1], left: [3, 4, 5, 4],
  right: [6, 7, 8, 7], up: [9, 10, 11, 10],
};
const MONSTER_ROW: Record<Dir, number> = {
  right: ROW.walkRight, left: ROW.walkLeft, up: ROW.walkUp, down: ROW.walkDown,
};
const TINT: Record<Element, number> = {
  fire: 0xff7a43, water: 0x4ab0ff, air: 0x7ee2c8, rock: 0xc9a25d,
};

type TrailPoint = { x: number; y: number; facing: Dir };

export class HuntScene extends Phaser.Scene {
  static KEY = 'hunt-world';

  private init_!: Init;
  private player!: Phaser.GameObjects.Sprite;
  private companion!: Phaser.GameObjects.Sprite;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private companionShadow!: Phaser.GameObjects.Ellipse;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private pad = new Set<Dir>();
  private facing: Dir = 'down';
  private trail: TrailPoint[] = [];
  private travelled = 0;
  private target = 540;
  private locked = false;
  private dead = false;
  private lastProgress = 0;

  constructor() { super(HuntScene.KEY); }

  init(data: Init) {
    this.init_ = data;
    this.target = 460 + Math.floor(Math.random() * 300);
  }

  preload() {
    this.load.spritesheet('hunt-player', this.init_.playerSheet, {
      frameWidth: 48, frameHeight: 60,
    });
    this.load.spritesheet('hunt-companion', sheetUrl(this.init_.monsterSprite), {
      frameWidth: FRAME.w, frameHeight: FRAME.h,
    });
  }

  create() {
    this.drawWorld();
    this.createAnimations();

    this.playerShadow = this.add.ellipse(384, 246, 23, 7, 0x07110f, 0.34).setDepth(239);
    this.player = this.add.sprite(384, 246, 'hunt-player', 1)
      .setOrigin(0.5, 1).setDepth(246);
    this.companionShadow = this.add.ellipse(338, 268, 25, 8, 0x07110f, 0.3).setDepth(261);
    this.companion = this.add.sprite(338, 268, 'hunt-companion', STAND_FRAME)
      .setOrigin(0.5, 0.86).setDepth(268);

    for (let i = 0; i < 24; i += 1) {
      this.trail.push({ x: 384 - i * 2, y: 246 + i, facing: 'down' });
    }

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.keys;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.dead = true; });
  }

  private drawWorld() {
    // Ground layer: broad biome shapes, intentionally code-native until the
    // supplied Tiled map replaces this one method.
    const ground = this.add.graphics().setDepth(0);
    ground.fillStyle(0x173c35).fillRect(0, 0, HUNT_WORLD.w, HUNT_WORLD.h);
    ground.fillStyle(0x245746, 1).fillRoundedRect(42, 28, 684, 368, 42);
    ground.fillStyle(0x9b8355, 0.82);
    ground.fillPoints([
      new Phaser.Geom.Point(70, 222), new Phaser.Geom.Point(195, 168),
      new Phaser.Geom.Point(322, 220), new Phaser.Geom.Point(452, 180),
      new Phaser.Geom.Point(694, 238), new Phaser.Geom.Point(668, 292),
      new Phaser.Geom.Point(470, 242), new Phaser.Geom.Point(310, 280),
      new Phaser.Geom.Point(150, 232),
    ], true);
    ground.lineStyle(3, 0xdec58c, 0.18).strokeRoundedRect(42, 28, 684, 368, 42);

    // Water layer, with independent glints so the scene has visible motion
    // even while the player is standing still.
    const water = this.add.graphics().setDepth(1);
    water.fillStyle(0x245a69, 0.95).fillRoundedRect(542, 58, 145, 108, 30);
    water.lineStyle(2, 0x6ab3b5, 0.38).strokeRoundedRect(542, 58, 145, 108, 30);
    for (let i = 0; i < 7; i += 1) {
      const glint = this.add.rectangle(564 + (i % 3) * 42, 78 + Math.floor(i / 3) * 29, 22, 2, 0xa6e0d0, 0.32)
        .setDepth(2);
      this.tweens.add({
        targets: glint, x: glint.x + 9, alpha: { from: 0.12, to: 0.5 },
        duration: 1300 + i * 90, yoyo: true, repeat: -1, delay: i * 120,
      });
    }

    // Foreground/midground layer. Depth follows the base of each object so
    // walking behind a tree hides the character and walking in front does not.
    const trees = [
      [75, 92], [145, 64], [244, 90], [333, 58], [438, 92], [710, 118],
      [92, 365], [188, 388], [286, 352], [486, 375], [606, 354], [700, 338],
    ];
    trees.forEach(([x, y], index) => this.tree(x, y, index));
    [[108, 195], [260, 304], [500, 130], [650, 270]].forEach(([x, y]) => this.rock(x, y));

    // Ambient upper layer: drifting spores establish depth without pretending
    // this placeholder is already a fully authored biome.
    for (let i = 0; i < 22; i += 1) {
      const mote = this.add.rectangle(
        45 + Math.random() * 680, 35 + Math.random() * 350, 2, 2,
        i % 3 === 0 ? TINT[this.init_.element] : 0xd7e9ba, 0.28,
      ).setDepth(900);
      this.tweens.add({
        targets: mote, x: mote.x + 18 + Math.random() * 20, y: mote.y - 10,
        alpha: { from: 0.08, to: 0.5 }, duration: 2400 + Math.random() * 2600,
        yoyo: true, repeat: -1, delay: Math.random() * 1600,
      });
    }
  }

  private tree(x: number, y: number, variant: number) {
    const g = this.add.graphics().setDepth(y);
    g.fillStyle(0x382f29).fillRect(x - 5, y - 31, 10, 33);
    g.fillStyle(0x102d29).fillTriangle(x, y - 78, x - 29, y - 28, x + 29, y - 28);
    g.fillStyle(variant % 2 ? 0x245f45 : 0x1e543e)
      .fillTriangle(x, y - 66, x - 34, y - 18, x + 34, y - 18);
    g.fillStyle(0x4d8255, 0.65).fillTriangle(x - 6, y - 62, x - 26, y - 27, x + 5, y - 27);
  }

  private rock(x: number, y: number) {
    const g = this.add.graphics().setDepth(y);
    g.fillStyle(0x172b2b, 0.3).fillEllipse(x, y + 2, 38, 10);
    g.fillStyle(0x647169).fillPoints([
      new Phaser.Geom.Point(x - 17, y), new Phaser.Geom.Point(x - 11, y - 15),
      new Phaser.Geom.Point(x + 8, y - 20), new Phaser.Geom.Point(x + 19, y - 5),
      new Phaser.Geom.Point(x + 13, y + 2),
    ], true);
    g.fillStyle(0x93a083, 0.55).fillTriangle(x - 10, y - 14, x + 7, y - 18, x - 1, y - 7);
  }

  private createAnimations() {
    (Object.keys(PLAYER_FRAMES) as Dir[]).forEach((dir) => {
      this.anims.create({
        key: `hunter-${dir}`, frameRate: 8, repeat: -1,
        frames: PLAYER_FRAMES[dir].map((frame) => ({ key: 'hunt-player', frame })),
      });
      this.anims.create({
        key: `companion-${dir}`, frameRate: 8, repeat: -1,
        frames: rowFrames(MONSTER_ROW[dir]).map((frame) => ({ key: 'hunt-companion', frame })),
      });
    });
  }

  setPad(dir: Dir, down: boolean) {
    if (down) this.pad.add(dir); else this.pad.delete(dir);
  }

  resumeAfterSearchFailure() {
    this.locked = false;
    this.target = this.travelled + 180;
  }

  update(_time: number, deltaMs: number) {
    if (!this.player || this.dead) return;
    let dx = 0; let dy = 0;
    if (!this.locked) {
      if (this.cursors.left.isDown || this.keys.A.isDown || this.pad.has('left')) dx -= 1;
      if (this.cursors.right.isDown || this.keys.D.isDown || this.pad.has('right')) dx += 1;
      if (this.cursors.up.isDown || this.keys.W.isDown || this.pad.has('up')) dy -= 1;
      if (this.cursors.down.isDown || this.keys.S.isDown || this.pad.has('down')) dy += 1;
    }
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const normal = dx && dy ? Math.SQRT1_2 : 1;
      const distance = Math.min(deltaMs, 50) * 0.105;
      this.player.x = Phaser.Math.Clamp(this.player.x + dx * normal * distance, 52, 716);
      this.player.y = Phaser.Math.Clamp(this.player.y + dy * normal * distance, 72, 394);
      this.travelled += distance;
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
      else this.facing = dy > 0 ? 'down' : 'up';
      this.player.play(`hunter-${this.facing}`, true);
      const last = this.trail[0];
      if (!last || Phaser.Math.Distance.Between(last.x, last.y, this.player.x, this.player.y) > 4) {
        this.trail.unshift({ x: this.player.x, y: this.player.y, facing: this.facing });
        if (this.trail.length > 60) this.trail.pop();
      }
      if (this.travelled - this.lastProgress > 14) {
        this.lastProgress = this.travelled;
        this.init_.onTravel(this.travelled, this.target);
      }
      if (this.travelled >= this.target) {
        this.locked = true;
        this.player.anims.stop();
        this.init_.onTrailReady();
      }
    } else {
      this.player.anims.stop();
      this.player.setFrame(PLAYER_FRAMES[this.facing][1]);
    }

    const follow = this.trail[Math.min(13, this.trail.length - 1)];
    if (follow) {
      const d = Phaser.Math.Distance.Between(this.companion.x, this.companion.y, follow.x, follow.y);
      if (d > 3) {
        const angle = Phaser.Math.Angle.Between(this.companion.x, this.companion.y, follow.x, follow.y);
        this.companion.x += Math.cos(angle) * Math.min(d, deltaMs * 0.085);
        this.companion.y += Math.sin(angle) * Math.min(d, deltaMs * 0.085);
        const dir: Dir = Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle))
          ? (Math.cos(angle) > 0 ? 'right' : 'left')
          : (Math.sin(angle) > 0 ? 'down' : 'up');
        this.companion.play(`companion-${dir}`, true);
      } else {
        this.companion.anims.stop();
        this.companion.setFrame(STAND_FRAME);
      }
    }
    this.syncDepth();
  }

  private syncDepth() {
    this.player.setDepth(this.player.y);
    this.playerShadow.setPosition(this.player.x, this.player.y - 1).setDepth(this.player.y - 1);
    this.companion.setDepth(this.companion.y);
    this.companionShadow.setPosition(this.companion.x, this.companion.y - 2).setDepth(this.companion.y - 1);
  }

  revealEncounter(monster: Monster, done: () => void) {
    if (this.dead) return;
    this.locked = true;
    const key = `wild-${monster.id}`;
    const perform = () => {
      if (this.dead) return;
      const wild = this.add.sprite(this.player.x + 180, this.player.y - 18, key, STAND_FRAME)
        .setOrigin(0.5, 0.86).setDepth(this.player.y + 4).setScale(0.5).setAlpha(0);
      const shadow = this.add.ellipse(wild.x, this.player.y - 3, 26, 8, 0x07110f, 0)
        .setDepth(this.player.y + 3);
      const duration = reducedMotion() ? 1 : 520;
      this.tweens.add({
        targets: wild, x: this.player.x + 54, y: this.player.y - 8,
        scale: 1.18, alpha: 1, angle: -8, duration, ease: 'Back.Out',
        onUpdate: () => shadow.setPosition(wild.x, this.player.y - 3).setAlpha(wild.alpha * 0.34),
        onComplete: () => {
          wild.play({ key: `${key}-attack`, repeat: 0 });
          this.tweens.add({
            targets: wild, x: this.player.x + 24, duration: reducedMotion() ? 1 : 230,
            yoyo: true, ease: 'Quad.In',
            onUpdate: () => shadow.setX(wild.x),
            onYoyo: () => {
              this.cameras.main.shake(reducedMotion() ? 0 : 150, 0.012);
              this.cameras.main.flash(reducedMotion() ? 0 : 140, 210, 241, 213, false);
            },
            onComplete: () => this.time.delayedCall(reducedMotion() ? 1 : 240, done),
          });
        },
      });
    };

    const makeAnim = () => {
      if (!this.anims.exists(`${key}-attack`)) {
        this.anims.create({
          key: `${key}-attack`, frameRate: 12, repeat: 0,
          frames: rowFrames(ROW.emote).map((frame) => ({ key, frame })),
        });
      }
      perform();
    };
    if (this.textures.exists(key)) { makeAnim(); return; }
    this.load.spritesheet(key, sheetUrl(monster.sprite), {
      frameWidth: FRAME.w, frameHeight: FRAME.h,
    });
    this.load.once(Phaser.Loader.Events.COMPLETE, makeAnim);
    this.load.start();
  }
}
