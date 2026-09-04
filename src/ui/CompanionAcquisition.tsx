/**
 * The moment a companion becomes yours.
 *
 * This sequence deliberately accepts a finished Monster rather than knowing
 * how it was acquired. Faction.Join can use it today and a capture reply can
 * hand over the same shape later. The animation is only a reader of that
 * authoritative result: its walk sheet, advanced strike, portrait and card
 * plan all come from the record the transaction returned.
 */
import {
  CSSProperties, useEffect, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { CardObject, createCardObject } from '../gfx/cardObject';
import {
  BrowserCardOptions, CardAssembly, CardAssemblyLayer, drawCardAssembly,
} from '../lib/card/browser';
import { Monster } from '../lib/types';
import { isElement } from '../lib/monster-index';
import { MonsterRig, monsterRig } from '../game/MonsterRig';
import {
  FRAME, SPECIAL, SPECIAL_FRAME, fxUrl, sheetUrl,
} from '../game/assets';
import { portrait } from './art';
import { Arrow } from './icons';
import { Button, Spinner, cx } from './primitives';

type Phase = 'loading' | 'entrance' | 'attack' | 'swirl' | 'forge' | 'burst' | 'reveal';
export type AcquisitionKind = 'adoption' | 'capture';

type PerformanceArt = {
  walk: HTMLImageElement | null;
  strike: HTMLImageElement | null;
  portrait: HTMLImageElement | null;
  atlas?: { image: HTMLImageElement; rig: MonsterRig };
};

const NEXT: Partial<Record<Phase, { phase: Phase; after: number }>> = {
  entrance: { phase: 'attack', after: 950 },
  attack: { phase: 'swirl', after: 1050 },
  // Each of the six real card layers completes its staggered orbit inside this
  // window. The next phase never cuts the last layer off halfway home.
  swirl: { phase: 'forge', after: 2900 },
  forge: { phase: 'burst', after: 700 },
  burst: { phase: 'reveal', after: 560 },
};

const ORBITS = [
  { x0: '-42vw', y0: '-6vh', x1: '31vw', y1: '20vh', r: '-76deg' },
  { x0: '38vw', y0: '-18vh', x1: '-28vw', y1: '17vh', r: '68deg' },
  { x0: '35vw', y0: '9vh', x1: '-34vw', y1: '-19vh', r: '112deg' },
  { x0: '-32vw', y0: '24vh', x1: '27vw', y1: '-20vh', r: '-108deg' },
  { x0: '19vw', y0: '28vh', x1: '-25vw', y1: '-22vh', r: '142deg' },
  { x0: '-18vw', y0: '-28vh', x1: '34vw', y1: '4vh', r: '-138deg' },
] as const;

type Vars = CSSProperties & Record<`--${string}`, string | number>;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    // The card can still finish if an optional performance sheet is missing.
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export function CompanionAcquisition({
  monster, kind = 'adoption', cardOptions, performancePortraitUrl, onComplete,
}: {
  monster: Monster;
  kind?: AcquisitionKind;
  /** Admin/studio overrides. Production acquisition uses the canonical art. */
  cardOptions?: BrowserCardOptions;
  /** The portrait the creature becomes; defaults to the released bloodline. */
  performancePortraitUrl?: string;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [assembly, setAssembly] = useState<CardAssembly | null>(null);
  const [performance, setPerformance] = useState<PerformanceArt | null>(null);
  const [failed, setFailed] = useState(false);
  const [objectState, setObjectState] = useState<'waiting' | 'held' | 'flat'>('waiting');
  const object = useRef<CardObject | null>(null);
  const objectCanvas = useRef<HTMLCanvasElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const skipRequested = useRef(false);
  const completed = useRef(false);
  const reduced = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const rig = monsterRig(monster);
    const walk = rig.textureUrl ?? sheetUrl(monster.sprite);
    const strike = rig.textureUrl ?? (isElement(monster.elementType)
      ? fxUrl(SPECIAL[monster.elementType]) : '');
    const portraitUrl = performancePortraitUrl ?? portrait(monster.elementType, monster.level, monster.entryNo);

    Promise.all([
      // A held card is always the plain 648x1065 face. Ignore an extended flag
      // if a studio caller handed over its current CardPreview options.
      drawCardAssembly(monster, { ...cardOptions, extended: false }),
      loadImage(walk),
      loadImage(strike),
      loadImage(portraitUrl),
    ]).then(([card, walkImage, strikeImage, portraitImage]) => {
      if (cancelled) return;
      setAssembly(card);
      setPerformance({
        walk: walkImage, strike: strikeImage, portrait: portraitImage,
        atlas: rig.packed && walkImage ? { image: walkImage, rig } : undefined,
      });
      setPhase(reduced.current || skipRequested.current ? 'reveal' : 'entrance');
    }).catch(() => {
      if (cancelled) return;
      setFailed(true);
      setPhase('reveal');
    });

    return () => { cancelled = true; };
  }, [cardOptions, monster, performancePortraitUrl]);

  useEffect(() => {
    const next = NEXT[phase];
    if (!next) return undefined;
    const timer = window.setTimeout(() => setPhase(next.phase), next.after);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'reveal' || !assembly || !objectCanvas.current) return undefined;
    object.current = createCardObject(objectCanvas.current, {
      face: assembly.face,
      element: monster.elementType,
      introSpin: !skipRequested.current,
    });
    setObjectState(object.current ? 'held' : 'flat');
    return () => {
      object.current?.dispose();
      object.current = null;
    };
  }, [assembly, monster.elementType, phase]);

  useEffect(() => {
    if (phase !== 'reveal') return undefined;
    const timer = window.setTimeout(() => continueButton.current?.focus(), 500);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const finish = () => {
    if (completed.current) return;
    completed.current = true;
    onComplete();
  };

  const skip = () => {
    skipRequested.current = true;
    if (assembly || failed) setPhase('reveal');
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (phase === 'reveal') finish();
      else skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${monster.name} ${kind} reveal`}
      data-element={monster.elementType}
      className={cx('acquisition-reveal', `acquisition-phase-${phase}`)}
    >
      <div aria-hidden className="acquisition-grid" />
      <div aria-hidden className="acquisition-glow" />

      {phase !== 'reveal' && (
        <button type="button" className="acquisition-skip" onClick={skip}>
          Skip<span className="hidden sm:inline"> animation</span>
        </button>
      )}

      {/*
        The name, and nothing else.

        There used to be an eyebrow and a body line narrating each phase as it
        passed — "The record takes shape", "Every layer becomes one living
        card". The animation already shows all of that, so the text was a
        caption for a picture the player is looking at, changing six times in
        seven seconds directly above it.

        The failure line stays. That one is not narration: it is the only thing
        that explains a companion arriving without its card art.
      */}
      <header className="acquisition-copy">
        <h1>{monster.name}</h1>
        {failed && <p>Your companion arrived, but the card art could not be rendered.</p>}
      </header>

      <div className="acquisition-stage">
        <div aria-hidden className="acquisition-vortex">
          <i /><i /><i />
          {Array.from({ length: 18 }, (_, index) => (
            <span
              key={index}
              style={{
                '--particle-angle': `${index * 20}deg`,
                '--particle-radius': `${5.5 + (index % 5) * 1.25}rem`,
                '--particle-delay': `${(index % 6) * -0.12}s`,
              } as Vars}
            />
          ))}
        </div>

        {phase === 'loading' && <Spinner className="h-8 w-8 text-element" />}

        {performance && (phase === 'entrance' || phase === 'attack') && (
          <div aria-hidden className="acquisition-creature">
            <CreaturePerformance art={performance} phase={phase} />
          </div>
        )}

        {performance?.portrait && (
          <img
            aria-hidden
            src={performance.portrait.src}
            alt=""
            data-pixel
            className="acquisition-portrait-morph"
          />
        )}

        {assembly && (
          <div aria-hidden className="acquisition-card-space acquisition-card-layers">
            {assembly.layers.map((layer, index) => (
              <AssemblyCanvas
                key={layer.id}
                layer={layer}
                index={index}
              />
            ))}
          </div>
        )}

        <div aria-hidden className="acquisition-boom">
          <i /><i />
          {Array.from({ length: 14 }, (_, index) => (
            <span
              key={index}
              style={{
                '--boom-angle': `${index * (360 / 14)}deg`,
                '--boom-distance': `${7 + (index % 4) * 2.2}rem`,
              } as Vars}
            />
          ))}
        </div>

        {phase === 'reveal' && (
          <div className="acquisition-card-space acquisition-card-object">
            <canvas
              ref={objectCanvas}
              aria-label={`${monster.name} card; drag to turn it over`}
              className={cx('h-full w-full touch-none', objectState === 'held' && 'cursor-grab active:cursor-grabbing')}
            />
            {objectState !== 'held' && assembly && (
              <CopyCanvas
                source={assembly.face}
                className="absolute inset-0 h-full w-full rounded-[3px]"
                label={`${monster.name} card`}
              />
            )}
            {failed && !assembly && (
              <img
                src={portrait(monster.elementType, monster.level, monster.entryNo)}
                alt={monster.name}
                data-pixel
                className="acquisition-card-fallback"
              />
            )}
          </div>
        )}
      </div>

      <footer className="acquisition-footer">
        {phase === 'reveal' && (
          <div className="acquisition-finish animate-rise">
            <p className="text-[13px] text-faint">
              {objectState === 'held' ? 'Drag the card to catch the foil and turn it over.' : 'Your living record is complete.'}
            </p>
            <Button
              ref={continueButton}
              variant="primary"
              size="lg"
              icon={<Arrow className="h-4 w-4" />}
              onClick={finish}
            >
              Meet {monster.name}
            </Button>
          </div>
        )}
      </footer>
    </div>,
    document.body,
  );
}

function AssemblyCanvas({
  layer, index,
}: { layer: CardAssemblyLayer; index: number }) {
  const orbit = ORBITS[index % ORBITS.length];
  const style: Vars = {
    '--layer-x0': orbit.x0,
    '--layer-y0': orbit.y0,
    '--layer-x1': orbit.x1,
    '--layer-y1': orbit.y1,
    '--layer-rotation': orbit.r,
    '--layer-delay': `${index * 55}ms`,
    zIndex: index + 1,
  };
  return (
    <CopyCanvas
      source={layer.canvas}
      className="acquisition-layer"
      style={style}
    />
  );
}

function CopyCanvas({
  source, className, style, label,
}: {
  source: HTMLCanvasElement;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);
  }, [source]);
  return (
    <canvas
      ref={ref}
      width={source.width}
      height={source.height}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      style={{ ...style, imageRendering: 'pixelated' }}
    />
  );
}

type PackedRect = { x: number; y: number; w: number; h: number };

/**
 * The packed atlas rectangle for this phase, or undefined to fall through to
 * the sprite sheets.
 *
 * Resolved from the atlas DIRECTLY rather than through `rig.clip()`. `clip()`
 * falls back to the LEGACY sheet clips when the packed atlas has no such
 * motion, and those name their frames by sprite-sheet row index — `"12"` —
 * which is not a key in a packed atlas's `frames` map. Looking one up returned
 * undefined and reading `.frame` off it took the whole reveal down, for any
 * companion whose atlas has no `attack.advanced`.
 *
 * So: only a clip the packed atlas actually declares, and only a frame that
 * actually resolves. Anything else is not an error — it is a companion that
 * animates from its sheets instead.
 */
function packedFrame(
  art: PerformanceArt, phase: Phase, elapsed: number,
): { frame: PackedRect } | undefined {
  if (!art.atlas || (phase !== 'entrance' && phase !== 'attack')) return undefined;
  const motion = phase === 'attack' ? 'attack.advanced' : 'walk.right';
  const clip = art.atlas.rig.atlas?.runerealm.clips[motion];
  if (!clip?.frames.length || !clip.frameRate) return undefined;
  const step = Math.floor(elapsed / (1000 / clip.frameRate));
  const index = phase === 'attack'
    ? Math.min(clip.frames.length - 1, step)
    : step % clip.frames.length;
  const entry = art.atlas.rig.atlas?.frames[clip.frames[index]] as
    { frame?: PackedRect } | undefined;
  return entry?.frame ? { frame: entry.frame } : undefined;
}

function CreaturePerformance({ art, phase }: { art: PerformanceArt; phase: Phase }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0;
    const started = performance.now();

    const drawFallback = () => {
      if (!art.portrait) return;
      const scale = Math.min(112 / art.portrait.naturalWidth, 112 / art.portrait.naturalHeight);
      const width = art.portrait.naturalWidth * scale;
      const height = art.portrait.naturalHeight * scale;
      ctx.drawImage(art.portrait, (128 - width) / 2, 128 - height, width, height);
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.imageSmoothingEnabled = false;
      const elapsed = now - started;
      const packed = packedFrame(art, phase, elapsed);
      if (packed) {
        const { frame } = packed;
        const scale = Math.min(128 / frame.w, 128 / frame.h);
        ctx.drawImage(art.atlas!.image, frame.x, frame.y, frame.w, frame.h,
          (128 - frame.w * scale) / 2, 128 - frame.h * scale, frame.w * scale, frame.h * scale);
      } else if (phase === 'entrance' && art.walk) {
        const frame = Math.floor(elapsed / 125) % 4;
        ctx.drawImage(
          art.walk,
          frame * FRAME.w, 0, FRAME.w, FRAME.h,
          (128 - FRAME.w) / 2, 128 - FRAME.h, FRAME.w, FRAME.h,
        );
      } else if (art.strike) {
        const frame = phase === 'attack'
          ? Math.min(SPECIAL_FRAME.count - 1, Math.floor(elapsed / (1000 / 14)))
          : SPECIAL_FRAME.count - 1;
        ctx.drawImage(
          art.strike,
          frame * SPECIAL_FRAME.w, 0, SPECIAL_FRAME.w, SPECIAL_FRAME.h,
          0, 0, SPECIAL_FRAME.w, SPECIAL_FRAME.h,
        );
      } else {
        drawFallback();
      }
      if (phase === 'entrance' || phase === 'attack') raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [art, phase]);

  return <canvas ref={canvas} width={128} height={128} />;
}

export default CompanionAcquisition;
