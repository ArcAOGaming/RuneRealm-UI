/**
 * The fight, as something you can watch.
 *
 * Before this there was no battle animation at all: two DOM cards holding a
 * static 320x448 portrait squeezed into a 64px box, one 0.4s CSS `translateX`
 * shake fired on BOTH fighters regardless of who was hit, and a ripple in the
 * page background. A round landed and the numbers simply changed.
 *
 * Three things make this different, and none is decoration:
 *
 *  - **The round is PLAYED, not applied.** The process resolves a whole round
 *    at once and returns it — your swing and their answer together. That is
 *    correct for the platform (see Arena.tsx) but it is not how a fight reads:
 *    both fighters losing health on the same frame is a spreadsheet updating.
 *    `playRound` walks the turns in order, so a swing lands, then is answered.
 *  - **A turn is a journey, not a jolt.** The attacker WALKS in on its walk
 *    cycle, swings on its attack row, and walks home; the defender holds still
 *    and takes it. A tween that slides a static frame across the floor and back
 *    is the thing that makes browser games look cheap, and the sheets have had
 *    the frames to avoid it all along.
 *  - **The art already existed.** Rows 4 and 5 of every walk sheet are attack
 *    poses, `animation/doge/doge special <element>.png` is an 8-frame 128x128
 *    strike per element, and `animation/effects/*.png` are 8-frame heal and
 *    revive strips. None of it had ever been drawn on screen.
 *
 * Fighters stand in the bottom corners at the SAME floor height and close on
 * each other along one horizontal line — the rule the arena plates were chosen
 * against, so the ground is under both of them the whole way across.
 */
import Phaser from 'phaser';
import { Element, Turn } from '../lib/types';
import {
  FRAME, HEAL_FRAME, ROW, SPECIAL, SPECIAL_FRAME, STAND_FRAME,
  arenaUrl, fxUrl, rowFrames, sheetUrl,
} from './assets';
import { reducedMotion } from './boot';

export type Side = 'challenger' | 'accepter';

export type Vitals = {
  healthPoints: number; maxHealthPoints: number;
  shield: number; maxShield: number;
  attack: number; defense: number; speed: number;
};

/** The fixed facts a corner panel needs, which no turn ever changes. */
export type Nameplate = {
  name: string; level: number;
  baseAttack: number; baseDefense: number; baseSpeed: number;
};

export type BattleInit = {
  arena: string;
  /** Which side the viewer is, so "you" is always the left-hand fighter. */
  you: Side;
  left: { sprite: string; element: Element } & Vitals & Nameplate;
  right: { sprite: string; element: Element } & Vitals & Nameplate;
};

const FLOOR_INSET = 0.15;   // where a fighter stands, as a fraction of width
const WALK_FPS = 8;
const WALK_SPEED = 74;      // art px per second while closing
/** How close the attacker gets before swinging, in art px. */
const REACH = 40;

type Fighter = {
  side: Side;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  prefix: 'L' | 'R';
  home: number;
  /** +1 faces right (fights rightward), -1 faces left. */
  dir: 1 | -1;
  element: Element;
  vitals: Vitals;
  plate: Nameplate;
  onLeft: boolean;
  /** The 128px strike sprite, shown in place of the walk sprite mid-swing. */
  special?: Phaser.GameObjects.Sprite;
};

/** What the DOM overlay needs each frame to sit on top of the fight. */
export type HudFrame = {
  side: Side;
  /** Position across the canvas, 0..1, so the overlay is resolution-agnostic. */
  xFrac: number;
  /** Top of the head, 0..1 down the canvas. */
  yFrac: number;
};

export class BattleScene extends Phaser.Scene {
  static readonly KEY = 'battle';

  private init_!: BattleInit;
  private fighters!: Record<Side, Fighter>;
  private floorY = 0;
  private busy = false;
  private onTrack?: (frames: HudFrame[]) => void;
  private onVitals?: (side: Side, v: Vitals) => void;

  constructor() {
    super(BattleScene.KEY);
  }

  init(data: BattleInit) {
    this.init_ = data;
  }

  preload() {
    this.load.image('arena', arenaUrl(this.init_.arena));
    this.load.spritesheet('fighterL', sheetUrl(this.init_.left.sprite), {
      frameWidth: FRAME.w, frameHeight: FRAME.h,
    });
    this.load.spritesheet('fighterR', sheetUrl(this.init_.right.sprite), {
      frameWidth: FRAME.w, frameHeight: FRAME.h,
    });
    for (const el of new Set([this.init_.left.element, this.init_.right.element])) {
      this.load.spritesheet(`fx-${el}`, fxUrl(SPECIAL[el]), {
        frameWidth: SPECIAL_FRAME.w, frameHeight: SPECIAL_FRAME.h,
      });
    }
    this.load.spritesheet('fx-heal', fxUrl('medium-heal'), {
      frameWidth: HEAL_FRAME.w, frameHeight: HEAL_FRAME.h,
    });
  }

  create() {
    const { width: W, height: H } = this.scale;
    this.add.image(0, 0, 'arena').setOrigin(0, 0).setDisplaySize(W, H);

    this.floorY = H - 6;
    this.buildAnimations();

    // "You" is always the left-hand fighter, whichever side of the record you
    // happen to be — a fight should not mirror itself depending on who opened
    // the challenge.
    const youAreChallenger = this.init_.you === 'challenger';
    this.fighters = {
      challenger: this.makeFighter(
        'challenger', youAreChallenger ? 'L' : 'R', youAreChallenger ? W : W,
        youAreChallenger, W,
      ),
      accepter: this.makeFighter(
        'accepter', youAreChallenger ? 'R' : 'L', W, !youAreChallenger, W,
      ),
    };
  }

  private makeFighter(
    side: Side, prefix: 'L' | 'R', _w: number, onLeft: boolean, W: number,
  ): Fighter {
    const home = Math.round(onLeft ? W * FLOOR_INSET : W * (1 - FLOOR_INSET));
    const src = prefix === 'L' ? this.init_.left : this.init_.right;

    const shadow = this.add.ellipse(home, this.floorY + 1, 30, 7, 0x000000, 0.36);
    const sprite = this.add.sprite(home, this.floorY, `fighter${prefix}`, 0)
      .setOrigin(0.5, 1)
      .setDepth(10);
    // Row 0 walks right and row 1 walks left, so each starts looking at the
    // other rather than out of the frame.
    sprite.setFrame(rowFrames(onLeft ? ROW.walkRight : ROW.walkLeft)[0]);

    const f: Fighter = {
      side, sprite, shadow, prefix, home, onLeft,
      dir: onLeft ? 1 : -1,
      element: src.element,
      vitals: {
        healthPoints: src.healthPoints, maxHealthPoints: src.maxHealthPoints,
        shield: src.shield, maxShield: src.maxShield,
        attack: src.attack, defense: src.defense, speed: src.speed,
      },
      plate: {
        name: src.name, level: src.level,
        baseAttack: src.baseAttack, baseDefense: src.baseDefense,
        baseSpeed: src.baseSpeed,
      },
    };
    this.idle(f);
    return f;
  }

  private buildAnimations() {
    for (const prefix of ['L', 'R'] as const) {
      for (const [name, row] of Object.entries(ROW)) {
        const key = `${prefix}-${name}`;
        if (this.anims.exists(key)) continue;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(`fighter${prefix}`, {
            frames: rowFrames(row),
          }),
          // Only walking loops. The two standing rows are one-shot emotes.
          frameRate: name === 'idle' || name === 'emote' ? 6 : WALK_FPS,
          repeat: name === 'idle' || name === 'emote' ? 0 : -1,
        });
      }
    }
    for (const el of new Set([this.init_.left.element, this.init_.right.element])) {
      if (this.anims.exists(`strike-${el}`)) continue;
      this.anims.create({
        key: `strike-${el}`,
        frames: this.anims.generateFrameNumbers(`fx-${el}`, {
          start: 0, end: SPECIAL_FRAME.count - 1,
        }),
        frameRate: 14,
        repeat: 0,
      });
    }
    if (!this.anims.exists('mend')) {
      this.anims.create({
        key: 'mend',
        frames: this.anims.generateFrameNumbers('fx-heal', {
          start: 0, end: HEAL_FRAME.count - 1,
        }),
        frameRate: 12,
        repeat: 0,
      });
    }
  }

  /**
   * Standing.
   *
   * Row 4, which is the creature on its feet and not moving them. Playing the
   * WALK row slowly was the bug: it looked like a companion marching on the
   * spot, because that is exactly what it was.
   */
  private idle(f: Fighter) {
    f.sprite.setFlipX(!f.onLeft);
    f.sprite.anims.stop();
    // The neutral frame, held. Looping the standing row played its paw-raise
    // and its shake over and over, which read as a fighter attacking the air
    // between turns.
    f.sprite.setFrame(STAND_FRAME);
  }

  /** Walking, in whichever direction the fighter is currently going. */
  private walk(f: Fighter, towards: 1 | -1) {
    f.sprite.setFlipX(towards === -1);
    f.sprite.play(`${f.prefix}-walkRight`);
    f.sprite.anims.msPerFrame = 1000 / WALK_FPS;
  }

  /** Push new vitals in without playing anything — used on load and on reload. */
  setVitals(side: Side, v: Vitals) {
    const f = this.fighters?.[side];
    if (!f) return;
    // While a round is playing, the ANIMATION owns the numbers.
    //
    // React learns the whole round's result the moment the reply lands, and its
    // "keep the panels honest" effect pushed the final vitals straight in — so
    // the killing blow emptied the opponent's health bar before the attacker
    // had taken a step, while every other round drained it on impact. The
    // pushed values are where the animation is going to end up anyway; the only
    // thing lost by ignoring them here is the jump.
    if (this.busy) return;
    f.vitals = v;
    this.onVitals?.(side, v);
  }

  /**
   * Hand the DOM overlay a way to follow the fight.
   *
   * `track` fires every frame with each fighter's position as a FRACTION of the
   * canvas, so the overlay can place itself without knowing the zoom — and it
   * writes straight to `style`, never through React, because a setState sixty
   * times a second to move a health bar is how the old room ended up re-fetching
   * on every frame.
   *
   * `vitals` fires only when a number actually changes, which is a few times a
   * round, and that one IS worth a render.
   */
  bindHud(
    track: (frames: HudFrame[]) => void,
    vitals: (side: Side, v: Vitals) => void,
  ) {
    this.onTrack = track;
    this.onVitals = vitals;
    if (this.fighters) {
      for (const side of ['challenger', 'accepter'] as const) {
        vitals(side, this.fighters[side].vitals);
      }
    }
  }

  update() {
    if (!this.fighters || !this.onTrack) return;
    const { width: W, height: H } = this.scale;
    this.onTrack((['challenger', 'accepter'] as const).map((side) => {
      const f = this.fighters[side];
      return {
        side,
        xFrac: f.sprite.x / W,
        // Clear of the top of the sprite, not level with its head. The
        // overlay hangs upward from this point (-translate-y-full), so this is
        // where the BOTTOM of the bar sits; at -46 it lay across the
        // creature's back.
        yFrac: (this.floorY - 68) / H,
      };
    }));
  }

  /**
   * Play a whole round, in order, and resolve when it has finished.
   *
   * Sequential on purpose: the process hands back the attacker's swing and the
   * defender's answer in one reply, and playing them at once is what makes a
   * turn-based fight look like a spreadsheet.
   */
  async playRound(turns: Turn[]): Promise<void> {
    if (this.busy || !this.fighters) return;
    this.busy = true;
    try {
      for (const turn of turns) {
        // eslint-disable-next-line no-await-in-loop
        await this.playTurn(turn);
      }
    } finally {
      this.busy = false;
      if (this.fighters) {
        this.idle(this.fighters.challenger);
        this.idle(this.fighters.accepter);
      }
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.time.delayedCall(reducedMotion() ? 1 : ms, () => resolve());
    });
  }

  private async playTurn(turn: Turn): Promise<void> {
    const a = this.fighters[turn.attacker];
    const d = this.fighters[turn.attacker === 'challenger' ? 'accepter' : 'challenger'];
    if (!a || !d) return;

    // A move that heals or buffs is performed on the spot. Walking across the
    // arena to cast a shield on yourself would be nonsense.
    const supportive = turn.moveType === 'heal' || turn.moveType === 'boost';

    if (supportive) {
      await this.swing(a);
      this.mend(a);
      const gained = (turn.attackerState?.healthPoints ?? 0) - a.vitals.healthPoints;
      this.float(a.sprite.x, this.floorY - 74,
        gained > 0 ? `+${gained}` : turn.move, 0x46c07a);
      this.applyState(a, turn.attackerState);
      await this.wait(360);
      return;
    }

    await this.approach(a, d);
    await this.swing(a);

    if (turn.missed) {
      this.float(d.sprite.x, this.floorY - 74, 'miss', 0x9aa4b2);
      // A dodge, not a stumble: the defender slips back and comes straight home.
      this.tweens.add({
        targets: d.sprite,
        x: d.sprite.x + d.dir * -10,
        duration: 110,
        yoyo: true,
        ease: 'Quad.easeOut',
        onUpdate: () => { d.shadow.x = d.sprite.x; },
      });
    } else {
      this.hit(d, a.dir, turn);
    }

    this.applyState(a, turn.attackerState);
    this.applyState(d, turn.defenderState);

    await this.wait(300);
    await this.retreat(a);
  }

  /** Walk the attacker in until it is within reach of the defender. */
  private approach(a: Fighter, d: Fighter): Promise<void> {
    const target = d.sprite.x - a.dir * REACH;
    const distance = Math.abs(target - a.sprite.x);
    if (distance < 2) return Promise.resolve();

    this.walk(a, a.dir);

    return new Promise((resolve) => {
      this.tweens.add({
        targets: a.sprite,
        x: target,
        // Duration from distance, so the legs and the ground agree however far
        // apart the two fighters happen to be.
        duration: reducedMotion() ? 1 : (distance / WALK_SPEED) * 1000,
        ease: 'Sine.easeInOut',
        onUpdate: () => { a.shadow.x = a.sprite.x; },
        onComplete: () => resolve(),
      });
    });
  }

  /**
   * The swing: the 128x128 element strip, in place of the walk sprite.
   *
   * The strip is the whole creature performing the move, so the 64px sprite is
   * hidden for its duration and a 128px one takes its place on the same
   * baseline. Anchored bottom-centre, so however much bigger the strike frames
   * are, the feet stay on the same floor line.
   */
  private swing(a: Fighter): Promise<void> {
    return new Promise((resolve) => {
      if (reducedMotion()) { resolve(); return; }

      const fx = this.add.sprite(a.sprite.x, this.floorY, `fx-${a.element}`)
        .setOrigin(0.5, 1)
        .setFlipX(!a.onLeft)
        .setDepth(11);
      a.special = fx;
      a.sprite.setVisible(false);
      fx.play(`strike-${a.element}`);

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        fx.destroy();
        a.special = undefined;
        a.sprite.setVisible(true);
        resolve();
      };
      fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, finish);
      // A safety net: if the scene is torn down mid-swing the event never
      // fires, and an un-resolved promise would wedge `playRound` forever.
      this.time.delayedCall(1200, finish);
    });
  }

  /** Walk back to the mark and settle. */
  private retreat(a: Fighter): Promise<void> {
    this.walk(a, -a.dir as 1 | -1);
    const distance = Math.abs(a.home - a.sprite.x);

    return new Promise((resolve) => {
      this.tweens.add({
        targets: a.sprite,
        x: a.home,
        duration: reducedMotion() ? 1 : (distance / WALK_SPEED) * 1000,
        ease: 'Sine.easeInOut',
        onUpdate: () => { a.shadow.x = a.sprite.x; },
        onComplete: () => { this.idle(a); resolve(); },
      });
    });
  }

  /** The heal/revive strip, over the fighter that cast it. */
  private mend(a: Fighter) {
    const fx = this.add.sprite(a.sprite.x, this.floorY - 26, 'fx-heal')
      .setOrigin(0.5, 0.5)
      .setDepth(20);
    fx.play('mend');
    fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.destroy());
  }

  /** What being hit looks like: knocked back, flashed white, and a number. */
  private hit(d: Fighter, dir: 1 | -1, turn: Turn) {
    const damage = turn.healthDamage + turn.shieldDamage;

    d.sprite.setTintFill(0xffffff);
    this.time.delayedCall(70, () => d.sprite.clearTint());

    this.tweens.add({
      targets: d.sprite,
      x: d.sprite.x + dir * 8,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
      onUpdate: () => { d.shadow.x = d.sprite.x; },
    });

    if (!reducedMotion()) {
      // Shake scaled to the blow, so a chip and a critical do not feel alike.
      this.cameras.main.shake(180, Math.min(0.012, 0.002 + damage * 0.00035));
    }

    const colour = turn.superEffective ? 0xff7a43
      : turn.notEffective ? 0x9aa4b2 : 0xffffff;
    this.float(d.sprite.x, this.floorY - 74, `-${damage}`, colour);
    if (turn.superEffective) {
      this.float(d.sprite.x, this.floorY - 92, 'super effective', 0xff7a43, 8);
    }
  }

  private applyState(f: Fighter, state?: Turn['attackerState']) {
    if (!state) return;
    f.vitals = {
      healthPoints: state.healthPoints,
      maxHealthPoints: state.maxHealthPoints,
      shield: state.shield,
      maxShield: state.maxShield,
      attack: state.attack,
      defense: state.defense,
      speed: state.speed,
    };
    this.onVitals?.(f.side, f.vitals);
  }

  /** A number that rises off the fighter and fades. */
  private float(x: number, y: number, text: string, colour: number, size = 13) {
    const label = this.add.text(x, y, text, {
      fontFamily: 'monospace',
      fontSize: `${size}px`,
      color: `#${colour.toString(16).padStart(6, '0')}`,
    })
      .setOrigin(0.5, 1)
      .setDepth(30)
      // A hard stroke rather than a drop shadow: the label has to stay readable
      // over a dark cave and a bright desert without either a halo or a blur.
      .setStroke('#05070c', 4)
      .setResolution(2);

    this.tweens.add({
      targets: label,
      y: y - 22,
      alpha: { from: 1, to: 0 },
      duration: 900,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  /** Slump the loser. Called once when the fight ends. */
  finish(winner: Side | null) {
    if (!this.fighters || !winner) return;
    const loser = this.fighters[winner === 'challenger' ? 'accepter' : 'challenger'];
    if (!loser) return;
    loser.sprite.anims.stop();
    this.tweens.add({
      targets: loser.sprite,
      alpha: 0.35,
      angle: loser.dir * -12,
      y: this.floorY + 3,
      duration: 500,
      ease: 'Quad.easeIn',
    });
  }
}
