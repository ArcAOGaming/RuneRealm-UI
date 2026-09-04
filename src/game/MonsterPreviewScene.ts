import Phaser from 'phaser';
import { MonsterMotion, MonsterRig, monsterRig } from './MonsterRig';

export type MonsterPreviewInit = {
  entryNo: number;
  sprite?: string;
  onReady?: (motions: MonsterMotion[]) => void;
  onComplete?: (motion: MonsterMotion) => void;
};

/** Small Admin-only stage that exercises the exact production MonsterRig. */
export class MonsterPreviewScene extends Phaser.Scene {
  static readonly KEY = 'monster-preview';

  private init_!: MonsterPreviewInit;
  private rig!: MonsterRig;
  private monster!: Phaser.GameObjects.Sprite;

  constructor() { super(MonsterPreviewScene.KEY); }

  init(data: MonsterPreviewInit) {
    this.init_ = data;
    this.rig = monsterRig({ entryNo: data.entryNo, sprite: data.sprite });
  }

  preload() { this.rig.preload(this, 'preview-monster'); }

  create() {
    const { width, height } = this.scale;
    const background = this.add.graphics();
    background.fillStyle(0x090d16, 1).fillRect(0, 0, width, height);
    background.lineStyle(1, 0xffffff, 0.035);
    for (let x = 0; x <= width; x += 16) background.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += 16) background.lineBetween(0, y, width, y);
    background.fillStyle(0x111b2a, 0.9).fillEllipse(width / 2, height - 28, 150, 34);

    this.rig.register(this, 'preview-monster', 'monster-preview');
    this.rig.createShadow(this, width / 2, height - 30).setDepth(1);
    this.monster = this.rig.createSprite(
      this, 'preview-monster', width / 2, height - 30, 'world', 'idle',
    ).setDepth(2);
    this.rig.hold(this.monster);
    this.init_.onReady?.(this.rig.motions());
  }

  show(motion: MonsterMotion, mode: 'once' | 'times' | 'loop', times = 3) {
    if (!this.monster) return;
    this.monster.setFlipX(false);
    const onComplete = () => {
      this.rig.hold(this.monster);
      this.init_.onComplete?.(motion);
    };
    if (mode === 'loop') this.rig.loop(this.monster, 'monster-preview', motion, { restart: true });
    else if (mode === 'times') {
      this.rig.playTimes(this.monster, 'monster-preview', motion, times, { onComplete });
    } else this.rig.once(this.monster, 'monster-preview', motion, { onComplete });
  }

  pause() { if (this.monster) this.rig.pause(this.monster); }
  resume() { if (this.monster) this.rig.resume(this.monster); }
  stop() { if (this.monster) this.rig.hold(this.monster); }
}
