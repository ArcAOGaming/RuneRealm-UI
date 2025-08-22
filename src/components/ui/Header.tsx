import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentTheme, Theme } from '../../constants/theme';
import { useWallet } from '../../contexts/WalletContext';
import CheckInButton from '../faction/CheckInButton';
import CopyReferralLink from '../faction/CopyReferralLink';
import SettingsModal from './SettingsModal';

interface HeaderProps {
  theme: Theme;
  darkMode: boolean;
  showBackButton?: boolean;
  onDarkModeToggle?: () => void;
}

const Header: React.FC<HeaderProps> = ({
  theme,
  darkMode,
  showBackButton = true,
  onDarkModeToggle,
}) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const { wallet, walletStatus, isCheckingStatus, connectWallet } = useWallet();
  // Use cached wallet status
  const isConnected = !!wallet?.address;
  const handleConnect = async () => {
    if (!isConnected) {
      await connectWallet(true); // Force check on initial connect
    } else {
      await connectWallet(); // Use cached status if already connected
    }
  };
  
  return (
    <div className={`flex items-center px-4 py-4 ${theme.container} border-b ${theme.border} relative flex-shrink-0`}>
      {/* Left side - either back button or empty div for spacing */}
      <div className="flex-1 flex items-center">
        {showBackButton && (
          <button
            onClick={() => navigate('/')}
            className={`px-6 py-3 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} rounded-xl border ${theme.border} transition-all duration-300 hover:scale-105`}
          >
            ← Back 
          </button>
        )}
      </div>

      {/* Center logo */}
      <div className="flex-1 flex justify-center">
        <img 
          src={new URL('../../assets/rune-realm-transparent.png', import.meta.url).href} 
          alt="Rune Realm Logo" 
          className="h-20 w-auto" 
        />
      </div>

      {/* Right side */}
      <div className="flex-1 flex items-center justify-end gap-3">
        {/* Show CheckInButton only for premium users */}
        {isConnected && walletStatus?.isUnlocked && !isCheckingStatus && (
          <div className="flex items-center">
            <CheckInButton />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleConnect}
            className={`px-4 py-2 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} rounded-xl border ${theme.border} transition-all duration-300 hover:scale-105 text-sm`}
          >
            {!isConnected ? (
              'Connect Wallet'
            ) : isCheckingStatus ? (
              <span>Loading...</span>
            ) : walletStatus?.isUnlocked ? (
              <span>Premium User</span>
            ) : (
              <span>Basic User</span>
            )}
          </button>
          {isConnected && (
            <CopyReferralLink theme={theme} />
          )}
        </div>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className={`px-4 py-3 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} rounded-xl border ${theme.border} transition-all duration-300 hover:scale-105`}
        >
          <span className="text-lg">⚙️</span>
        </button>
      </div>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
};

export default Header;
