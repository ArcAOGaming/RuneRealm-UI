import React, { useEffect, useState, useCallback } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getBattleManagerInfo, getActiveBattle, enterBattle, returnFromBattle, BattleManagerInfo, ActiveBattle } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Loading from '../components/Loading';
import { useNavigate } from 'react-router-dom';

// Popup component for battle transitions
const BattlePopup: React.FC<{
  type: 'start' | 'end';
  winner?: 'player' | 'opponent';
  stats?: { wins: number; losses: number };
  onClose: () => void;
}> = ({ type, winner, stats, onClose }): JSX.Element => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center z-50 bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg text-center transform scale-100 animate-bounce">
        {type === 'start' ? (
          <div className="text-2xl font-bold text-blue-600">Battle Start!</div>
        ) : (
          <div>
            <div className="text-2xl font-bold mb-4">
              {winner === 'player' ? (
                <span className="text-green-500">Victory!</span>
              ) : (
                <span className="text-red-500">Defeat!</span>
              )}
            </div>
            {stats && (
              <div className="text-gray-600 dark:text-gray-300">
                <div>Wins: {stats.wins}</div>
                <div>Losses: {stats.losses}</div>
                <div>Win Rate: {((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)}%</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const BattlePage: React.FC = (): JSX.Element => {
  const { wallet, darkMode, setDarkMode } = useWallet();
  const [battleManagerInfo, setBattleManagerInfo] = useState<BattleManagerInfo | null>(null);
  const [activeBattle, setActiveBattle] = useState<ActiveBattle | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();

  const updateBattleData = useCallback(async () => {
    if (!wallet?.address) return;
    
    try {
      if (!initialLoading) {
        setIsUpdating(true);
      }
      console.log('[BattlePage] Checking battle manager info...');
      const info = await getBattleManagerInfo(wallet.address);
      console.log('[BattlePage] Battle manager info:', info);
      setBattleManagerInfo(info);

      // Only check for active battles if we have battles remaining
      if (info && info.battlesRemaining > 0) {
        console.log('[BattlePage] Checking for active battles...');
        const battle = await getActiveBattle(wallet.address);
        console.log('[BattlePage] Active battle query result:', battle);
        setActiveBattle(battle);
      } else {
        setActiveBattle(null);
      }
    } catch (error) {
      console.error('Error loading battle status:', error);
    } finally {
      setInitialLoading(false);
      setIsUpdating(false);
    }
  }, [wallet?.address]);

  useEffect(() => {
    updateBattleData();
    // Update more frequently (every 5 seconds) to ensure we don't miss battle state changes
    const interval = setInterval(updateBattleData, 5000);
    return () => clearInterval(interval);
  }, [updateBattleData]);

  const handleStartNewBattle = async () => {
    if (!wallet?.address) return;
    try {
      setIsUpdating(true);
      const response = await enterBattle(wallet);
      if (response.status === 'success' && response.data) {
        navigate('/battle/active');
      }
    } catch (error) {
      console.error('Error starting battle:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleJoinBattle = () => {
    navigate('/battle/active');
  };

  const handleReturnHome = async () => {
    if (!wallet?.address) return;
    try {
      setIsUpdating(true);
      await returnFromBattle(wallet);
      navigate('/');
    } catch (error) {
      console.error('Error returning from battle:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header
          theme={theme}
          darkMode={darkMode}
          onDarkModeToggle={() => setDarkMode(!darkMode)}
        />
        
        <div className={`container mx-auto px-6 py-8 flex-1 ${theme.text}`}>
          <div className="max-w-4xl mx-auto">
            {!wallet?.address ? (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md text-center`}>
                <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>Connect Wallet</h2>
                <p className={`mb-4 ${theme.text}`}>Please connect your wallet to view battle status.</p>
              </div>
            ) : initialLoading ? (
              <div className="flex justify-center items-center py-12">
                <Loading darkMode={darkMode} />
              </div>
            ) : !battleManagerInfo ? (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md text-center`}>
                <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>No Battle Status</h2>
                <p className={`mb-4 ${theme.text}`}>You need to send your monster to battle first.</p>
                <button
                  onClick={() => navigate('/monsters')}
                  className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                >
                  Go to Monsters
                </button>
              </div>
            ) : (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md transition-all duration-300`}>
                <h2 className={`text-2xl font-bold mb-6 ${theme.text}`}>Battle Manager</h2>
                
                {/* Active Battle Status */}
                <div className="mb-6 transition-opacity duration-300">
                  {activeBattle ? (
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 mb-4`}>
                      <h3 className={`text-lg font-bold mb-4 ${theme.text}`}>Active Battle Available</h3>
                      <div className="grid grid-cols-2 gap-6">
                        {/* Player Status */}
                        <div className="space-y-3">
                          <div className="flex items-center space-x-2">
                            <span className="text-xl">🦾</span>
                            <p className="font-semibold">Your Monster</p>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <div className="flex justify-between text-sm mb-1">
                                <span>HP</span>
                                <span>{activeBattle.player.healthPoints}/{activeBattle.player.health * 10}</span>
                              </div>
                              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-green-500 transition-all duration-500"
                                  style={{ 
                                    width: `${(activeBattle.player.healthPoints / (activeBattle.player.health * 10)) * 100}%` 
                                  }}
                                />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-sm mb-1">
                                <span>Shield</span>
                                <span>{activeBattle.player.shield}/{activeBattle.player.defense}</span>
                              </div>
                              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-blue-500 transition-all duration-500"
                                  style={{ 
                                    width: `${(activeBattle.player.shield / activeBattle.player.defense) * 100}%` 
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Opponent Status */}
                        <div className="space-y-3">
                          <div className="flex items-center space-x-2">
                            <span className="text-xl">👾</span>
                            <p className="font-semibold">Opponent</p>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <div className="flex justify-between text-sm mb-1">
                                <span>HP</span>
                                <span>{activeBattle.opponent.healthPoints}/{activeBattle.opponent.health * 10}</span>
                              </div>
                              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-red-500 transition-all duration-500"
                                  style={{ 
                                    width: `${(activeBattle.opponent.healthPoints / (activeBattle.opponent.health * 10)) * 100}%` 
                                  }}
                                />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-sm mb-1">
                                <span>Shield</span>
                                <span>{activeBattle.opponent.shield}/{activeBattle.opponent.defense}</span>
                              </div>
                              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-blue-500 transition-all duration-500"
                                  style={{ 
                                    width: `${(activeBattle.opponent.shield / activeBattle.opponent.defense) * 100}%` 
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={handleJoinBattle}
                        className={`w-full mt-6 px-6 py-3 rounded-lg font-bold transition-all duration-300 bg-blue-500 hover:bg-blue-600 text-white`}
                      >
                        Join Active Battle
                      </button>
                    </div>
                  ) : battleManagerInfo.battlesRemaining > 0 ? (
                    <div className="text-center mb-6">
                      <p className={`mb-4 ${theme.text}`}>No active battles. Start a new one?</p>
                      <button
                        onClick={handleStartNewBattle}
                        className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 bg-green-500 hover:bg-green-600 text-white`}
                      >
                        Start New Battle
                      </button>
                    </div>
                  ) : (
                    <div className="text-center mb-6">
                      <p className={`mb-4 ${theme.text}`}>No battles remaining in current session.</p>
                    </div>
                  )}
                </div>

                {/* Return Home Button */}
                <div className="mt-6 mb-6 text-center">
                  <button
                    onClick={handleReturnHome}
                    className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                    disabled={isUpdating}
                  >
                    Return Home
                  </button>
                </div>

                {/* Session Stats */}
                <div className="mt-6">
                  <h3 className={`text-lg font-bold mb-4 ${theme.text}`}>Session Stats</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 transition-all duration-300`}>
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="text-xl">🎮</span>
                        <p className="font-semibold">Battles Left</p>
                      </div>
                      <p className="text-2xl transition-all duration-300">{battleManagerInfo.battlesRemaining}</p>
                    </div>
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 transition-all duration-300`}>
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="text-xl">🏆</span>
                        <p className="font-semibold">Wins</p>
                      </div>
                      <p className="text-2xl text-green-500 transition-all duration-300">{battleManagerInfo.wins}</p>
                    </div>
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 transition-all duration-300`}>
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="text-xl">💔</span>
                        <p className="font-semibold">Losses</p>
                      </div>
                      <p className="text-2xl text-red-500 transition-all duration-300">{battleManagerInfo.losses}</p>
                    </div>
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 transition-all duration-300`}>
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="text-xl">📊</span>
                        <p className="font-semibold">Win Rate</p>
                      </div>
                      <p className="text-2xl transition-all duration-300">
                        {((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};

export default BattlePage;
