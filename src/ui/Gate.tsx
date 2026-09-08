/**
 * The door. Every route except the front page and the story is behind one.
 *
 * One question, because there turned out to be only one: has this wallet SWORN
 * to a faction? Everything behind these routes is about a companion, and a
 * companion comes from an oath. A visitor with no wallet, a wallet the process
 * has never heard of, and a member who has not chosen yet all belong in the
 * same place — `/` — which shows each of them the one thing they can do next.
 * That is why there is no separate "member" tier here: the faction hall is not
 * a route, it is what the front page renders to a member without an oath (see
 * `FactionChoice` in `screens/Factions.tsx`).
 *
 * The waiting state is the part worth being careful about. A redirect is not
 * reversible from the user's point of view — bouncing somebody home and then
 * discovering they were a player leaves them on the wrong page with no idea
 * why — so the gate NEVER redirects on "don't know yet". It redirects only
 * once the account read has actually settled, and the membership mark
 * (`lib/access.ts`) means the common case never reaches that wait at all: a
 * returning player is admitted from local storage on the first paint, before
 * the process is asked anything.
 *
 * This is not security and is not pretending to be. Every action behind these
 * routes is a signed message the process verifies for itself, and a determined
 * visitor can put whatever they like in local storage. The gate exists so the
 * app shows one person one coherent game, not so it withholds secrets.
 */
import { Navigate } from 'react-router-dom';
import { useGame } from '../state/gameContext';
import { Spinner } from './primitives';

export function Gate({ children }: { children: React.ReactNode }) {
  const { sworn, loadingPlayer } = useGame();
  if (sworn) return <>{children}</>;
  return loadingPlayer ? <GateWait /> : <Navigate to="/" replace />;
}

/**
 * The only thing a gated route may show before it knows.
 *
 * Deliberately almost nothing: it is on screen for the length of one account
 * read on a cold browser and never again, and a skeleton of a page the visitor
 * may not be allowed to see is a worse answer than a quiet wait.
 */
function GateWait() {
  return (
    <div role="status" aria-label="Reading your mark" className="grid min-h-[60vh] place-items-center">
      <Spinner className="h-6 w-6 text-element" />
    </div>
  );
}
