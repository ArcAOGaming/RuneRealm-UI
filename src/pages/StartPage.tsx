import React from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../contexts/WalletContext';
import Header from '../components/Header';
import { currentTheme, Theme } from '../constants/theme';

const StartPage: React.FC = () => {
  const { wallet, walletStatus, darkMode } = useWallet();
  const theme = currentTheme(darkMode);

  if (!wallet?.address || !walletStatus?.isUnlocked) {
    return (
      <div className={`min-h-screen ${theme.bg}`}>
        <Header theme={theme} darkMode={darkMode} />
        <div className="container mx-auto px-4 py-8 text-center">
          <h1 className="text-3xl font-bold mb-6" style={{ color: theme.cardTitle }}>
            Welcome to Rune Realm
          </h1>
          <p className="text-lg mb-8" style={{ color: theme.cardText }}>
            Please connect your wallet to continue
          </p>
        </div>
      </div>
    );
  }

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
    </div>
  );
};

export default StartPage;
