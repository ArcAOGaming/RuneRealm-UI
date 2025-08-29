import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import SpriteCustomizer from "./pages/managment/SpriteCustomizer";
import PurchaseInfo from "./pages/PurchaseInfo";
import { MonsterManagement } from "./pages/managment/MonsterManagement";
import { WalletProvider } from "./contexts/WalletContext";
import { TokenProvider } from "./contexts/TokenContext";
import { BattleProvider } from "./contexts/BattleContext";
import { useWallet } from "./contexts/WalletContext";
import { WalletStatus } from "./utils/interefaces";
import "./index.css";
import { handleReferralLink } from "./utils/aoHelpers";
import { BotBattlePage } from "./pages/battle/BotBattlePage";
import { RankedBattlePage } from "./pages/battle/RankedBattlePage";
import Inventory from "./components/ui/Inventory";
import { MonsterProvider } from "./contexts/MonsterContext";
import { FactionProvider } from "./contexts/FactionContext";
import DebugPage from "./pages/debug/DebugPage";
import StartPage from "./pages/StartPage";
import ActiveBattlePage from "./pages/battle/ActiveBattlePage";
import Admin from "./pages/admin/Admin";
import BattlePage from "./pages/battle/BattleMain";
import { Analytics } from "./components/Analytics";
import { FactionPage } from "./pages/faction/FactionPage";
import { FactionDetailPage } from "./pages/faction/FactionDetailPage";

interface AppContentProps {
  wallet?: { address: string };
  walletStatus?: WalletStatus;
}

const AppContent = () => {
  const { wallet, walletStatus } = useWallet() as {
    wallet?: { address: string };
    walletStatus?: WalletStatus;
  };

  useEffect(() => {
    // Handle referral link parameters when the app loads
    handleReferralLink();
  }, []);

  useEffect(() => {
    // Set initial rotation preference
    const rotateScreen = localStorage.getItem("rotateScreen") !== "false";
    document.body.setAttribute("data-rotate", rotateScreen.toString());

    // Listen for storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "rotateScreen") {
        const newRotateScreen = e.newValue !== "false";
        document.body.setAttribute("data-rotate", newRotateScreen.toString());
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const location = useLocation();
  const showInventory = [ "/monsters", "/reality"].includes(
    location.pathname
  );

  return (
    <div className="app-container">
      {wallet?.address && walletStatus?.isUnlocked && showInventory && (
        <Inventory />
      )}
      <Analytics>
        <Routes>

          <Route path="/" element={<StartPage />} />
          <Route path="/purchase" element={<PurchaseInfo />} />
          <Route path="/customize" element={<SpriteCustomizer />} />
          <Route path="/factions" element={<FactionPage />} />
          <Route path="/factions/:factionId" element={<FactionDetailPage />} />
          <Route path="/monsters" element={<MonsterManagement />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/battle" element={<BattlePage />} />
          <Route path="/battle/bot" element={<BotBattlePage />} />
          <Route path="/battle/ranked" element={<RankedBattlePage />} />
          <Route path="/battle/active" element={<ActiveBattlePage />} />
          <Route path="/debug" element={<DebugPage />} />
          <Route
            path="/reality/*"
            element={
              <iframe
                src="/reality/index.html"
                style={{ width: "100%", height: "100vh", border: "none" }}
                title="Reality"
              />
            }
          />
          <Route
            path="/world/*"
            element={
              <iframe
                src="/reality/index.html"
                style={{ width: "100%", height: "100vh", border: "none" }}
                title="Reality"
              />
            }
          />
        </Routes>
      </Analytics>
    </div>
  );
};

const App = () => (
  <Router>
    <WalletProvider>
      <TokenProvider>
        <MonsterProvider>
          <FactionProvider>
            <BattleProvider>
              <AppContent />
            </BattleProvider>
          </FactionProvider>
        </MonsterProvider>
      </TokenProvider>
    </WalletProvider>
  </Router>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
