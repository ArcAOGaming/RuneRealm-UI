import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { defaultInteraction, getUserOfferings, type OfferingData } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';

// Style for grow-shrink animation
const growShrinkStyle = {
  animation: 'growShrink 1.5s ease-in-out infinite',
  display: 'inline-block',
  transformOrigin: 'center'
};

// CSS keyframes are defined in global.css

// Cache key prefix - will be combined with wallet address
const OFFERING_CACHE_PREFIX = 'premium-rune-offering-data';
const CACHE_TIMESTAMP_PREFIX = 'premium-rune-offering-timestamp';

// Get wallet-specific cache keys
const getWalletCacheKeys = (walletAddress: string) => {
  return {
    offeringKey: `${OFFERING_CACHE_PREFIX}-${walletAddress}`,
    timestampKey: `${CACHE_TIMESTAMP_PREFIX}-${walletAddress}`
  };
};

interface CheckInButtonProps {
  onOfferingComplete?: () => void;
}

const CheckInButton: React.FC<CheckInButtonProps> = ({ onOfferingComplete }) => {
  const { wallet, darkMode, triggerRefresh } = useWallet();
  const [isChecking, setIsChecking] = useState(false);
  const [offeringData, setOfferingData] = useState<OfferingData | null>(null);
  const [nextCheckIn, setNextCheckIn] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const theme = currentTheme(darkMode);

  // Get current day number since Unix epoch
  const getCurrentDay = () => {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    return Math.floor(Date.now() / MS_PER_DAY);
  };

  // Check if cache is expired (after UTC midnight)
  const isCacheExpired = (walletAddress: string) => {
    if (!walletAddress) return true;
    
    const { timestampKey } = getWalletCacheKeys(walletAddress);
    const cacheTimestamp = localStorage.getItem(timestampKey);
    if (!cacheTimestamp) return true;
    
    // Get timestamp of next UTC midnight when the cache was created
    const cachedTime = parseInt(cacheTimestamp, 10);
    const cachedDate = new Date(cachedTime);
    const nextMidnight = new Date(cachedDate);
    nextMidnight.setUTCHours(24, 0, 0, 0);
    
    // If current time is past the next UTC midnight from when cache was set
    return Date.now() >= nextMidnight.getTime();
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

      setNextCheckIn({ hours, minutes, seconds });
    };

    const timer = setInterval(updateNextCheckIn, 1000);
    updateNextCheckIn(); // Initial update

    return () => clearInterval(timer);
  }, []);

  // Function to check offering status - extracted as a callback so it can be reused
  const checkOfferingStatus = useCallback(async () => {
    if (!wallet?.address) return;
    
    const { offeringKey, timestampKey } = getWalletCacheKeys(wallet.address);
    
    // Check if we have cached offering data that hasn't expired for this specific wallet
    const cachedData = localStorage.getItem(offeringKey);
    
    if (cachedData && !isCacheExpired(wallet.address)) {
      // Use cached data if it exists and hasn't expired
      try {
        const parsedData = JSON.parse(cachedData);
        console.log(`Using cached offering data for wallet ${wallet.address}:`, parsedData);
        setOfferingData(parsedData);
        return;
      } catch (e) {
        console.error('Error parsing cached offering data:', e);
        // Continue to fetch fresh data if parse fails
      }
    }
    
    // Fetch fresh data if cache is expired or doesn't exist
    try {
      const response = await getUserOfferings(wallet.address);
      console.log(`Fetched new offering data for wallet ${wallet.address}:`, response);
      setOfferingData(response);
      
      // Cache the new data with wallet-specific keys
      localStorage.setItem(offeringKey, JSON.stringify(response));
      localStorage.setItem(timestampKey, Date.now().toString());
    } catch (error) {
      console.error(`Error checking offering status for wallet ${wallet.address}:`, error);
      setOfferingData(null);
    }
  }, [wallet?.address]);

  // Effect to load offering status on component mount or wallet change
  useEffect(() => {
    checkOfferingStatus();
  }, [checkOfferingStatus]);

  const handleCheckIn = async () => {
    if (!wallet?.address) return;
    
    const { offeringKey, timestampKey } = getWalletCacheKeys(wallet.address);

    try {
      setIsChecking(true);
      console.log(`Starting check-in process for wallet ${wallet.address}...`);
      
      // Make sure to properly await the check-in interaction
      await defaultInteraction(wallet, triggerRefresh);
      console.log('Check-in completed successfully');
      
      // Update local cache after successful check-in
      const currentDay = getCurrentDay();
      const updatedData: OfferingData = {
        ...(offeringData || {}),
        LastOffering: currentDay,
        Streak: (offeringData?.Streak || 0) + 1
      } as OfferingData;
      
      setOfferingData(updatedData);
      
      // Store with wallet-specific keys
      localStorage.setItem(offeringKey, JSON.stringify(updatedData));
      localStorage.setItem(timestampKey, Date.now().toString());
      
      if (onOfferingComplete) {
        onOfferingComplete();
      }
      
      // Wait 0.5 seconds before refreshing data
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Refresh the offering data to show updated status
      await checkOfferingStatus();
    } catch (error) {
      console.error(`Error during check-in for wallet ${wallet.address}:`, error);
    } finally {
      setIsChecking(false);
    }
  };

  const hasCheckedToday = offeringData?.LastOffering ? (() => {
    const currentDay = getCurrentDay();
    return offeringData.LastOffering === currentDay;
  })() : false;

  const formatTimeUnit = (value: number) => value.toString().padStart(2, '0');

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${theme.container} border ${theme.border} backdrop-blur-md`}>
      {/* Streak Display */}
      <div className={`flex items-center gap-1 px-2 py-1 rounded-md bg-[#814E33]/20 border border-[#F4860A]/30`}>
        <span className={`text-sm font-bold ${theme.text}`}>{offeringData?.Streak || 0}</span>
        <span className="text-lg" style={growShrinkStyle}>🔥</span>
      </div>

      {hasCheckedToday ? (
        // Timer Display when checked in
        <div className="flex items-center gap-1">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-md bg-[#814E33]/20 border border-[#F4860A]/30`}>
            <span className={`text-sm font-mono ${theme.text}`}>
              {formatTimeUnit(nextCheckIn.hours)}:{formatTimeUnit(nextCheckIn.minutes)}:{formatTimeUnit(nextCheckIn.seconds)}
            </span>
          </div>
        </div>
      ) : (
        // Check-in Button when not checked in
        <button
          onClick={handleCheckIn}
          disabled={isChecking}
          className={`px-3 py-1 rounded-lg text-sm font-medium transition-all duration-300 
            relative overflow-hidden`}
          style={{
            backgroundColor: '#1a1a1a',
            color: '#FFD700',
            border: '2px solid #FFD700',
            boxShadow: '0 0 10px #FFD700, 0 0 20px #FFD700, inset 0 0 5px rgba(255, 215, 0, 0.3)',
            animation: 'pulseGold 2s infinite'
          }}
        >
          <div className="relative z-10 flex items-center gap-2">
            <span>{isChecking ? 'Offering...' : 'Daily Offering'}</span>
          </div>
          <div
            className="absolute inset-0 opacity-20"
            style={{
              background: 'linear-gradient(45deg, transparent, #FFD700, transparent)',
              backgroundSize: '200% 200%',
              animation: 'shimmerGold 3s linear infinite'
            }}
          />
          <style>
            {`
              @keyframes shimmerGold {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
              }
              @keyframes pulseGold {
                0%, 100% { box-shadow: 0 0 10px #FFD700, 0 0 20px #FFD700, inset 0 0 5px rgba(255, 215, 0, 0.3); }
                50% { box-shadow: 0 0 20px #FFD700, 0 0 35px #FFD700, inset 0 0 5px rgba(255, 215, 0, 0.4); }
              }
              button:hover {
                transform: scale(1.05);
                box-shadow: 0 0 25px #FFD700, 0 0 40px #FFD700, inset 0 0 5px rgba(255, 215, 0, 0.5);
              }
              button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                animation: none;
                box-shadow: none;
              }
            `}
          </style>
        </button>
      )}
    </div>
  );
};

export default CheckInButton;
