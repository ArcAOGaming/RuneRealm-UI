/**
 * The rune field, mounted.
 *
 * A thin wrapper over `gfx/runeBinding`: it owns the canvas, keeps the scene's
 * three inputs — bid, phase, element — in step with React, and tears the
 * renderer down on unmount. Everything expressive is in the gfx module.
 *
 * `createRuneBinding` returns null without WebGL, and that is a supported
 * outcome rather than an error: the fallback is the creature's portrait, flat,
 * exactly as the binding screen showed it before there was a field. Losing the
 * ceremony must never lose the choice.
 */
import { useEffect, useRef, useState } from 'react';
import { BindingElement, RuneBinding, createRuneBinding } from '../gfx/runeBinding';
import { BindingPhase } from '../gfx/bindingPhase';

export function RuneField({
  portraitUrl, element, runes, phase, className,
}: {
  portraitUrl: string;
  element: BindingElement;
  runes: number;
  phase: BindingPhase;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<RuneBinding | null>(null);
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!canvas.current) return undefined;
    const handle = createRuneBinding(canvas.current, {
      portraitUrl, element, runes: runes,
    });
    field.current = handle;
    setLive(handle !== null);
    return () => { field.current = null; handle?.dispose(); };
    // Built once. The portrait, element, bid and phase are all pushed in below
    // rather than rebuilding the scene — a rebuild on a bid change would
    // restart the orbit every time the player weighed a different number.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { field.current?.setRunes(runes); }, [runes]);
  useEffect(() => { field.current?.setPhase(phase); }, [phase]);
  useEffect(() => { field.current?.setElement(element); }, [element]);
  useEffect(() => { field.current?.setPortrait(portraitUrl); }, [portraitUrl]);

  return (
    <div className={className}>
      <canvas ref={canvas} className="h-full w-full" aria-hidden />
      {!live && (
        <img
          src={portraitUrl}
          alt=""
          aria-hidden
          data-pixel
          className="absolute left-1/2 top-1/2 h-[46%] -translate-x-1/2 -translate-y-1/2 object-contain"
        />
      )}
    </div>
  );
}

export default RuneField;
