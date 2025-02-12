import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import SpriteCustomizer from './pages/SpriteCustomizer'
import PurchaseInfo from './pages/PurchaseInfo'
import {MonsterManagement} from './pages/MonsterManagement'
import Admin from './pages/Admin'
import MonsterTest from './pages/MonsterTest'
import { WalletProvider } from './context/WalletContext'
import './index.css'
import { FactionPage } from './pages/FactionPage'
import { BattlePage } from './pages/BattlePage'
import { handleReferralLink } from './utils/aoHelpers'
import { ActiveBattlePage } from './pages/ActiveBattlePage'

const App = () => {
  useEffect(() => {
    // Handle referral link parameters when the app loads
    handleReferralLink();
  }, []);

  return (
    <Router>
      <WalletProvider>
        <Routes>
          <Route path="/" element={<PurchaseInfo />} />
          <Route path="/customize" element={<SpriteCustomizer />} />
          <Route path="/factions" element={<FactionPage />} />
          <Route path="/monsters" element={<MonsterManagement />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/battle" element={<BattlePage />} />
          <Route path="/battle/active" element={<ActiveBattlePage />} />
          <Route path="/monster-test" element={<MonsterTest />} />
        </Routes>
      </WalletProvider>
    </Router>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
