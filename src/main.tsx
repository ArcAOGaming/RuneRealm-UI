import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import SpriteCustomizer from './pages/SpriteCustomizer'
import PurchaseInfo from './pages/PurchaseInfo'
import {MonsterManagement} from './pages/MonsterManagement'
import Admin from './pages/Admin'
import MonsterTest from './pages/MonsterTest'
import { WalletProvider } from './context/WalletContext'
import { useWallet } from './hooks/useWallet';
import { WalletStatus } from './utils/interefaces';
import './index.css'
import { FactionPage } from './pages/FactionPage'
import { FactionDetailPage } from './pages/FactionDetailPage'
import { BattlePage } from './pages/BattlePage'
import { handleReferralLink } from './utils/aoHelpers'
import { ActiveBattlePage } from './pages/ActiveBattlePage'
import Inventory from './components/Inventory'

interface AppContentProps {
  wallet?: { address: string };
  walletStatus?: WalletStatus;
}

const AppContent = () => {
  const { wallet, walletStatus } = useWallet() as { wallet?: { address: string }, walletStatus?: WalletStatus };

  useEffect(() => {
    // Handle referral link parameters when the app loads
    handleReferralLink();
  }, []);

  useEffect(() => {
    // Set initial rotation preference
    const rotateScreen = localStorage.getItem('rotateScreen') !== 'false';
    document.body.setAttribute('data-rotate', rotateScreen.toString());

    // Listen for storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'rotateScreen') {
        const newRotateScreen = e.newValue !== 'false';
        document.body.setAttribute('data-rotate', newRotateScreen.toString());
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return (
    <div className="app-container">
      {wallet?.address && walletStatus?.isUnlocked && <Inventory />}
      <Routes>
        <Route path="/" element={<PurchaseInfo />} />
        <Route path="/customize" element={<SpriteCustomizer />} />
        <Route path="/factions" element={<FactionPage />} />
        <Route path="/factions/:factionId" element={<FactionDetailPage />} />
        <Route path="/monsters" element={<MonsterManagement />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/battle" element={<BattlePage />} />
        <Route path="/battle/active" element={<ActiveBattlePage />} />
        <Route path="/monster-test" element={<MonsterTest />} />
      </Routes>
    </div>
  );
};

const App = () => (
  <Router>
    <WalletProvider>
      <AppContent />
    </WalletProvider>
  </Router>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
