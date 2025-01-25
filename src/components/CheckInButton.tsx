import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { defaultInteraction } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';

const CheckInButton: React.FC = () => {
  const { wallet, darkMode } = useWallet();
  const [isChecking, setIsChecking] = useState(false);
  const theme = currentTheme(darkMode);

  const handleCheckIn = async () => {
    if (!wallet?.address) return;

    try {
      setIsChecking(true);
      await defaultInteraction(wallet);
    } catch (error) {
      console.error('Error during check-in:', error);
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <button
      onClick={handleCheckIn}
      disabled={isChecking}
      className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} ${isChecking ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {isChecking ? 'Checking In...' : 'Daily Check-in'}
    </button>
  );
};

export default CheckInButton;
