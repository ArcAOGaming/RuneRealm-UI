import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { BattlePage } from './pages/BattlePage';
import MonsterManagement from './pages/MonsterManagement';
import { FactionPage } from './pages/FactionPage';
import PurchaseInfo from './pages/PurchaseInfo';
import Admin from './pages/Admin';

const App: React.FC = () => {
  return (
    <Router basename="/">
      <Routes>
        <Route path="/" element={<BattlePage />} />
        <Route path="battle" element={<BattlePage />} />
        <Route path="monsters" element={<MonsterManagement />} />
        <Route path="faction" element={<FactionPage />} />
        <Route path="purchase" element={<PurchaseInfo />} />
        <Route path="admin" element={<Admin />} />
      </Routes>
    </Router>
  );
};

export default App;
