import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '../../hooks/useWallet';
import { getBattleManagerInfo, getActiveBattle, returnFromBattle, ActiveBattle } from '../../utils/aoHelpers';
import { currentTheme } from '../../constants/theme';
import Header from '../../components/Header';
import Footer from '../../components/Footer';
import { useNavigate } from 'react-router-dom';
import Loading from '../../components/Loading';

// Helper function to check if a battle participant has enough info to display
const isCompleteMonster = (participant: any): boolean => {
  return (
    participant &&
    typeof participant === 'object' &&
    'healthPoints' in participant &&
    'health' in participant &&
    'shield' in participant &&
    'defense' in participant &&
    'moves' in participant
  );
};

export const ActiveBattlePage = (): JSX.Element => {
  const { wallet, darkMode } = useWallet();
  const [activeBattle, setActiveBattle] = useState<ActiveBattle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();

  const updateBattleData = useCallback(async () => {
    if (!wallet?.address) return;
    
    try {
      console.log('[ActiveBattlePage] Checking for active battles...');
      const battles = await getActiveBattle(wallet.address);
      console.log('[ActiveBattlePage] Active battles:', battles);
      
      // Take the first battle from the array
      const battle = Array.isArray(battles) && battles.length > 0 ? battles[0] : null;
      setActiveBattle(battle);
      
      // If no active battle, redirect to battle hub
      if (!battle) {
        console.log('[ActiveBattlePage] No active battle found, redirecting to battle hub');
        navigate('/battle');
      }
    } catch (error) {
      console.error('Error loading active battle:', error);
    } finally {
      setIsLoading(false);
    }
  }, [wallet?.address, navigate]);

  useEffect(() => {
    updateBattleData();
    // Set up polling every 5 seconds
    const interval = setInterval(updateBattleData, 5000);
    return () => clearInterval(interval);
  }, [updateBattleData]);

  const handleReturnHome = async () => {
    if (!wallet?.address) return;
    try {
      setIsUpdating(true);
      await returnFromBattle(wallet);
      navigate('/battle');
    } catch (error) {
      console.error('Error returning from battle:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading darkMode={darkMode} />
      </div>
    );
  }

  if (!activeBattle) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl mb-4">No active battle found</p>
          <button
            onClick={() => navigate('/battle')}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Back to Battle Hub
          </button>
        </div>
      </div>
    );
  }

  const isChallenger = activeBattle.challenger?.address === wallet?.address;
  const isAccepter = activeBattle.accepter?.address === wallet?.address;
  const isBotBattle = activeBattle.challengeType === 'BOT';

  return (
    <div className="min-h-screen flex flex-col">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header theme={theme} darkMode={darkMode} />
        
        <div className={`container mx-auto px-6 py-8 flex-1 ${theme.text}`}>
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <button
                onClick={() => navigate('/battle')}
                className="flex items-center text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
              >
                <span className="mr-1">←</span> Back to Battle Hub
              </button>
              <h1 className="text-3xl font-bold mt-2">
                {isBotBattle ? 'Bot Battle' : 'Ranked Battle'}
              </h1>
              <div className="mt-1 text-gray-500 dark:text-gray-400">
                {isChallenger ? 'You are the challenger' : 'You are the accepter'}
                {isBotBattle ? ' (vs AI)' : ' (vs Player)'}
              </div>
            </div>

            {/* Battle Arena */}
            <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md mb-6`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Challenger Status */}
                <div className={`p-4 rounded-lg ${isChallenger ? 'ring-2 ring-blue-500' : ''}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">
                      {isChallenger ? 'You' : isBotBattle ? 'AI Opponent' : 'Opponent'}
                    </h3>
                    <span className="text-sm text-gray-500">
                      {isChallenger ? 'Challenger' : 'Accepter'}
                    </span>
                  </div>
                  
                  {isCompleteMonster(activeBattle.challenger) ? (
                    <>
                      <div className="mb-4">
                        <div className="flex justify-between text-sm mb-1">
                          <span>HP</span>
                          <span>
                            {activeBattle.challenger.healthPoints ?? (activeBattle.challenger.health * 10)}/
                            {activeBattle.challenger.health * 10}
                          </span>
                        </div>
                        <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-green-500 transition-all duration-500"
                            style={{ 
                              width: `${((activeBattle.challenger.healthPoints ?? (activeBattle.challenger.health * 10)) / (activeBattle.challenger.health * 10)) * 100}%`
                            }}
                          />
                        </div>
                      </div>
                      
                      <div className="mb-4">
                        <div className="flex justify-between text-sm mb-1">
                          <span>Shield</span>
                          <span>
                            {activeBattle.challenger.shield ?? 0}/{activeBattle.challenger.defense}
                          </span>
                        </div>
                        <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 transition-all duration-500"
                            style={{ 
                              width: `${((activeBattle.challenger.shield ?? 0) / activeBattle.challenger.defense) * 100}%`
                            }}
                          />
                        </div>
                      </div>
                      
                      <div className="mt-6">
                        <h4 className="text-sm font-medium mb-2">Moves:</h4>
                        <div className="grid grid-cols-2 gap-2">
                          {activeBattle.challenger.moves?.map((move: any, index: number) => (
                            <div 
                              key={index}
                              className={`p-2 text-sm rounded border ${theme.border} bg-opacity-50 ${theme.container}`}
                            >
                              <div className="font-medium">{move.name}</div>
                              <div className="text-xs text-gray-500">
                                Power: {move.power} | Type: {move.type}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4 text-gray-500">
                      Loading challenger data...
                    </div>
                  )}
                </div>

                {/* Accepter Status */}
                {activeBattle.accepter && (
                  <div className={`p-4 rounded-lg ${isAccepter ? 'ring-2 ring-blue-500' : ''}`}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">
                        {isAccepter ? 'You' : isBotBattle ? 'AI Opponent' : 'Opponent'}
                      </h3>
                      <span className="text-sm text-gray-500">
                        {isAccepter ? 'Accepter' : 'Challenger'}
                      </span>
                    </div>
                    
                    {isCompleteMonster(activeBattle.accepter) ? (
                      <>
                        <div className="mb-4">
                          <div className="flex justify-between text-sm mb-1">
                            <span>HP</span>
                            <span>
                              {activeBattle.accepter.healthPoints ?? (activeBattle.accepter.health * 10)}/
                              {activeBattle.accepter.health * 10}
                            </span>
                          </div>
                          <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-green-500 transition-all duration-500"
                              style={{ 
                                width: `${((activeBattle.accepter.healthPoints ?? (activeBattle.accepter.health * 10)) / (activeBattle.accepter.health * 10)) * 100}%`
                              }}
                            />
                          </div>
                        </div>
                        
                        <div className="mb-4">
                          <div className="flex justify-between text-sm mb-1">
                            <span>Shield</span>
                            <span>
                              {activeBattle.accepter.shield ?? 0}/{activeBattle.accepter.defense}
                            </span>
                          </div>
                          <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-blue-500 transition-all duration-500"
                              style={{ 
                                width: `${((activeBattle.accepter.shield ?? 0) / activeBattle.accepter.defense) * 100}%`
                              }}
                            />
                          </div>
                        </div>
                        
                        <div className="mt-6">
                          <h4 className="text-sm font-medium mb-2">Moves:</h4>
                          <div className="grid grid-cols-2 gap-2">
                            {activeBattle.accepter.moves?.map((move: any, index: number) => (
                              <div 
                                key={index}
                                className={`p-2 text-sm rounded border ${theme.border} bg-opacity-50 ${theme.container}`}
                              >
                                <div className="font-medium">{move.name}</div>
                                <div className="text-xs text-gray-500">
                                  Power: {move.power} | Type: {move.type}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-4 text-gray-500">
                        Loading accepter data...
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Battle Controls */}
              <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold mb-4">Battle Controls</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    className={`px-4 py-3 rounded-lg font-bold text-white bg-red-500 hover:bg-red-600 transition-colors`}
                    disabled={isUpdating}
                  >
                    Attack
                  </button>
                  <button
                    className={`px-4 py-3 rounded-lg font-bold text-white bg-blue-500 hover:bg-blue-600 transition-colors`}
                    disabled={isUpdating}
                  >
                    Defend
                  </button>
                  <button
                    onClick={handleReturnHome}
                    className={`px-4 py-3 rounded-lg font-bold border ${theme.border} hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors`}
                    disabled={isUpdating}
                  >
                    {isUpdating ? 'Leaving...' : 'Forfeit Battle'}
                  </button>
                </div>
              </div>
            </div>

            {/* Battle Log */}
            <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
              <h3 className="text-lg font-semibold mb-4">Battle Log</h3>
              <div className="h-48 overflow-y-auto p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                {activeBattle.battleLog?.length > 0 ? (
                  <div className="space-y-2">
                    {activeBattle.battleLog.map((log: string, index: number) => (
                      <div key={index} className="text-sm p-2 bg-white dark:bg-gray-700 rounded">
                        {log}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 h-full flex items-center justify-center">
                    <p>Battle log will appear here</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};

export default ActiveBattlePage;
