/**
 * The fight, as something you can watch.
 *
 * The one rule this file exists to enforce: **the process decides, the scene
 * shows.** A round is resolved server-side in one reply — who swung first, what
 * it cost, whether it ended the fight — and every one of those facts is already
 * in the `Turn[]` handed to `playRound`. Nothing here re-derives any of it. The
 * scene walks the turns in the order the process put them in and draws each one
 * to completion before starting the next.
 *
 * Which makes the second rule a consequence of the first: **a number changes
 * only while its animation is playing.** React learns the whole round's outcome
 * the instant the reply lands, and pushing that straight into the bars is what
 * made a killing blow empty the health bar before the attacker had taken a
 * step. So the scene owns the vitals for the whole time it is playing, and any
 * state React pushes meanwhile is parked and reconciled at the end (`setVitals`
 * → `parked`). The parked values are where the animation was going to land
 * anyway; the only thing dropped is the jump.
 *
 * Within one landed hit the order is the game's order too: **shields are eaten
 * before health.** `applyDamage` in battle.lua spends the shield first and only
 * the overflow reaches HP, and the turn carries the two amounts separately —
 * so 14 damage into a 10 shield drains the shield, then takes 4 off health, as
 * two steps you can see rather than one simultaneous drop.
 *
 * The choreography of a turn is: the ATTACKER walks in, swings, the blow lands,
 * and the attacker walks back. Only one creature is ever moving, which is what
 * makes whose turn it is legible without a caption. The walk is kept short by
 * standing the two of them closer (FLOOR_INSET), moving them faster
 * (WALK_SPEED) and stopping short of contact (REACH), rather than by having the
 * defender come to meet them.
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

/**
 * Staging.
 *
 * The fighters used to stand at 15% and 85% of the width — 269 art px apart,
 * which at the old 74px/s was three seconds of walking each way before anything
 * happened, twice a round. Standing closer and moving quicker cuts the travel
 * to about a second without touching the walk cycle's own frame rate, which is
 * tied to WALK_FPS so the legs and the ground still agree.
 */
const FLOOR_INSET = 0.30;   // where a fighter stands, as a fraction of width
const WALK_FPS = 12;
const WALK_SPEED = 120;     // art px per second while closing
/**
 * How close the attacker gets before swinging, in art px.
 *
 * Not as close as it can physically get. The strike is a 128px frame anchored
 * on the ATTACKER and drawn above both fighters, so at 34 it swallowed the
 * defender whole for the half second it played — which looks less like a blow
 * landing than like one of the two creatures vanishing.
 */
const REACH = 44;

/**
 * Every pause in a turn, in one place.
 *
 * A turn is: walk in, swing, the blow lands (shield, then health), walk out.
 * These are the beats between those, and they are the whole reason a round
 * reads as a sequence of events rather than a spreadsheet updating.
 */
const BEAT = {
  /** The shield bar draining. Long enough to see, short enough not to wait. */
  shield: 230,
  /** Then health, after the shield is gone. */
  health: 290,
  /** After the blow, before walking home. */
  afterHit: 130,
  afterMiss: 200,
  afterSupport: 620,
  /** A critical lands, and everything holds for a moment before the bars move. */
  critHold: 200,
  /** The silence before a killing blow's flash. */
  koBeat: 150,
  koSlump: 620,
  /** If a strike animation's completion event never arrives, give up here. */
  swingCap: 1100,
};

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
  /** Set once the fighter has been knocked out, so it is never slumped twice. */
  down: boolean;
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

const other = (s: Side): Side => (s === 'challenger' ? 'accepter' : 'challenger');

/** What a rider is called when it floats off a fighter. */
const RIDER_LABEL: Record<string, string> = {
  attack: 'ATK', defense: 'DEF', speed: 'SPD', health: 'HP',
};

export class BattleScene extends Phaser.Scene {
  static readonly KEY = 'battle';

  private init_!: BattleInit;
  private fighters!: Record<Side, Fighter>;
  private floorY = 0;

  /**
   * The playback queue, owned HERE rather than by the React component.
   *
   * It used to live in a ref in BattleStageImpl while `busy` lived in the
   * scene, and the two could not see each other: a round arriving while another
   * played was silently dropped by the `busy` guard, and a queue left pointing
   * at a torn-down scene never resolved, so the next round never played at all.
   * One owner, one chain, and nothing is dropped.
   */
  private chain: Promise<void> = Promise.resolve();
  /** How many rounds are queued or in flight. Non-zero means "I own the numbers". */
  private playing = 0;
  /** Vitals React pushed while a round was playing, applied once it drains. */
  private parked = new Map<Side, Vitals>();

  private onTrack?: (frames: HudFrame[]) => void;
  private onVitals?: (side: Side, v: Vitals) => void;
  private onImpact?: (side: Side, lethal: boolean) => void;

  /**
   * Everything waiting on a timer or a tween.
   *
   * A scene can be torn down mid-swing — a re-mount, a route change, React's
   * double-effect in development. Every promise in here is resolved on the way
   * out so the queue drains instead of wedging forever behind a callback that
   * will never fire.
   */
  private waiters = new Set<() => void>();
  private dead = false;

  constructor() {
    super(BattleScene.KEY);
  }

  init(data: BattleInit) {
    this.init_ = data;
    this.dead = false;
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
      challenger: this.makeFighter('challenger', youAreChallenger ? 'L' : 'R', youAreChallenger, W),
      accepter: this.makeFighter('accepter', youAreChallenger ? 'R' : 'L', !youAreChallenger, W),
    };

    const release = () => this.teardown();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, release);
    this.events.once(Phaser.Scenes.Events.DESTROY, release);
  }

  /** Resolve everything in flight so a queued round cannot outlive the scene. */
  private teardown() {
    this.dead = true;
    for (const finish of [...this.waiters]) finish();
    this.waiters.clear();
  }

  private makeFighter(side: Side, prefix: 'L' | 'R', onLeft: boolean, W: number): Fighter {
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
      down: false,
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
        frameRate: 16,
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
    if (f.down) return;
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

  // Vitals --------------------------------------------------------------------

  /** Whether the scene currently owns the numbers. */
  private get busy() {
    return this.playing > 0;
  }

  /**
   * Push new vitals in without playing anything — used on load and on reload.
   *
   * While a round is queued or playing the animation owns the numbers, so a
   * push is PARKED rather than dropped. Dropping it was nearly right and
   * occasionally wrong: a PvP poll that replaced the whole battle mid-playback
   * left the bars showing whatever the animation had computed, with no later
   * correction. Parking keeps the authoritative value and applies it the
   * moment the queue drains.
   */
  setVitals(side: Side, v: Vitals) {
    const f = this.fighters?.[side];
    if (!f) return;
    if (this.busy) { this.parked.set(side, v); return; }
    f.vitals = v;
    this.onVitals?.(side, v);
  }

  private flushParked() {
    for (const [side, v] of this.parked) {
      const f = this.fighters?.[side];
      if (!f) continue;
      f.vitals = v;
      this.onVitals?.(side, v);
    }
    this.parked.clear();
  }

  /** Report a fighter's numbers as they stand. */
  private publish(f: Fighter) {
    this.onVitals?.(f.side, { ...f.vitals });
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
   *
   * `impact` fires at the moment a blow actually connects, which is what the
   * page background's shockwave hangs off. It used to hang off the round
   * arriving, so the field rippled while the attacker was still walking.
   */
  bindHud(
    track: (frames: HudFrame[]) => void,
    vitals: (side: Side, v: Vitals) => void,
    impact?: (side: Side, lethal: boolean) => void,
  ) {
    this.onTrack = track;
    this.onVitals = vitals;
    this.onImpact = impact;
    if (this.fighters) {
      for (const side of ['challenger', 'accepter'] as const) {
        vitals(side, { ...this.fighters[side].vitals });
      }
    }
  }

  update() {
    if (!this.fighters || !this.onTrack) return;
    const { width: W, height: H } = this.scale;
    // The shake moves the CAMERA, which moves the art but not the DOM overlay
    // on top of it — so every hit tore the health bars off the monsters for the
    // length of the shake. The effect's offset is in camera pixels, which is
    // art space, so it adds straight onto the sprite position.
    const shake = this.cameras.main.shakeEffect as unknown as
      { isRunning: boolean; _offsetX: number; _offsetY: number };
    const ox = shake?.isRunning ? shake._offsetX : 0;
    const oy = shake?.isRunning ? shake._offsetY : 0;
    // Pinned to the sprite, with nothing held back. An earlier version clamped
    // each bar to its own half of the arena so the two could never touch, and
    // the cost was a bar that stopped following its monster at exactly the
    // moment the monster was doing something — the bars belong ON them, so the
    // head bar is small enough to sit there through the whole swing instead.
    this.onTrack((['challenger', 'accepter'] as const).map((side) => {
      const f = this.fighters[side];
      return {
        side,
        xFrac: (f.sprite.x + ox) / W,
        // Just clear of the top of the sprite. The overlay hangs upward from
        // this point (-translate-y-full), so this is where the BOTTOM of the
        // bar sits: at -46 it lay across the creature's back, and at -68 it
        // floated a body's width above its head.
        yFrac: (this.floorY - 64 + oy) / H,
      };
    }));
  }

  // Playback ------------------------------------------------------------------

  /**
   * Queue a whole round and resolve when it has finished PLAYING.
   *
   * `playing` is incremented synchronously, before any await, so a caller that
   * queues a round and then pushes the post-round state in the same React
   * commit finds the scene already busy. That ordering is the whole fix for a
   * killing blow emptying the bar before the swing.
   */
  playRound(turns: Turn[]): Promise<void> {
    if (!turns.length) return this.chain;
    this.playing += 1;
    this.chain = this.chain
      .then(() => this.runRound(turns))
      // A failed round must not poison the queue for every round after it —
      // but it must not vanish either. Swallowing this silently is what made a
      // round that threw halfway look like a round that merely animated
      // strangely: the fighter stopped where it was and the bars never moved.
      .catch((err) => { console.error('[battle] round failed to play', err); })
      .then(() => {
        this.playing -= 1;
        if (!this.busy) this.flushParked();
      });
    return this.chain;
  }

  /** Resolves once everything queued has been drawn. */
  settled(): Promise<void> {
    return this.chain;
  }

  private async runRound(turns: Turn[]): Promise<void> {
    if (this.dead || !this.fighters) return;
    for (const turn of turns) {
      if (this.dead) return;
      // eslint-disable-next-line no-await-in-loop
      await this.playTurn(turn);
    }
    if (this.dead || !this.fighters) return;
    this.idle(this.fighters.challenger);
    this.idle(this.fighters.accepter);
  }

  /**
   * A promise that resolves on a timer, or immediately if the scene goes away.
   *
   * `this.time.delayedCall` was the old mechanism and it stops with the scene,
   * so a torn-down scene left the queue holding a promise nobody would ever
   * settle. This is wall-clock and registered in `waiters`.
   */
  private wait(ms: number): Promise<void> {
    if (this.dead) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.waiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, reducedMotion() ? 1 : ms);
      this.waiters.add(finish);
    });
  }

  private async playTurn(turn: Turn): Promise<void> {
    const a = this.fighters[turn.attacker];
    const d = this.fighters[other(turn.attacker)];
    if (!a || !d) return;

    /**
     * A killing blow, as the PROCESS recorded it — not as the scene guesses.
     *
     * The defender's post-turn snapshot is taken inside `act()` in battle.lua,
     * immediately after the damage is applied, so health at zero here means
     * this exact swing is the one that ended the fight. That is true whether it
     * was the only turn in the round or the second of two, which is why this is
     * decided per TURN and never per round.
     */
    const lethal = !turn.missed && (turn.defenderState?.healthPoints ?? 1) <= 0;

    // A move that heals or buffs is performed on the spot. Walking across the
    // arena to cast a shield on yourself would be nonsense.
    if (turn.moveType === 'heal' || turn.moveType === 'boost') {
      await this.support(a, turn);
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
      await this.wait(BEAT.afterMiss);
      this.reconcile(a, turn.attackerState);
      this.riders(a, turn);
      await this.retreat(a);
      return;
    }

    // The blow itself: the flinch, the knockback, the number. Instant.
    this.impact(d, a.dir, turn, lethal);

    // The attacker's own riders — a speed buff carried by an attacking move, a
    // self-cost — settle with the swing that carried them.
    this.reconcile(a, turn.attackerState);
    this.riders(a, turn);

    /**
     * Walking home and the bars draining happen TOGETHER.
     *
     * They used to be strictly sequential, and the cost was about two thirds of
     * a second in the middle of every turn where the attacker stood at
     * point-blank range doing nothing while two bars ticked down beside it.
     * The order that actually matters — shield emptied before health — is
     * inside `drain`, and is untouched by starting the walk underneath it.
     *
     * A killing blow is the exception and stays sequential: the attacker has to
     * still be standing over the loser when it goes down.
     */
    if (lethal) {
      await this.drain(d, turn);
      await this.knockout(d);
      await this.wait(BEAT.afterHit);
      await this.retreat(a);
      return;
    }

    const walkingHome = this.wait(BEAT.afterHit).then(() => this.retreat(a));
    await this.drain(d, turn);
    await walkingHome;
  }

  /**
   * A heal or a buff: nobody moves, and the effect is LAYERED over the caster.
   *
   * Neither fighter takes a step — walking across an arena to put a shield on
   * yourself is nonsense — and the caster is not replaced by anything either.
   * It performs its own emote (row 5 of the sheet, the paw-raise) and the
   * effect is drawn over and behind it: the heal strip for a heal, rings rising
   * past it for a buff. Playing the elemental STRIKE here was wrong twice over:
   * it is the attack animation, and it hid the creature the move was happening
   * to behind a 128px frame.
   */
  private async support(a: Fighter, turn: Turn) {
    a.sprite.setFlipX(!a.onLeft);
    a.sprite.play(`${a.prefix}-emote`);

    if (turn.moveType === 'heal') this.mend(a);
    else this.aura(a, turn);

    const before = a.vitals;
    const after = turn.attackerState;
    const gained = (after?.healthPoints ?? before.healthPoints) - before.healthPoints;
    const shielded = (after?.shield ?? before.shield) - before.shield;

    if (gained > 0) this.float(a.sprite.x, this.floorY - 74, `+${gained}`, 0x46c07a);
    else if (shielded > 0) this.float(a.sprite.x, this.floorY - 74, `+${shielded}`, 0x53a8e8);
    else this.float(a.sprite.x, this.floorY - 74, turn.move, 0x46c07a);

    this.reconcile(a, after);
    this.riders(a, turn);
    await this.wait(BEAT.afterSupport);
    this.idle(a);
  }

  /**
   * A buff, as layers rising off the caster.
   *
   * There is no art for this — `assets/fx` has heal strips and the four
   * elemental strikes and nothing else — so it is built from rings, and their
   * depths alternate so some pass BEHIND the creature and some in front. That
   * is what makes it read as something happening around the fighter rather than
   * a decal stuck on top of it.
   *
   * The colour says which stat moved, taken from `statsChanged`, which is the
   * only status channel the process has.
   */
  private aura(f: Fighter, turn: Turn) {
    const changed = turn.statsChanged ?? {};
    const colour = changed.defense ? 0x53a8e8
      : changed.attack ? 0xff7a43
        : changed.speed ? 0x9ad8ff : 0xa78bfa;

    f.sprite.setTint(colour);
    this.time.delayedCall(460, () => { if (!this.dead) f.sprite.clearTint(); });

    for (let i = 0; i < 3; i += 1) {
      const ring = this.add.ellipse(f.sprite.x, this.floorY, 34, 12, 0x000000, 0)
        .setStrokeStyle(2, colour, 0.9)
        // Behind the fighter, then in front, then behind again.
        .setDepth(i % 2 === 0 ? 9 : 21);
      this.tweens.add({
        targets: ring,
        y: this.floorY - 74,
        scaleX: { from: 1.3, to: 0.5 },
        scaleY: { from: 1.3, to: 0.5 },
        alpha: { from: 0.95, to: 0 },
        duration: 560,
        delay: i * 150,
        ease: 'Sine.easeOut',
        onComplete: () => ring.destroy(),
      });
    }
  }

  /**
   * ONE fighter walks: the one whose turn it is.
   *
   * The defender holds its mark. A version of this had both of them close on
   * the centre line and meet there, which halved the travel but read as a
   * cutscene — in a turn-based fight the fighter that is acting is the only
   * thing that should be moving, and the other one standing still is what makes
   * it obvious whose turn it is without a label saying so.
   *
   * The walk is kept short by the staging instead: the marks are close (see
   * FLOOR_INSET) and the attacker stops `REACH` short of the defender rather
   * than on top of it.
   */
  private approach(a: Fighter, d: Fighter): Promise<void> {
    return this.step(a, Math.round(d.sprite.x - a.dir * REACH), a.dir);
  }

  /** One fighter, walking to a mark and facing the way it is going. */
  private step(f: Fighter, x: number, facing: 1 | -1): Promise<void> {
    const distance = Math.abs(x - f.sprite.x);
    if (distance < 2 || this.dead) return Promise.resolve();
    this.walk(f, facing);
    return this.travel(f, x, distance);
  }

  /** Walk back to the mark and settle. A fighter that is down stays down. */
  private retreat(a: Fighter): Promise<void> {
    if (this.dead || a.down) return Promise.resolve();
    const distance = Math.abs(a.home - a.sprite.x);
    if (distance < 2) { this.idle(a); return Promise.resolve(); }
    this.walk(a, -a.dir as 1 | -1);
    return this.travel(a, a.home, distance).then(() => this.idle(a));
  }

  /**
   * One tween along the floor line, guarded so a teardown cannot strand it.
   *
   * Anything already tweening this sprite is killed first. A hit adds a short
   * yoyo knockback that returns the sprite to the x it held when the tween was
   * created, and if a walk starts while that is still in the air the yoyo wins
   * and snaps the fighter backwards mid-stride. One thing moves a fighter at a
   * time.
   */
  private travel(a: Fighter, x: number, distance: number): Promise<void> {
    this.tweens.killTweensOf(a.sprite);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.waiters.delete(finish);
        resolve();
      };
      this.waiters.add(finish);
      this.tweens.add({
        targets: a.sprite,
        x,
        // Duration from distance, so the legs and the ground agree however far
        // apart the two fighters happen to be.
        duration: reducedMotion() ? 1 : (distance / WALK_SPEED) * 1000,
        ease: 'Sine.easeInOut',
        onUpdate: () => { a.shadow.x = a.sprite.x; },
        onComplete: finish,
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
      if (reducedMotion() || this.dead) { resolve(); return; }

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
        clearTimeout(cap);
        this.waiters.delete(finish);
        fx.destroy();
        a.special = undefined;
        a.sprite.setVisible(true);
        // Handed back STANDING. The walk cycle was still looping on the hidden
        // sprite the whole time the strike played, so the attacker reappeared
        // marching on the spot and stayed that way through the knockback, the
        // shield drain and the health drain — most of a second of a creature
        // walking nowhere, right next to the one it had just hit.
        this.idle(a);
        resolve();
      };
      // A safety net: if the scene is torn down mid-swing the completion event
      // never fires, and an unresolved promise would wedge the queue forever.
      const cap = setTimeout(finish, BEAT.swingCap);
      this.waiters.add(finish);
      fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, finish);
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

  // Damage --------------------------------------------------------------------

  /**
   * The moment of contact — everything that happens on one frame.
   *
   * Separate from `drain` so the two can be timed independently: the flinch and
   * the number are instant, the bars take their time, and the attacker can walk
   * home underneath them.
   *
   * Three kinds of blow read differently before you get to the number, which is
   * the point: a CRITICAL is white-hot, loud and slow; a SUPER EFFECTIVE hit is
   * orange and sharp; a RESISTED one is grey, quiet and small. They stack — a
   * critical super-effective hit is both — and each is a fact the process sent,
   * not a guess.
   */
  private impact(d: Fighter, dir: 1 | -1, turn: Turn, lethal: boolean) {
    const damage = turn.healthDamage + turn.shieldDamage;
    const crit = !!turn.critical;
    const weight = crit ? 1.9 : turn.superEffective ? 1.35 : turn.notEffective ? 0.6 : 1;

    d.sprite.setTintFill(crit ? 0xfff2c0 : 0xffffff);
    this.time.delayedCall(crit ? 130 : 70, () => { if (!this.dead) d.sprite.clearTint(); });

    this.tweens.add({
      targets: d.sprite,
      x: d.sprite.x + dir * Math.round((lethal ? 14 : 8) * weight),
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
      onUpdate: () => { d.shadow.x = d.sprite.x; },
    });

    if (!reducedMotion()) {
      // Shake scaled to the blow, so a chip and a critical do not feel alike.
      this.cameras.main.shake(
        Math.round(180 * weight),
        Math.min(0.02, (0.002 + damage * 0.00035) * weight),
      );
      if (crit) this.cameras.main.flash(140, 255, 236, 190);
      this.burst(d, crit, turn.superEffective, turn.notEffective);
    }

    const colour = crit ? 0xffbe4a
      : turn.superEffective ? 0xff7a43
        : turn.notEffective ? 0x9aa4b2 : 0xffffff;
    this.float(d.sprite.x, this.floorY - 74, `-${damage}`, colour, crit ? 18 : 13);
    if (crit) {
      this.float(d.sprite.x, this.floorY - 96, 'CRITICAL', 0xffbe4a, 10);
    }
    if (turn.superEffective) {
      this.float(d.sprite.x, this.floorY - (crit ? 110 : 92), 'super effective', 0xff7a43, 8);
    } else if (turn.notEffective) {
      this.float(d.sprite.x, this.floorY - (crit ? 110 : 92), 'resisted', 0x9aa4b2, 8);
    }
    this.onImpact?.(d.side, lethal);
  }

  /**
   * The bars coming down: shields, then whatever got through them.
   *
   * The two amounts come straight off the turn — `applyDamage` in battle.lua
   * spends the shield first and passes only the overflow to HP — so this is not
   * the client deciding an order, it is the client SHOWING the one the process
   * used. Fourteen into a ten-point shield is a shield bar emptying and then
   * four coming off health, as two beats.
   */
  private async drain(d: Fighter, turn: Turn) {
    // A critical earns a held beat before the bars start moving. Nothing else
    // in a fight stops, so the one thing that does reads as important.
    if (turn.critical) await this.wait(BEAT.critHold);

    // Shields, first.
    if (turn.shieldDamage > 0) {
      d.vitals = {
        ...d.vitals,
        shield: Math.max(0, d.vitals.shield - turn.shieldDamage),
      };
      this.publish(d);
      await this.wait(BEAT.shield);
    }

    // Then whatever got through them.
    if (turn.healthDamage > 0) {
      d.vitals = {
        ...d.vitals,
        healthPoints: Math.max(0, d.vitals.healthPoints - turn.healthDamage),
      };
      this.publish(d);
      await this.wait(BEAT.health);
    }

    // And finally the authority, which also carries anything the two deltas do
    // not — a defence rider's shield cap, a rounding difference. Reconciling
    // against the snapshot means the stepped drain can never drift from the
    // process's numbers.
    this.reconcile(d, turn.defenderState);
  }

  /**
   * The shape of the hit, drawn at the point of contact.
   *
   * A ring says how hard, and its colour says what kind — gold for a critical,
   * orange for a hit the element chart favours, a small grey one for a hit it
   * resists. Without this, "super effective" was an eight-pixel word that had
   * already faded by the time you looked at it.
   */
  private burst(d: Fighter, crit: boolean, strong: boolean, weak: boolean) {
    const colour = crit ? 0xffbe4a : strong ? 0xff7a43 : weak ? 0x9aa4b2 : 0xffffff;
    const reach = crit ? 5.2 : strong ? 3.8 : weak ? 1.9 : 2.8;
    const y = this.floorY - 26;

    const ring = this.add.ellipse(d.sprite.x, y, 14, 8, 0x000000, 0)
      .setStrokeStyle(crit ? 3 : 2, colour, 0.95)
      .setDepth(28);
    this.tweens.add({
      targets: ring,
      scaleX: reach, scaleY: reach * 0.75,
      alpha: { from: 0.95, to: 0 },
      duration: crit ? 420 : 300,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    // A second, faster ring only on a critical — two of them is what separates
    // it from "a big hit" at a glance.
    if (!crit) return;
    const inner = this.add.ellipse(d.sprite.x, y, 10, 6, 0x000000, 0)
      .setStrokeStyle(2, 0xffffff, 0.9)
      .setDepth(29);
    this.tweens.add({
      targets: inner,
      scaleX: 3.4, scaleY: 2.6,
      alpha: { from: 0.9, to: 0 },
      duration: 240,
      ease: 'Cubic.easeOut',
      onComplete: () => inner.destroy(),
    });
  }

  /**
   * A killing blow, given the weight of one.
   *
   * A beat of silence, a white flash over the whole arena, a heavier shake, and
   * then the loser goes down — in that order, and only once the damage that
   * caused it has already been drawn.
   */
  private async knockout(d: Fighter) {
    if (d.down || this.dead) return;
    d.down = true;

    await this.wait(BEAT.koBeat);
    if (this.dead) return;

    if (!reducedMotion()) {
      this.cameras.main.flash(220, 255, 255, 255);
      this.cameras.main.shake(340, 0.017);
    }
    this.float(d.sprite.x, this.floorY - 96, 'K.O.', 0xff5c5c, 16);

    const { width: W, height: H } = this.scale;
    // A ring of light off the point of impact. Cheap, and it makes the last
    // blow of a fight look like the last blow of a fight.
    const ring = this.add.ellipse(d.sprite.x, this.floorY - 24, 12, 6, 0xffffff, 0)
      .setStrokeStyle(2, 0xffd8a8, 0.9)
      .setDepth(40);
    this.tweens.add({
      targets: ring,
      scaleX: W / 8, scaleY: H / 10,
      alpha: { from: 0.9, to: 0 },
      duration: 460,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    this.slump(d);
    await this.wait(BEAT.koSlump);
  }

  /** The loser on the floor. Idempotent — a KO and `finish` both want it. */
  private slump(f: Fighter) {
    f.down = true;
    f.sprite.anims.stop();
    f.sprite.clearTint();
    this.tweens.add({
      targets: f.sprite,
      alpha: 0.35,
      angle: f.dir * -12,
      y: this.floorY + 3,
      duration: 500,
      ease: 'Quad.easeIn',
    });
    this.tweens.add({ targets: f.shadow, alpha: 0.15, duration: 500 });
  }

  /**
   * Adopt an authoritative snapshot, without animating anything.
   *
   * Guarded on the snapshot actually carrying numbers: the dev sandbox
   * fabricates turns with an empty state object, and adopting that wholesale
   * set every bar to `undefined`.
   */
  private reconcile(f: Fighter, state?: Turn['attackerState']) {
    if (!state || typeof state.healthPoints !== 'number') return;
    f.vitals = {
      healthPoints: state.healthPoints,
      maxHealthPoints: state.maxHealthPoints,
      shield: state.shield,
      maxShield: state.maxShield,
      attack: state.attack,
      defense: state.defense,
      speed: state.speed,
    };
    this.publish(f);
  }

  /**
   * Stat riders, spoken over the fighter that took them and then gone.
   *
   * `statsChanged` is the only status channel the process has, and this is what
   * it looks like: `+5 ATK` in green rising off the creature it happened to,
   * `-2 DEF` in red, one line per stat, fading out. It is a MOMENT, not a
   * running total — the plate carries the value the stat is at now and nothing
   * about how it got there, because a permanent tally of the drift next to the
   * current value reads as a sum and is two numbers where one will do.
   *
   * Drawn WITH the move that caused it, not when the reply landed.
   */
  private riders(f: Fighter, turn: Turn) {
    const entries = Object.entries(turn.statsChanged ?? {})
      .filter(([, v]) => typeof v === 'number' && v !== 0) as Array<[string, number]>;
    entries.forEach(([key, value], i) => {
      // Staggered, so three riders off one move are read one after another
      // rather than arriving as a block.
      this.time.delayedCall(i * 130, () => {
        if (this.dead) return;
        this.float(
          f.sprite.x,
          this.floorY - 88 - i * 13,
          `${value > 0 ? '+' : ''}${value} ${RIDER_LABEL[key] ?? key.toUpperCase()}`,
          value > 0 ? 0x4ad295 : 0xff5e69,
          11,
        );
      });
    });
  }

  /** A number that rises off the fighter and fades. */
  private float(x: number, y: number, text: string, colour: number, size = 13) {
    if (this.dead) return;
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

  /**
   * Slump the loser. Called once the fight has finished being WATCHED.
   *
   * A fight that ended on screen has already put the loser down during the
   * killing blow; `down` makes this a no-op in that case. What it is still for
   * is a fight loaded already-decided — a reload after the fact — where there
   * was no blow to watch.
   */
  finish(winner: Side | null) {
    if (!this.fighters || !winner) return;
    const loser = this.fighters[other(winner)];
    if (!loser || loser.down) return;
    this.slump(loser);
  }
}
