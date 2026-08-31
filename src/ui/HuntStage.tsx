import { useEffect, useRef, useState } from 'react';
import BASE_URL from '../assets/BASE.png?url';
import { Element, Monster } from '../lib/types';
import { HuntScene, HUNT_WORLD } from '../game/HuntScene';
import { mountGame, Mounted } from '../game/boot';
import { cx } from './primitives';

type Dir = 'up' | 'down' | 'left' | 'right';

export function HuntStage({
  playerSpriteTxId, companion, wild, searchFailedToken,
  onTrailReady, onEncounterRevealed, onTravel,
}: {
  playerSpriteTxId?: string;
  companion: Monster;
  wild?: Monster;
  searchFailedToken: number;
  onTrailReady: () => void;
  onEncounterRevealed: () => void;
  onTravel: (travelled: number, target: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted | null>(null);
  const callbacks = useRef({ onTrailReady, onEncounterRevealed, onTravel });
  callbacks.current = { onTrailReady, onEncounterRevealed, onTravel };
  const revealed = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!host.current) return undefined;
    const handle = mountGame(host.current, HUNT_WORLD.w, HUNT_WORLD.h, [HuntScene], {
      onScale: () => setReady(true),
    });
    mounted.current = handle;
    handle.game.scene.start(HuntScene.KEY, {
      playerSheet: playerSpriteTxId ? `https://arweave.net/${playerSpriteTxId}` : BASE_URL,
      monsterSprite: companion.sprite,
      element: companion.elementType as Element,
      onTrailReady: () => callbacks.current.onTrailReady(),
      onTravel: (travelled: number, target: number) => callbacks.current.onTravel(travelled, target),
    });
    return () => { mounted.current = null; handle.destroy(); };
  }, [playerSpriteTxId, companion.sprite, companion.elementType]);

  useEffect(() => {
    if (!wild?.id || revealed.current === wild.id) return;
    let cancelled = false;
    let timer = 0;
    const reveal = () => {
      if (cancelled) return;
      const scene = mounted.current?.scene<HuntScene>(HuntScene.KEY);
      if (!scene) { timer = window.setTimeout(reveal, 50); return; }
      revealed.current = wild.id;
      scene.revealEncounter(wild, () => callbacks.current.onEncounterRevealed());
    };
    reveal();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [wild]);

  useEffect(() => {
    if (!searchFailedToken) return;
    mounted.current?.scene<HuntScene>(HuntScene.KEY)?.resumeAfterSearchFailure();
  }, [searchFailedToken]);

  const press = (dir: Dir, down: boolean) =>
    mounted.current?.scene<HuntScene>(HuntScene.KEY)?.setPad(dir, down);

  return (
    <div className="relative h-full min-h-[300px] overflow-hidden bg-void">
      <div ref={host} className="grid h-full w-full place-items-center overflow-hidden" />
      {!ready && <div className="absolute inset-0 animate-pulse bg-raised/50" />}
      <div className="absolute bottom-3 right-3 grid grid-cols-3 grid-rows-3 gap-1 opacity-80">
        <PadButton dir="up" className="col-start-2" onPress={press} />
        <PadButton dir="left" className="col-start-1 row-start-2" onPress={press} />
        <PadButton dir="right" className="col-start-3 row-start-2" onPress={press} />
        <PadButton dir="down" className="col-start-2 row-start-3" onPress={press} />
      </div>
    </div>
  );
}

export default HuntStage;

function PadButton({
  dir, className, onPress,
}: { dir: Dir; className: string; onPress: (dir: Dir, down: boolean) => void }) {
  const path: Record<Dir, string> = {
    up: 'M12 5 5 12M12 5l7 7M12 5v14', down: 'M12 19 5 12m7 7 7-7m-7 7V5',
    left: 'M5 12l7-7m-7 7 7 7m-7-7h14', right: 'm19 12-7-7m7 7-7 7m7-7H5',
  };
  return (
    <button
      type="button" aria-label={`Walk ${dir}`}
      className={cx(
        'flex h-11 w-11 items-center justify-center rounded-[3px] border border-rune/25',
        'bg-void/75 text-muted backdrop-blur-sm hover:border-element/60 hover:text-ink', className,
      )}
      onPointerDown={(event) => {
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); onPress(dir, true);
      }}
      onPointerUp={() => onPress(dir, false)}
      onPointerCancel={() => onPress(dir, false)}
      onPointerLeave={() => onPress(dir, false)}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d={path[dir]} />
      </svg>
    </button>
  );
}
