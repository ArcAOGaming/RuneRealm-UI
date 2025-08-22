import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWallet } from '../contexts/WalletContext';
import Header from '../components/ui/Header';
import Modal from '../components/ui/Modal';
import { currentTheme, Theme } from '../constants/theme';

const StartPage: React.FC = () => {
  const { wallet, walletStatus, darkMode, isCheckingStatus } = useWallet();
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();
  const [showPremiumPopup, setShowPremiumPopup] = useState(false);

  // Show premium popup for non-premium users after wallet status is fully loaded
  useEffect(() => {
    // Only show popup if:
    // 1. Wallet is connected
    // 2. Status check is complete (not checking)
    // 3. User is not unlocked
    // 4. We have valid wallet status (not null)
    if (wallet?.address && !isCheckingStatus && walletStatus && !walletStatus.isUnlocked) {
      const timer = setTimeout(() => {
        setShowPremiumPopup(true);
      }, 2000); // Show popup after 2 seconds to ensure status is loaded
      return () => clearTimeout(timer);
    }
  }, [wallet?.address, walletStatus?.isUnlocked, isCheckingStatus, walletStatus]);

  const sectionCardStyle: React.CSSProperties = {
    backgroundColor: theme.cardBg,
    border: `1px solid ${theme.cardBorder}`,
    borderRadius: '12px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    color: theme.cardText,
  };

  const linkStyle: React.CSSProperties = {
    color: theme.cardAccent,
    textDecoration: 'none',
    fontWeight: 500,
    display: 'block',
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    transition: 'background-color 0.2s',
    border: `1px solid ${theme.cardBorder}`,
    marginBottom: '0.5rem',
    backgroundColor: theme.cardBg,
  };

  return (
    <div className={`min-h-screen ${theme.bg}`}>
      <Header theme={theme} darkMode={darkMode} />
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8 text-center" style={{ color: theme.cardTitle }}>
          Rune Realm
        </h1>
        
        <div className="max-w-2xl mx-auto">
          {/* Open World Section */}
          <div style={sectionCardStyle}>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: theme.cardTitle }}>Open World</h2>
            <Link to="/reality" style={linkStyle}>
              Enter the World →
            </Link>
          </div>

          {/* Customization Section */}
          <div style={sectionCardStyle}>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: theme.cardTitle }}>Customization</h2>
            <Link to="/customize" style={linkStyle}>
              Customize Your Character →
            </Link>
          </div>

          {/* Monster Training Section */}
          <div style={sectionCardStyle}>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: theme.cardTitle }}>Monster Training</h2>
            <div className="space-y-2">
              <Link to="/monsters" style={linkStyle}>
                Manage Monsters →
              </Link>
              <Link to="/battle" style={linkStyle}>
                Battle Arena →
              </Link>
            </div>
          </div>

          {/* Factions Section */}
          <div style={sectionCardStyle}>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: theme.cardTitle }}>Factions</h2>
            <Link to="/factions" style={linkStyle}>
              Explore Factions →
            </Link>
          </div>
        </div>
      </div>

      {/* Premium Popup Modal */}
      {showPremiumPopup && (
        <Modal onClose={() => setShowPremiumPopup(false)} theme={theme}>
          <div className="text-center">
            <div className="text-4xl mb-4">🔒</div>
            <h2 className="text-2xl font-bold mb-4" style={{ color: theme.cardTitle }}>
              Premium Access Required
            </h2>
            <p className="text-lg mb-6" style={{ color: theme.cardText }}>
              You are not a premium user. Please go to the purchase page to buy an Eternal Pass and unlock full access to all features.
            </p>
            
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setShowPremiumPopup(false);
                  navigate('/purchase');
                }}
                className="px-6 py-3 rounded-lg font-semibold text-white transition-all duration-300 hover:scale-105"
                style={{
                  backgroundColor: '#FFD700',
                  color: '#1a1a1a',
                  boxShadow: '0 4px 15px rgba(255, 215, 0, 0.3)'
                }}
              >
                Get Premium Access
              </button>
              
              <button
                onClick={() => setShowPremiumPopup(false)}
                className="px-6 py-3 rounded-lg font-medium transition-all duration-300 hover:opacity-80"
                style={{
                  backgroundColor: 'transparent',
                  color: theme.cardText,
                  border: `1px solid ${theme.cardBorder}`
                }}
              >
                No thanks, I'm just looking for now
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default StartPage;
