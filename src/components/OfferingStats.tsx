import React, { useEffect, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getTotalOfferings, getUserOfferings, OfferingStats as OfferingStatsType } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';

const OfferingStats: React.FC = () => {
  const { wallet, darkMode } = useWallet();
  const [totalOfferings, setTotalOfferings] = useState<OfferingStatsType | null>(null);
  const [userOfferings, setUserOfferings] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const theme = currentTheme(darkMode);

  useEffect(() => {
    const loadStats = async () => {
      try {
        setIsLoading(true);
        const [total, user] = await Promise.all([
          getTotalOfferings(),
          wallet?.address ? getUserOfferings(wallet.address) : Promise.resolve(null)
        ]);
        setTotalOfferings(total);
        setUserOfferings(user);
      } catch (error) {
        console.error('Error loading offering stats:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadStats();
  }, [wallet?.address]);

  if (isLoading) {
    return (
      <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
        <p className={`${theme.text} text-center`}>Loading stats...</p>
      </div>
    );
  }

  return (
    <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
      <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>Offering Statistics</h2>
      
      {wallet?.address && userOfferings !== null && (
        <div className="mb-6">
          <h3 className={`text-lg font-bold mb-2 ${theme.text}`}>Your Offerings</h3>
          <p className={`${theme.text}`}>Total Check-ins: {userOfferings}</p>
        </div>
      )}

      {totalOfferings && (
        <div>
          <h3 className={`text-lg font-bold mb-2 ${theme.text}`}>Faction Totals</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(totalOfferings).map(([faction, count]) => (
              <div key={faction} className={`p-4 rounded-lg ${theme.container} border ${theme.border}`}>
                <h4 className={`font-bold ${theme.text}`}>{faction}</h4>
                <p className={`${theme.text}`}>{count} offerings</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default OfferingStats;
