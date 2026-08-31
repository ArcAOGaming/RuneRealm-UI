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

const COPY: Record<Exclude<Phase, 'loading'>, { eyebrow: string; body: string }> = {
  entrance: { eyebrow: 'The oath is answered', body: 'A companion steps forward.' },
  attack: { eyebrow: 'Power awakened', body: 'Its advanced strike seals the bond.' },
  swirl: { eyebrow: 'The record takes shape', body: 'Portrait, element, frame and story converge.' },
  forge: { eyebrow: 'Bound into one', body: 'Every layer becomes one living card.' },
  burst: { eyebrow: 'The card breaks free', body: 'Ink becomes matter.' },
  reveal: { eyebrow: 'Companion adopted', body: 'The bond is written. The card is yours to hold.' },
};

const CAPTURE_COPY: Record<Exclude<Phase, 'loading'>, { eyebrow: string; body: string }> = {
  entrance: { eyebrow: 'The binding takes hold', body: 'The wild creature answers the scroll.' },
  attack: { eyebrow: 'Wild power contained', body: 'Its spirit leaves its mark on the bond.' },
  swirl: { eyebrow: 'The captured record forms', body: 'Portrait, element, frame and story converge.' },
  forge: { eyebrow: 'Bound into one', body: 'The encounter becomes one living card.' },
  burst: { eyebrow: 'The card breaks free', body: 'The binding is complete.' },
  reveal: { eyebrow: 'Companion captured', body: 'The card is yours. The trail remembers the meeting.' },
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
    const walk = sheetUrl(monster.sprite);
    const strike = fxUrl(SPECIAL[monster.elementType]);
    const portraitUrl = performancePortraitUrl ?? portrait(monster.elementType, monster.level);

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
      setPerformance({ walk: walkImage, strike: strikeImage, portrait: portraitImage });
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

  const copy = phase === 'loading'
    ? kind === 'capture'
      ? { eyebrow: 'Testing the binding', body: 'The scroll is resolving the encounter.' }
      : { eyebrow: 'Writing the bond', body: 'Calling your companion through the veil.' }
    : kind === 'capture' ? CAPTURE_COPY[phase] : COPY[phase];
  const finalEyebrow = kind === 'capture' ? 'Companion captured' : COPY.reveal.eyebrow;

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

      <header className="acquisition-copy" aria-live="polite">
        <p className="eyebrow text-element">
          {phase === 'reveal' ? finalEyebrow : copy.eyebrow}
        </p>
        <h1>{monster.name}</h1>
        <p>{failed ? 'Your companion arrived, but the card art could not be rendered.' : copy.body}</p>
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
                src={portrait(monster.elementType, monster.level)}
                alt={monster.name}
                data-pixel
                className="acquisition-card-fallback"
              />
            )}
          </div>
        )}
      </div>

      <footer className="acquisition-footer">
        {(phase === 'swirl' || phase === 'forge') && assembly && (
          <div className="acquisition-layer-ledger" aria-hidden>
            {assembly.layers.map((layer) => <span key={layer.id}>{layer.label}</span>)}
          </div>
        )}
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
      if (phase === 'entrance' && art.walk) {
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
