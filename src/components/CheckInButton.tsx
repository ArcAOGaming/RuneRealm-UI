import React, { useState, useEffect } from 'react';
import { useWallet } from '../hooks/useWallet';
import { defaultInteraction, getUserOfferings, type OfferingData } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';

interface CheckInButtonProps {
  onOfferingComplete?: () => void;
}

const CheckInButton: React.FC<CheckInButtonProps> = ({ onOfferingComplete }) => {
  const { wallet, darkMode, triggerRefresh } = useWallet();
  const [isChecking, setIsChecking] = useState(false);
  const [offeringData, setOfferingData] = useState<OfferingData | null>(null);
  const [nextCheckIn, setNextCheckIn] = useState('');
  const theme = currentTheme(darkMode);

  // Get current day number since Unix epoch
  const getCurrentDay = () => {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    return Math.floor(Date.now() / MS_PER_DAY);
  };

  // Update next check-in time
  useEffect(() => {
    const updateNextCheckIn = () => {
      const now = new Date();
      const utcMidnight = new Date();
      utcMidnight.setUTCHours(24, 0, 0, 0);

      const diff = utcMidnight.getTime() - now.getTime();
      
      if (diff <= 0) {
        utcMidnight.setUTCDate(utcMidnight.getUTCDate() + 1);
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setNextCheckIn(`${hours}h ${minutes}m ${seconds}s`);
    };

    const timer = setInterval(updateNextCheckIn, 1000);
    updateNextCheckIn(); // Initial update

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const checkOfferingStatus = async () => {
      if (!wallet?.address) return;
      
      try {
        const response = await getUserOfferings(wallet.address);
        console.log('Offering data:', response);
        setOfferingData(response);
        
        if (response?.LastOffering) {
          const lastOfferingDay = response.LastOffering;
          const currentDay = getCurrentDay();
          const hasCheckedIn = lastOfferingDay === currentDay;
          
          console.log('Last offering day:', lastOfferingDay);
          console.log('Current day:', currentDay);
          console.log('Has checked in today:', hasCheckedIn);
        } else {
          console.log('No previous offering found');
        }
      } catch (error) {
        console.error('Error checking offering status:', error);
        setOfferingData(null);
      }
    };

    checkOfferingStatus();
  }, [wallet?.address]);

  const handleCheckIn = async () => {
    if (!wallet?.address) return;

    try {
      setIsChecking(true);
      console.log('Starting check-in process...');
      await defaultInteraction(wallet, triggerRefresh);
      console.log('Check-in completed successfully');
      if (onOfferingComplete) {
        onOfferingComplete();
      }
    } catch (error) {
      console.error('Error during check-in:', error);
    } finally {
      setIsChecking(false);
    }
  };

  // Calculate if user has checked in today based on LastOffering day number
  const hasCheckedToday = offeringData?.LastOffering ? (() => {
    const currentDay = getCurrentDay();
    return offeringData.LastOffering === currentDay;
  })() : false;

  // Streak display component
  const StreakDisplay = () => (
    <div className="flex items-center gap-1">
      <span className="font-bold">{offeringData?.Streak || 0}</span>
      <span className="text-xl">🔥</span>
    </div>
  );

  return (
    <div className="flex items-center gap-4">
      {hasCheckedToday ? (
        <div className="flex items-center gap-4">
          <span className={`${theme.text}`}>Next check in: {nextCheckIn}</span>
          <StreakDisplay />
        </div>
      ) : (
        <>
          <button
            onClick={handleCheckIn}
            disabled={isChecking}
            className={`px-6 py-3 rounded-lg transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} ${isChecking ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}`}
          >
            {isChecking ? 'Offering...' : 'Make Daily Offering'}
          </button>
          <StreakDisplay />
        </>
      )}
    </div>
  );
};

export default CheckInButton;
