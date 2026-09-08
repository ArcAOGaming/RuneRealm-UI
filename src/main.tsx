import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { GameProvider } from './state/GameProvider';
import { ToastProvider } from './ui/Toast';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { AetherProvider } from './ui/Aether';
import { Shell } from './ui/Shell';
import { Gate } from './ui/Gate';
import Landing from './screens/Landing';
import Lore from './screens/Lore';
import Factions from './screens/Factions';
import Companion from './screens/Companion';
import Arena from './screens/Arena';
import Admin from './screens/Admin';
import Marketplace from './screens/Marketplace';
import Recover from './screens/Recover';
import Hunt from './screens/Hunt';
import Collection from './screens/Collection';
import Customiser from './screens/Customiser';
import MonsterIndex from './screens/MonsterIndex';
import { registerPwa } from './pwa';
import { PwaInstallProvider } from './ui/PwaInstall';
import { TourProvider } from './ui/Tour';
import './index.css';

registerPwa();

/**
 * Routes.
 *
 * The open world (`/reality`, `/world`) is deliberately absent. It is not
 * deleted — the source is parked under `src/_hidden/` with a note on bringing
 * it back — but it runs on the legacynet Reality process and cannot work until
 * that is ported too. Anything that still links to it lands on the front door
 * rather than a blank iframe.
 *
 * `/character` is the standalone character creator. The same editor opens as a
 * dialog from the Companion and Collection pages, which is how most people
 * reach it; the route exists so a deep link still lands somewhere.
 *
 * Three tiers, and `Gate` is where they are declared — see `ui/Gate.tsx`.
 *
 *   - PUBLIC: `/` and `/lore` are the front of the game and are for everyone.
 *     `/recover` is public BECAUSE it is for people the process has no record
 *     of yet — gating the door that lets a lost account back in behind having
 *     an account is the one arrangement that cannot work. `/admin` is likewise
 *     open, because the wallet that owns the process need not be a player; it
 *     is hidden by being unlinked, and every action behind it is refused from
 *     a non-owner by the process itself.
 *   - SWORN: everything else, the faction hall included. Each of these screens
 *     is about a companion, and a player without a faction does not have one.
 *
 * There is deliberately no tier in between. Choosing a faction is the one
 * thing a member without an oath can do, and it happens on `/` — see
 * `FactionChoice` in `screens/Factions.tsx`. Giving it a route of its own
 * meant the game's chrome came with it: a rune count, an offering and a
 * walkthrough, all belonging to a game the player had not joined yet.
 */
function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ErrorBoundary>
        <AetherProvider>
          <ToastProvider>
            <PwaInstallProvider>
              {/* Above the game provider, not inside it: the wallet dialog is
                  the provider's own child and it is where the walkthrough is
                  replayed from, so the provider has to be able to see this. */}
              <TourProvider>
              <GameProvider>
                <Shell>
                  <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/lore" element={<Lore />} />
                    <Route path="/factions" element={<Gate><Factions /></Gate>} />
                    <Route path="/companion" element={<Gate><Companion /></Gate>} />
                    <Route path="/collection" element={<Gate><Collection /></Gate>} />
                    <Route path="/monster-index" element={<Gate><MonsterIndex /></Gate>} />
                    <Route path="/bestiary" element={<Navigate to="/monster-index" replace />} />
                    <Route path="/character" element={<Gate><Customiser /></Gate>} />
                    <Route path="/customize" element={<Navigate to="/character" replace />} />
                    <Route path="/party" element={<Navigate to="/collection" replace />} />
                    <Route path="/arena" element={<Gate><Arena /></Gate>} />
                    <Route path="/hunt" element={<Gate><Hunt /></Gate>} />
                    <Route path="/ranks" element={<Navigate to="/factions#ranks" replace />} />
                    <Route path="/market" element={<Gate><Marketplace /></Gate>} />
                    <Route path="/recover" element={<Recover />} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Shell>
              </GameProvider>
              </TourProvider>
            </PwaInstallProvider>
          </ToastProvider>
        </AetherProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

/**
 * One root for the lifetime of the page.
 *
 * A dev-server HMR update can re-execute this module without reloading the
 * document. Calling `createRoot` again on the same container warns, then
 * renders a SECOND React tree over the first — which is where the
 * `removeChild: the node to be removed is not a child of this node` crash
 * came from, as two roots raced to unmount the same DOM. Keeping the root on
 * the container means a re-execution re-renders instead of re-mounting.
 */
const container = document.getElementById('root')! as HTMLElement & {
  __root?: ReactDOM.Root;
};
const root = container.__root ?? (container.__root = ReactDOM.createRoot(container));

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
