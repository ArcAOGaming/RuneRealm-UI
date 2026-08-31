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
import { registerPwa } from './pwa';
import { PwaInstallProvider } from './ui/PwaInstall';
import './index.css';

registerPwa();

/**
 * Routes.
 *
 * The open world (`/reality`, `/world`) and the sprite customiser
 * (`/customize`) are deliberately absent. They are not deleted — the source is
 * parked under `src/_hidden/` with a note on bringing it back — but the open
 * world runs on the legacynet Reality process and the customiser uploads to a
 * legacynet skin process, so neither can work until they are ported too.
 * Anything that still links to them lands on the front door rather than a blank
 * iframe.
 */
function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ErrorBoundary>
        <AetherProvider>
          <ToastProvider>
            <PwaInstallProvider>
              <GameProvider>
                <Shell>
                  <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/lore" element={<Lore />} />
                    <Route path="/factions" element={<Factions />} />
                    <Route path="/companion" element={<Companion />} />
                    <Route path="/collection" element={<Collection />} />
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
            </PwaInstallProvider>
          </ToastProvider>
        </AetherProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
