import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBattleStatus } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';

interface BattleStatus {
  battlesRemaining: number;
  wins: number;
  losses: number;
  startTime: number;
}

interface Props {
  walletAddress?: string;
  darkMode: boolean;
}

export const BattleStatusComponent: React.FC<Props> = ({ walletAddress, darkMode }) => {
  const [battleStatus, setBattleStatus] = useState<BattleStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();

  useEffect(() => {
    const loadBattleStatus = async () => {
      if (!walletAddress) return;

      try {
        setIsLoading(true);
        const status = await getBattleStatus(walletAddress);
        setBattleStatus(status);
      } catch (error) {
        console.error('Error loading battle status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadBattleStatus();
    // Refresh every 30 seconds
    const interval = setInterval(loadBattleStatus, 30000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  const formatTimeAgo = (timestamp: number) => {
    // Convert from microseconds to milliseconds
    const milliseconds = Math.floor(timestamp / 1000);
    const seconds = Math.floor((Date.now() - milliseconds) / 1000);
    
    if (seconds < 60) return `${seconds} seconds ago`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    
    const days = Math.floor(hours / 24);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  };

  if (!walletAddress) return null;
  
  if (isLoading) {
    return (
      <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
        <div className="animate-pulse flex space-x-4">
          <div className="flex-1 space-y-4">
            <div className="h-4 bg-gray-300 rounded w-3/4"></div>
            <div className="h-4 bg-gray-300 rounded w-1/2"></div>
            <div className="h-4 bg-gray-300 rounded w-2/3"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!battleStatus) {
    return (
      <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md text-center`}>
        <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>No Active Battles</h2>
        <p className={`mb-4 ${theme.text}`}>You don't have any active battles or battle sessions.</p>
        <p className={`mb-6 ${theme.text}`}>Visit the Monsters page to select a monster and start battling!</p>
        <button
          onClick={() => navigate('/monsters')}
          className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
        >
          Go to Monsters
        </button>
      </div>
    );
  }

  return (
    <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
      <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>Active Battle Session</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Battle Stats */}
        <div>
          <div className="space-y-4">
            <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container}`}>
              <span className="font-semibold">Battles Remaining:</span> {battleStatus.battlesRemaining}
            </div>
            <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container}`}>
              <span className="font-semibold">Win Rate:</span>{' '}
              {((battleStatus.wins / (battleStatus.wins + battleStatus.losses)) * 100).toFixed(1)}%
            </div>
            <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container}`}>
              <span className="font-semibold">Record:</span>{' '}
              {battleStatus.wins}W - {battleStatus.losses}L
            </div>
          </div>
        </div>

        {/* Battle Progress */}
        <div>
          <div className="relative pt-1">
            <div className="flex mb-2 items-center justify-between">
              <div>
                <span className={`text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full ${theme.text} bg-opacity-20 ${theme.container}`}>
                  Battles Used
                </span>
              </div>
              <div className={`text-right ${theme.text}`}>
                <span className="text-xs font-semibold inline-block">
                  {4 - battleStatus.battlesRemaining}/4
                </span>
              </div>
            </div>
            <div className="flex h-2 mb-4 overflow-hidden rounded bg-gray-200">
              <div
                style={{ width: `${((4 - battleStatus.battlesRemaining) / 4) * 100}%` }}
                className="bg-blue-500 transition-all duration-500"
              ></div>
            </div>
          </div>
          <div className={`${theme.text} text-center mt-4`}>
            Started {formatTimeAgo(battleStatus.startTime)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BattleStatusComponent;
