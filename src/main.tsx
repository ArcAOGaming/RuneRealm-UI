import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import SpriteCustomizer from './pages/SpriteCustomizer'
import PurchaseInfo from './pages/PurchaseInfo'
import {MonsterManagement} from './pages/MonsterManagement'
import Admin from './pages/Admin'
import { WalletProvider } from './context/WalletContext'
import './index.css'
import { FactionPage } from './pages/FactionPage'

const App = () => {
  return (
    <Router>
      <WalletProvider>
        <Routes>
          <Route path="/" element={<PurchaseInfo />} />
          <Route path="/customize" element={<SpriteCustomizer />} />
          <Route path="/factions" element={<FactionPage />} />
          <Route path="/monsters" element={<MonsterManagement />} />
          <Route path="/admin" element={<Admin />} />
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
