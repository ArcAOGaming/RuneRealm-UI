import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { GameProvider } from './state/GameProvider';
import { ToastProvider } from './ui/Toast';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { AetherProvider } from './ui/Aether';
import { Shell } from './ui/Shell';
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
                    <Route path="/factions" element={<Factions />} />
                    <Route path="/companion" element={<Companion />} />
                    <Route path="/collection" element={<Collection />} />
                    <Route path="/monster-index" element={<MonsterIndex />} />
                    <Route path="/bestiary" element={<Navigate to="/monster-index" replace />} />
                    <Route path="/character" element={<Customiser />} />
                    <Route path="/customize" element={<Navigate to="/character" replace />} />
                    <Route path="/party" element={<Navigate to="/collection" replace />} />
                    <Route path="/arena" element={<Arena />} />
                    <Route path="/hunt" element={<Hunt />} />
                    <Route path="/ranks" element={<Navigate to="/factions#ranks" replace />} />
                    <Route path="/market" element={<Marketplace />} />
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
