import { useMemo, useState } from 'react';
import { useGame } from '../state/gameContext';
import { Element } from '../lib/types';
import AltarHall, { AltarInfo } from './Altars';

/**
 * The real altar renderer in exhibition mode.
 *
 * Selecting an altar only changes the light. It never opens the faction flow
 * or signs an oath, so the public page can show the member experience without
 * exposing a permanent action.
 */
export default function LandingAltars() {
  const { factions, player } = useGame();
  const [selected, setSelected] = useState<Element | null>(null);

  const info = useMemo(() => {
    const out: Partial<Record<Element, AltarInfo>> = {};
    for (const faction of factions ?? []) {
      out[faction.element] = {
        name: faction.name,
        companion: faction.monsterName,
        members: faction.memberCount,
        mine: player?.faction === faction.name,
      };
    }
    return out;
  }, [factions, player?.faction]);

  const sworn = factions?.find((faction) => faction.name === player?.faction)?.element ?? null;

  return (
    <AltarHall
      info={info}
      sworn={sworn}
      selected={selected}
      onSelect={setSelected}
      hint="Touch an altar to wake its current"
      className="landing-altar-hall"
    />
  );
}
