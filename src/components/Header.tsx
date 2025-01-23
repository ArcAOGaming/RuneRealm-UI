import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Theme } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';

interface HeaderProps {
  theme: Theme;
  darkMode: boolean;
  showBackButton?: boolean;
  onDarkModeToggle: () => void;
}

const Header: React.FC<HeaderProps> = ({
  theme,
  darkMode,
  showBackButton = true,
  onDarkModeToggle,
}) => {
  const navigate = useNavigate();
  const { wallet, walletStatus, isCheckingStatus, connectWallet } = useWallet();

  const isConnected = !!wallet;
  
  return (
    <div className={`flex items-center px-4 py-4 ${theme.container} border-b ${theme.border} relative flex-shrink-0`}>
      {/* Left side - either back button or empty div for spacing */}
      <div className="flex-1 flex items-center">
        {showBackButton && (
          <button
            onClick={() => navigate('/')}
            className={`px-6 py-3 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} rounded-xl border ${theme.border} transition-all duration-300 hover:scale-105`}
          >
            ← Back to Main Page
          </button>
        )}
      </div>

      {/* Center logo */}
      <div className="flex-1 flex justify-center">
        <img 
          src={new URL('../assets/rune-realm-transparent.png', import.meta.url).href} 
          alt="Rune Realm Logo" 
          className="h-20 w-auto" 
        />
      </div>

      {/* Right side */}
      <div className="flex-1 flex items-center justify-end gap-3">
        <button
          onClick={connectWallet}
          className={`px-6 py-3 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} rounded-xl border ${theme.border} transition-all duration-300 hover:scale-105`}
        >
          {!isConnected ? (
            'Connect Wallet'
          ) : isCheckingStatus ? (
            <span>Connected (Loading...)</span>
          ) : (
            <span>Connected {walletStatus?.isUnlocked ? '(Premium User)' : '(Basic User)'}</span>
          )}
        </button>
        <button
          onClick={onDarkModeToggle}
          className={`px-4 py-3 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} rounded-xl border ${theme.border} transition-all duration-300 hover:scale-105`}
        >
          <span className="text-lg">{darkMode ? '☀️' : '🌙'}</span>
        </button>
      </div>
    </div>
  );
};

export default Header;
