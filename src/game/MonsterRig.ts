/**
 * One file-driven monster visual used by every Phaser scene.
 *
 * A numbered catalog entry resolves to one packed PNG plus atlas JSON. The
 * JSON owns frame rectangles, semantic clips, frame rates, pivots, scale,
 * shadow, impact timing, and attack reach. Scenes ask this object to walk left
 * or perform an advanced attack; they never know a row number or cell size.
 *
 * The legacy grid fallback exists only for records from a process deployed
 * before numbered entries. It presents the same semantic API.
 */
import Phaser from 'phaser';
import { Affinity } from '../lib/types';
import {
  monsterDefinition, MonsterDefinition, MonsterIndexAtlas, MonsterIndexClip, MonsterIndexRender,
} from '../lib/monster-index';
import { FRAME, sheetUrl } from './assets';

export type CoreMonsterMotion =
  | 'idle' | 'emote'
  | 'walk.right' | 'walk.left' | 'walk.up' | 'walk.down'
  | 'attack.basic' | 'attack.advanced';
/** Core motions plus entry-specific clips such as a second legendary attack. */
export type MonsterMotion = CoreMonsterMotion | (string & {});

export const CORE_MONSTER_MOTIONS: readonly CoreMonsterMotion[] = [
  'idle', 'emote', 'walk.right', 'walk.left', 'walk.up', 'walk.down',
  'attack.basic', 'attack.advanced',
];

export type MonsterVisualSource = {
  entryNo?: number;
  sprite?: string;
  name?: string;
  elementType?: Affinity;
};

export type MonsterContext = 'world' | 'battle';

/**
 * Playback is expressed in total passes, because "play this three times" is
 * much easier to reason about than Phaser's "repeat twice after the first".
 * Omitting `times` keeps the repeat rule authored in the atlas JSON.
 */
export type MonsterPlayOptions = {
  times?: number | 'forever';
  restart?: boolean;
  frameRate?: number;
  duration?: number;
  delay?: number;
  repeatDelay?: number;
  yoyo?: boolean;
  startFrame?: number;
  timeScale?: number;
  randomFrame?: boolean;
  onComplete?: () => void;
};

const DEFAULT_RENDER: MonsterIndexRender = {
  origin: { x: 0.5, y: 1 },
  worldScale: 1,
  battleScale: 1,
  shadow: { width: 30, height: 7, offsetY: 1 },
  attackReach: 44,
};

type LegacyMotion = Exclude<CoreMonsterMotion, 'attack.advanced'>;
type LegacyRows = Record<'idle' | 'emote' | 'basic' | 'right' | 'left' | 'up' | 'down', number>;

const FIRE_LEGACY_SPRITE = 'wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ';
const FIRE_ROWS: LegacyRows = { idle: 0, emote: 0, basic: 1, down: 2, up: 3, left: 4, right: 5 };
const DOG_ROWS: LegacyRows = { right: 0, left: 1, up: 2, down: 3, basic: 4, idle: 5, emote: 5 };
const rowFrames = (row: number) => [0, 1, 2, 3].map((index) => row * 4 + index);

function legacyClips(sprite: string): Record<LegacyMotion, MonsterIndexClip> {
  const rows = sprite === FIRE_LEGACY_SPRITE ? FIRE_ROWS : DOG_ROWS;
  return {
    idle: { frames: [String(rows.idle * 4)], frameRate: 1, repeat: -1 },
    emote: { frames: rowFrames(rows.emote).map(String), frameRate: 6, repeat: 0 },
    'walk.right': { frames: rowFrames(rows.right).map(String), frameRate: 8, repeat: -1 },
    'walk.left': { frames: rowFrames(rows.left).map(String), frameRate: 8, repeat: -1 },
    'walk.up': { frames: rowFrames(rows.up).map(String), frameRate: 8, repeat: -1 },
    'walk.down': { frames: rowFrames(rows.down).map(String), frameRate: 8, repeat: -1 },
    'attack.basic': { frames: rowFrames(rows.basic).map(String), frameRate: 12, repeat: 0 },
  };
}

export class MonsterRig {
  private readonly completions = new WeakMap<Phaser.GameObjects.Sprite, {
    event: string; listener: () => void;
  }>();

  readonly definition?: MonsterDefinition;
  readonly entryNo?: number;
  readonly atlas?: MonsterIndexAtlas;
  readonly render: MonsterIndexRender;
  readonly sprite: string;
  readonly textureUrl?: string;
  readonly atlasUrl?: string;
  readonly portraitUrl?: string;
  private readonly legacy: Record<LegacyMotion, MonsterIndexClip>;

  constructor(source: MonsterVisualSource) {
    this.definition = source.entryNo
      ? monsterDefinition(source.entryNo)
      : source.name && source.elementType
        ? monsterDefinition({ entryNo: source.entryNo, name: source.name, elementType: source.elementType })
        : undefined;
    this.entryNo = this.definition?.entryNo ?? source.entryNo;
    const art = this.definition?.art;
    this.atlas = art?.atlasData;
    this.render = art?.atlasData.runerealm.render ?? DEFAULT_RENDER;
    this.sprite = source.sprite ?? '';
    this.legacy = legacyClips(this.sprite);
    this.textureUrl = art?.atlas;
    this.atlasUrl = art?.atlasUrl;
    this.portraitUrl = art?.portrait;
  }

  get packed() { return Boolean(this.atlas); }

  preload(scene: Phaser.Scene, textureKey: string) {
    if (this.textureUrl && this.atlasUrl) scene.load.atlas(textureKey, this.textureUrl, this.atlasUrl);
    else scene.load.spritesheet(textureKey, sheetUrl(this.sprite), {
      frameWidth: FRAME.w, frameHeight: FRAME.h,
    });
  }

  clip(motion: MonsterMotion): MonsterIndexClip | undefined {
    const packed = this.atlas?.runerealm.clips[motion];
    if (packed) return packed;
    return motion in this.legacy ? this.legacy[motion as LegacyMotion] : undefined;
  }

  has(motion: MonsterMotion) { return Boolean(this.clip(motion)?.frames.length); }

  /** Every semantic clip the current monster can actually play. */
  motions(): MonsterMotion[] {
    return [...new Set([
      ...CORE_MONSTER_MOTIONS,
      ...Object.keys(this.atlas?.runerealm.clips ?? {}),
    ])].filter((motion) => this.has(motion));
  }

  frame(motion: MonsterMotion, index = 0): string | number {
    const frames = this.clip(motion)?.frames ?? [];
    const value = frames[Math.max(0, Math.min(index, frames.length - 1))];
    if (this.packed) return value ?? this.atlas?.runerealm.clips.idle?.frames[0] ?? 0;
    return Number(value ?? this.legacy.idle.frames[0] ?? 0);
  }

  key(namespace: string, motion: MonsterMotion) {
    return `${namespace}-${motion.replaceAll('.', '-')}`;
  }

  private clearCompletion(sprite: Phaser.GameObjects.Sprite) {
    const pending = this.completions.get(sprite);
    if (!pending) return;
    sprite.off(pending.event, pending.listener);
    this.completions.delete(sprite);
  }

  register(scene: Phaser.Scene, textureKey: string, namespace: string) {
    for (const motion of this.motions()) {
      const clip = this.clip(motion);
      const key = this.key(namespace, motion);
      if (!clip?.frames.length || scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frames: clip.frames.map((frame) => ({
          key: textureKey,
          frame: this.packed ? frame : Number(frame),
        })),
        frameRate: clip.frameRate,
        repeat: clip.repeat,
      });
    }
  }

  createSprite(
    scene: Phaser.Scene, textureKey: string, x: number, y: number,
    context: MonsterContext = 'world', motion: MonsterMotion = 'idle',
  ) {
    const sprite = scene.add.sprite(x, y, textureKey, this.frame(motion));
    this.apply(sprite, context);
    return sprite;
  }

  apply(sprite: Phaser.GameObjects.Sprite, context: MonsterContext) {
    sprite.setOrigin(this.render.origin.x, this.render.origin.y);
    sprite.setScale(context === 'battle' ? this.render.battleScale : this.render.worldScale);
    return sprite;
  }

  /** Play with atlas defaults, or override timing/repetition for this call. */
  play(
    sprite: Phaser.GameObjects.Sprite, namespace: string, motion: MonsterMotion,
    options: MonsterPlayOptions = {},
  ) {
    const key = this.key(namespace, motion);
    const clip = this.clip(motion);
    if (!clip?.frames.length) {
      options.onComplete?.();
      return false;
    }
    const { times, restart = false, onComplete, ...playback } = options;
    const alreadyPlaying = sprite.anims.currentAnim?.key === key && sprite.anims.isPlaying;
    if (alreadyPlaying && !restart) return true;

    this.clearCompletion(sprite);

    const repeat = times === 'forever'
      ? -1
      : typeof times === 'number'
        ? Math.max(1, Number.isFinite(times) ? Math.floor(times) : 1) - 1
        : clip.repeat;
    if (onComplete) {
      const event = Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + key;
      const listener = () => {
        this.completions.delete(sprite);
        onComplete();
      };
      this.completions.set(sprite, { event, listener });
      sprite.once(event, listener);
    }
    // Do not pass `true` as Phaser's second argument: it means
    // ignore-if-playing, not restart. Calling play again is the restart.
    sprite.play({ key, repeat, ...playback });
    return true;
  }

  /** Play exactly once from the first frame. */
  once(
    sprite: Phaser.GameObjects.Sprite, namespace: string, motion: MonsterMotion,
    options: Omit<MonsterPlayOptions, 'times'> = {},
  ) {
    return this.play(sprite, namespace, motion, { ...options, times: 1, restart: options.restart ?? true });
  }

  /** Loop until `stop` is called or another motion replaces it. */
  loop(
    sprite: Phaser.GameObjects.Sprite, namespace: string, motion: MonsterMotion,
    options: Omit<MonsterPlayOptions, 'times'> = {},
  ) {
    return this.play(sprite, namespace, motion, { ...options, times: 'forever' });
  }

  /** Play an exact number of complete passes. */
  playTimes(
    sprite: Phaser.GameObjects.Sprite, namespace: string, motion: MonsterMotion, times: number,
    options: Omit<MonsterPlayOptions, 'times'> = {},
  ) {
    return this.play(sprite, namespace, motion, {
      ...options, times, restart: options.restart ?? true,
    });
  }

  /** Stop immediately and optionally settle on a semantic pose. */
  stop(sprite: Phaser.GameObjects.Sprite, pose: MonsterMotion | null = 'idle', frame = 0) {
    this.clearCompletion(sprite);
    sprite.anims.stop();
    if (pose && this.has(pose)) sprite.setFrame(this.frame(pose, frame));
    return sprite;
  }

  pause(sprite: Phaser.GameObjects.Sprite) { sprite.anims.pause(); return sprite; }
  resume(sprite: Phaser.GameObjects.Sprite) { sprite.anims.resume(); return sprite; }

  isPlaying(sprite: Phaser.GameObjects.Sprite, namespace: string, motion: MonsterMotion) {
    return sprite.anims.isPlaying && sprite.anims.currentAnim?.key === this.key(namespace, motion);
  }

  hold(sprite: Phaser.GameObjects.Sprite, facing?: 'left' | 'right' | 'up' | 'down') {
    this.stop(sprite, null);
    if (facing) {
      const motion = `walk.${facing}` as MonsterMotion;
      if (this.has(motion)) {
        sprite.setFrame(this.frame(motion));
        sprite.setFlipX(false);
        return;
      }
    }
    sprite.setFrame(this.frame('idle')).setFlipX(false);
  }

  createShadow(scene: Phaser.Scene, x: number, y: number, color = 0x000000, alpha = 0.34) {
    return scene.add.ellipse(
      x, y + this.render.shadow.offsetY,
      this.render.shadow.width, this.render.shadow.height, color, alpha,
    );
  }
}

export const monsterRig = (source: MonsterVisualSource) => new MonsterRig(source);
