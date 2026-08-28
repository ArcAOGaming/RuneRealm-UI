/**
 * The arena floor, above the fighter cards.
 *
 * The cards keep the numbers — health, shield, the stat drift — because a bar
 * is a better readout than a sprite. What they were doing badly was being the
 * ONLY thing on screen: a round landed, both cards shook (both of them, always,
 * whoever was actually hit), and the numbers changed. This is the part that
 * shows what happened.
 *
 * React owns the battle record; the scene owns the animation. The bridge is one
 * effect: when `battle.round` advances, hand the new turns to the scene and let
 * it play them. Nothing here re-renders per frame.
 */
import { useEffect, useRef, useState } from 'react';
import { pct } from '../lib/format';
import { Battle, Combatant } from '../lib/types';
import { cx } from './primitives';
import { mountGame, Mounted } from '../game/boot';
import { BattleScene, HudFrame, Side, Vitals } from '../game/BattleScene';
import { arenaFor, arenaUrl } from '../game/assets';

const BASE_W = 384;
const BASE_H = 216;

/**
 * The walk sheet a combatant fights with.
 *
 * `Combatant.sprite` is optional on the record — a house opponent has no
 * wallet and may arrive without one — so fall back to the other fighter's, and
 * finally to whatever bundled. A missing sheet must not blank the stage.
 */
const FALLBACK = 'wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ';

const vitals = (c: Combatant): Vitals => ({
  healthPoints: c.healthPoints, maxHealthPoints: c.maxHealthPoints,
  shield: c.shield, maxShield: c.maxShield,
  attack: c.attack, defense: c.defense, speed: c.speed,
});

/** Everything the scene's corner panel needs about one fighter. */
const side = (c: Combatant) => ({
  ...vitals(c),
  element: c.elementType,
  // A bot opponent is a trainer, not "the house" — it gets a name of its own
  // the day one is rendered, and the panel already has the room for it.
  name: c.name || (c.address === 'bot' ? 'Trainer' : 'Rival'),
  level: c.level,
  baseAttack: c.baseAttack, baseDefense: c.baseDefense, baseSpeed: c.baseSpeed,
});

export default function BattleStageImpl({
  battle, me, them, className, fill, bare, onSettled,
}: {
  battle: Battle; me: Combatant; them: Combatant; className?: string;
  /** Take height from the flex parent rather than the 16:9 aspect ratio. */
  fill?: boolean;
  /** Scene only — no corner plates. For the companion screen's glance at it. */
  bare?: boolean;
  /** Fires once the last round has finished PLAYING, not when it resolved. */
  onSettled?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // One node per fighter, moved by direct style writes from the scene's frame
  // callback. Never through React: a setState 60 times a second to slide a
  // health bar is the thing this rewrite exists to stop doing.
  const trackRefs = useRef<Record<Side, HTMLDivElement | null>>({
    challenger: null, accepter: null,
  });
  const [vits, setVits] = useState<Record<Side, Vitals | null>>({
    challenger: null, accepter: null,
  });
  const mountedRef = useRef<Mounted | null>(null);
  const lastRound = useRef(battle.round);
  // The tail of the animation queue. Rounds chain onto it so a fight that
  // ends on the round being played does not race it.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [ready, setReady] = useState(false);

  // Deterministic on the battle id, so both players see the same room and a
  // reload does not teleport the fight somewhere else mid-round.
  const arena = arenaFor(battle.id, me.elementType);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !arenaUrl(arena)) return undefined;

    const mounted = mountGame(host, BASE_W, BASE_H, [BattleScene], {
      maxZoom: 4,
      onScale: () => setReady(true),
    });
    mounted.game.scene.start(BattleScene.KEY, {
      arena,
      you: me.side,
      left: { ...side(me), sprite: me.sprite || FALLBACK },
      right: { ...side(them), sprite: them.sprite || me.sprite || FALLBACK },
    });
    mountedRef.current = mounted;

    // Bind once `create()` has run, which is a tick after `start()`.
    let retry = 0;
    const bind = () => {
      const scene = mounted.scene<BattleScene>(BattleScene.KEY);
      if (!scene) {
        if (retry++ < 50) retry = window.setTimeout(bind, 60) && retry;
        return;
      }
      scene.bindHud(
        (frames: HudFrame[]) => {
          for (const fr of frames) {
            const el = trackRefs.current[fr.side];
            if (!el) continue;
            el.style.left = `${fr.xFrac * 100}%`;
            el.style.top = `${fr.yFrac * 100}%`;
          }
        },
        (sd, v) => setVits((prev) => ({ ...prev, [sd]: v })),
      );
    };
    bind();

    return () => {
      mountedRef.current = null;
      mounted.destroy();
    };
    // Deliberately NOT keyed on the round: rebuilding the scene every round
    // would reload every texture and restart the fight's staging mid-fight.
  }, [arena, me.side, me.sprite, me.elementType, them.sprite, them.elementType]);

  // Keep the in-scene panels honest when nothing animated: a reload lands
  // mid-fight with health already spent, and a PvP poll can replace the whole
  // battle without a round of ours to play.
  useEffect(() => {
    const scene = mountedRef.current?.scene<BattleScene>(BattleScene.KEY);
    if (!scene) return;
    scene.setVitals(me.side, vitals(me));
    scene.setVitals(them.side, vitals(them));
  }, [me, them]);

  // Play each new round as it lands.
  useEffect(() => {
    if (battle.round === lastRound.current) return;
    lastRound.current = battle.round;
    const scene = mountedRef.current?.scene<BattleScene>(BattleScene.KEY);
    if (!scene) return;
    // Only this round's turns. `battle.turns` is the whole fight's log, and
    // replaying it from the top on every round would take longer each time.
    const turns = battle.turns.filter((t) => t.round === battle.round);
    queue.current = queue.current.then(() => scene.playRound(turns));
  }, [battle.round, battle.turns]);

  /**
   * The slump, and the all-clear — both AFTER the fight has finished playing.
   *
   * The process decides the whole round at once, so the reply that lands the
   * killing blow also says the battle is over. Reacting to that directly put
   * the victory panel on screen while the winning move was still walking
   * across the arena: you were told you had won, and then watched the swing
   * that did it. The result is known early on purpose — it must not be SHOWN
   * early.
   *
   * So this waits on the animation queue rather than on the status. A fight
   * loaded already-ended (a reload after the fact) has an empty queue and
   * settles immediately, which is right: there is nothing left to watch.
   */
  useEffect(() => {
    if (battle.status !== 'ended') return undefined;
    let cancelled = false;
    queue.current = queue.current.then(() => {
      if (cancelled) return;
      mountedRef.current?.scene<BattleScene>(BattleScene.KEY)?.finish(battle.winner ?? null);
      onSettled?.();
    });
    return () => { cancelled = true; };
  }, [battle.status, battle.winner, onSettled]);

  if (!arenaUrl(arena)) return null;

  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-[3px] border border-rune/12 bg-void/60',
        fill && 'flex min-h-0 flex-col',
        className,
      )}
    >
      <div
        ref={hostRef}
        className={cx('grid w-full place-items-center', fill && 'min-h-0 flex-1')}
        style={fill ? undefined : { aspectRatio: `${BASE_W} / ${BASE_H}` }}
        aria-label={`${me.name} against ${them.name}`}
        role="img"
      />

      {/* The readouts live in the DOM, over the canvas, not inside it.
          In-scene text is drawn into a 384px-wide buffer and then blown up with
          the rest of the art, so an 8px label reaches the screen as a handful
          of fat pixels — legible only by accident. Out here it renders at the
          display's own resolution and stays sharp at any zoom, while the fight
          underneath keeps its pixel grid. */}
      <div className="pointer-events-none absolute inset-0">
        {!bare && <Plate at="left" c={me} v={vits[me.side]} you />}
        {!bare && <Plate at="right" c={them} v={vits[them.side]} />}

        {[me, them].map((c) => (
          <div
            key={c.side}
            ref={(el) => { trackRefs.current[c.side] = el; }}
            className="absolute -translate-x-1/2 -translate-y-full"
          >
            <HeadBar v={vits[c.side]} c={c} />
          </div>
        ))}
      </div>

      {!ready && <div className="absolute inset-0 animate-pulse bg-raised/40" />}
    </div>
  );
}

/**
 * The corner readout: who, how hurt, and how far their stats have drifted.
 *
 * Stat drift IS the status-effect display — `statsChanged` is the only such
 * channel the process has, so a green +2 next to A is a buff and a red -2 is a
 * debuff. Nothing here is invented.
 */
function Plate({
  at, c, v, you,
}: { at: 'left' | 'right'; c: Combatant; v: Vitals | null; you?: boolean }) {
  // Fall back to the record until the scene has reported once, so the panel is
  // never blank on the first frame of a fight.
  const cur = v ?? {
    healthPoints: c.healthPoints, maxHealthPoints: c.maxHealthPoints,
    shield: c.shield, maxShield: c.maxShield,
    attack: c.attack, defense: c.defense, speed: c.speed,
  };
  const hp = pct(cur.healthPoints, cur.maxHealthPoints);
  const sh = pct(cur.shield, cur.maxShield);

  return (
    <div
      className={cx(
        'absolute top-2 w-[42%] max-w-[190px] rounded-[3px] border border-rune/15',
        'bg-void/75 px-2 py-1.5 backdrop-blur-sm',
        at === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium leading-none">
          {you ? 'You' : c.address === 'bot' ? 'Trainer' : c.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] leading-none text-faint">
          lv{c.level}
        </span>
      </div>

      {/* Shield above health: it is the layer spent first, so it reads as the
          outer skin over the health underneath it. */}
      {cur.maxShield > 0 && (
        <Meter
          className="mt-1.5" fill="bg-tide" value={sh}
          label={`${cur.shield}/${cur.maxShield}`}
        />
      )}
      <Meter
        className="mt-1"
        fill={hp > 50 ? 'bg-good' : hp > 25 ? 'bg-warn' : 'bg-bad'}
        value={hp}
        label={`${cur.healthPoints}/${cur.maxHealthPoints}`}
        emphasise={hp <= 25}
      />

      <div className="mt-1.5 flex gap-2 font-mono text-[10px] leading-none text-muted">
        <Stat k="A" now={cur.attack} base={c.baseAttack} />
        <Stat k="D" now={cur.defense} base={c.baseDefense} />
        <Stat k="S" now={cur.speed} base={c.baseSpeed} />
      </div>
    </div>
  );
}

function Meter({
  value, fill, label, className, emphasise,
}: {
  value: number; fill: string; label: string; className?: string; emphasise?: boolean;
}) {
  return (
    <div className={cx('flex items-center gap-1.5', className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-[2px] bg-raised/80">
        <div
          className={cx('h-full transition-[width] duration-300 ease-out', fill)}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={cx(
        'shrink-0 font-mono text-[10px] leading-none tabular-nums',
        emphasise ? 'text-bad' : 'text-faint',
      )}>
        {label}
      </span>
    </div>
  );
}

function Stat({ k, now, base }: { k: string; now: number; base: number }) {
  const d = now - base;
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <span className="text-faint">{k}</span>
      <span className="text-ink">{now}</span>
      {d !== 0 && (
        <span className={d > 0 ? 'text-good' : 'text-warn'}>
          {d > 0 ? '+' : ''}{d}
        </span>
      )}
    </span>
  );
}

/** The bar that follows a fighter around the arena, with the number on it. */
function HeadBar({ v, c }: { v: Vitals | null; c: Combatant }) {
  const cur = v ?? {
    healthPoints: c.healthPoints, maxHealthPoints: c.maxHealthPoints,
    shield: c.shield, maxShield: c.maxShield,
    attack: 0, defense: 0, speed: 0,
  };
  const hp = pct(cur.healthPoints, cur.maxHealthPoints);
  const sh = pct(cur.shield, cur.maxShield);
  return (
    <div className="w-[78px] rounded-[2px] border border-rune/10 bg-void/70 px-1 py-0.5">
      {cur.maxShield > 0 && (
        <div className="mb-0.5 h-1.5 overflow-hidden rounded-[1px] bg-raised/70">
          <div
            className="h-full bg-tide transition-[width] duration-300"
            style={{ width: `${sh}%` }}
          />
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-[1px] bg-raised/70">
        <div
          className={cx(
            'h-full transition-[width] duration-300',
            hp > 50 ? 'bg-good' : hp > 25 ? 'bg-warn' : 'bg-bad',
          )}
          style={{ width: `${hp}%` }}
        />
      </div>
      <div className="mt-0.5 text-center font-mono text-[10px] leading-none tabular-nums">
        {cur.healthPoints}<span className="text-faint">/{cur.maxHealthPoints}</span>
      </div>
    </div>
  );
}
