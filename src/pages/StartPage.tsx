import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWallet } from '../contexts/WalletContext';
import Header from '../components/ui/Header';
import Modal from '../components/ui/Modal';
import { currentTheme, Theme } from '../constants/theme';
import runeRealmLogo from '../assets/rune-realm-transparent.png';

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

  const menuButtonStyle: React.CSSProperties = {
    background: darkMode 
      ? `linear-gradient(135deg, rgba(129, 78, 51, 0.3) 0%, rgba(244, 134, 10, 0.2) 100%)`
      : `linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(244, 134, 10, 0.1) 100%)`,
    border: `2px solid ${theme.cardAccent}`,
    borderRadius: '15px',
    padding: '1.2rem 1.5rem',
    margin: '0.5rem',
    color: theme.cardTitle,
    textDecoration: 'none',
    fontWeight: 'bold',
    fontSize: '1.1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: darkMode 
      ? `0 8px 25px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(244, 134, 10, 0.2)`
      : `0 8px 25px rgba(129, 78, 51, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.8)`,
    position: 'relative',
    overflow: 'hidden',
    backdropFilter: 'blur(10px)',
  };

  const heroSectionStyle: React.CSSProperties = {
    background: darkMode 
      ? `linear-gradient(135deg, #1a0f0a 0%, #2a1912 50%, #0d0705 100%)`
      : `linear-gradient(135deg, #fcf5d8 0%, #f4e4c1 50%, #e8d4b4 100%)`,
    borderRadius: '20px',
    padding: '2rem 1.5rem',
    marginBottom: '1.5rem',
    textAlign: 'center',
    position: 'relative',
    overflow: 'hidden',
    boxShadow: darkMode 
      ? '0 20px 40px rgba(0, 0, 0, 0.6)'
      : '0 20px 40px rgba(129, 78, 51, 0.3)',
    border: `2px solid ${theme.cardBorder}`,
  };

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${theme.bg}`} style={{ 
      background: darkMode 
        ? `linear-gradient(135deg, #1a0f0a 0%, #2a1912 50%, #0d0705 100%)`
        : `linear-gradient(135deg, #fcf5d8 0%, #f4e4c1 50%, #e8d4b4 100%)`,
      position: 'relative'
    }}>
      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full opacity-20 animate-pulse"
            style={{
              width: Math.random() * 4 + 2 + 'px',
              height: Math.random() * 4 + 2 + 'px',
              left: Math.random() * 100 + '%',
              top: Math.random() * 100 + '%',
              backgroundColor: theme.cardAccent,
              animationDelay: Math.random() * 2 + 's',
              animationDuration: (Math.random() * 3 + 2) + 's'
            }}
          />
        ))}
      </div>

      <Header theme={theme} darkMode={darkMode} />
      
      <div className="flex-1 container mx-auto px-4 py-4 relative z-10 flex flex-col overflow-hidden">
        {/* Hero Section */}
        <div style={heroSectionStyle} className="flex-shrink-0">
          <div className="absolute inset-0 rounded-20" style={{
            background: darkMode 
              ? 'linear-gradient(to right, rgba(244, 134, 10, 0.1), rgba(147, 51, 234, 0.1))'
              : 'linear-gradient(to right, rgba(129, 78, 51, 0.2), rgba(244, 134, 10, 0.2))'
          }}></div>
          <div className="relative z-10">
            <img 
              src={runeRealmLogo} 
              alt="Rune Realm" 
              className="mx-auto mb-4 max-w-[200px] md:max-w-[300px] drop-shadow-2xl"
              style={{ 
                filter: darkMode 
                  ? 'drop-shadow(0 0 20px rgba(244, 134, 10, 0.5))'
                  : 'drop-shadow(0 0 20px rgba(129, 78, 51, 0.5))'
              }}
            />
            <h1 className="text-xl md:text-2xl font-bold mb-3" style={{
              color: theme.cardTitle,
              textShadow: darkMode ? '2px 2px 4px rgba(0,0,0,0.8)' : '2px 2px 4px rgba(0,0,0,0.3)'
            }}>
              Enter the Realm of Endless Adventure
            </h1>
            <p className="text-sm md:text-base opacity-90 max-w-2xl mx-auto" style={{ color: theme.cardText }}>
              Forge your destiny, battle legendary creatures, and join powerful factions
            </p>
          </div>
        </div>

        {/* Game Menu Grid */}
        <div className="flex-1 w-full px-4 grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto pb-4">
          {/* Open World */}
          <Link 
            to="/reality" 
            style={menuButtonStyle}
            className="group hover:shadow-2xl hover:border-blue-400"
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.boxShadow = darkMode 
                ? '0 15px 35px rgba(59, 130, 246, 0.4)'
                : '0 15px 35px rgba(59, 130, 246, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = darkMode 
                ? '0 8px 25px rgba(0, 0, 0, 0.4)'
                : '0 8px 25px rgba(129, 78, 51, 0.2)';
            }}
          >
            <div className="flex items-center">
              <div className="text-2xl mr-3">🌍</div>
              <div>
                <div className="font-bold text-lg">Open World</div>
                <div className="text-sm opacity-75">Explore the vast realm</div>
              </div>
            </div>
            <div className="text-xl group-hover:translate-x-2 transition-transform">→</div>
          </Link>

          {/* Customization */}
          <Link 
            to="/customize" 
            style={menuButtonStyle}
            className="group hover:shadow-2xl hover:border-green-400"
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.boxShadow = darkMode 
                ? '0 15px 35px rgba(147, 51, 234, 0.4)'
                : '0 15px 35px rgba(147, 51, 234, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = darkMode 
                ? '0 8px 25px rgba(0, 0, 0, 0.4)'
                : '0 8px 25px rgba(129, 78, 51, 0.2)';
            }}
          >
            <div className="flex items-center">
              <div className="text-2xl mr-3">⚔️</div>
              <div>
                <div className="font-bold text-lg">Customization</div>
                <div className="text-sm opacity-75">Forge your character</div>
              </div>
            </div>
            <div className="text-xl group-hover:translate-x-2 transition-transform">→</div>
          </Link>

          {/* Monster Management */}
          <Link 
            to="/monsters" 
            style={menuButtonStyle}
            className="group hover:shadow-2xl hover:border-red-400"
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.boxShadow = darkMode 
                ? '0 15px 35px rgba(239, 68, 68, 0.4)'
                : '0 15px 35px rgba(239, 68, 68, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = darkMode 
                ? '0 8px 25px rgba(0, 0, 0, 0.4)'
                : '0 8px 25px rgba(129, 78, 51, 0.2)';
            }}
          >
            <div className="flex items-center">
              <div className="text-2xl mr-3">🐉</div>
              <div>
                <div className="font-bold text-lg">Monster Training</div>
                <div className="text-sm opacity-75">Train your companions</div>
              </div>
            </div>
            <div className="text-xl group-hover:translate-x-2 transition-transform">→</div>
          </Link>

          {/* Battle Arena */}
          <Link 
            to="/battle" 
            style={menuButtonStyle}
            className="group hover:shadow-2xl hover:border-orange-400"
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.boxShadow = darkMode 
                ? '0 15px 35px rgba(251, 146, 60, 0.4)'
                : '0 15px 35px rgba(251, 146, 60, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = darkMode 
                ? '0 8px 25px rgba(0, 0, 0, 0.4)'
                : '0 8px 25px rgba(129, 78, 51, 0.2)';
            }}
          >
            <div className="flex items-center">
              <div className="text-2xl mr-3">⚡</div>
              <div>
                <div className="font-bold text-lg">Battle Arena</div>
                <div className="text-sm opacity-75">Test your might</div>
              </div>
            </div>
            <div className="text-xl group-hover:translate-x-2 transition-transform">→</div>
          </Link>

          {/* Factions - Spans both columns */}
          <div className="md:col-span-2">
            <Link 
              to="/factions" 
              style={{
                ...menuButtonStyle,
                background: darkMode 
                  ? `linear-gradient(135deg, rgba(147, 51, 234, 0.3) 0%, rgba(244, 134, 10, 0.2) 100%)`
                  : `linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(147, 51, 234, 0.1) 100%)`,
                border: `2px solid ${theme.purple}`,
              }}
              className="group hover:shadow-2xl hover:border-purple-400 w-full"
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px)';
                e.currentTarget.style.boxShadow = darkMode 
                  ? '0 15px 35px rgba(147, 51, 234, 0.4)'
                  : '0 15px 35px rgba(147, 51, 234, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = darkMode 
                  ? '0 8px 25px rgba(0, 0, 0, 0.4)'
                  : '0 8px 25px rgba(129, 78, 51, 0.2)';
              }}
            >
              <div className="flex items-center">
                <div className="text-2xl mr-4">🏰</div>
                <div>
                  <div className="font-bold text-lg">Factions</div>
                  <div className="text-sm opacity-75">Join legendary guilds and compete for glory</div>
                </div>
              </div>
              <div className="text-xl group-hover:translate-x-2 transition-transform">→</div>
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
