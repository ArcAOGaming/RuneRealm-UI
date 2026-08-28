/** The optional three.js field behind the public front door. */
import { useEffect, useRef, useState } from 'react';
import { createRealmVista } from '../gfx/realmVista';
import { Mark } from './Mark';

export default function RealmVista() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!canvas.current) return;
    // The original stone Monolith is the hero's primary seal. This canvas now
    // supplies the world around it: the threshold rings, elemental records and
    // Corporation skyline, without drawing a second logo underneath.
    const vista = createRealmVista(canvas.current, { showGate: false });
    if (!vista) setLive(false);
    return () => vista?.dispose();
  }, []);

  if (!live) {
    return (
      <div className="absolute inset-0 flex items-center justify-end pr-[14%] opacity-35" aria-hidden>
        <Mark size={310} glow />
      </div>
    );
  }
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    />
  );
}
