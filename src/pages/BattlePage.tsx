import React, { useEffect, useState, useCallback } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getBattleStatus, getActiveBattle, enterBattle, executeAttack, returnFromBattle, BattleStatus, ActiveBattle, BattleResponse, BattleResult } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Loading from '../components/Loading';
import { useNavigate } from 'react-router-dom';

export const BattlePage: React.FC = (): JSX.Element => {
  const { wallet, darkMode, setDarkMode } = useWallet();
  const [battleStatus, setBattleStatus] = useState<BattleStatus | null>(null);
  const [activeBattle, setActiveBattle] = useState<ActiveBattle | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();

  const updateBattleData = useCallback(async () => {
    if (!wallet?.address) return;
    
    try {
      console.log('[BattlePage] Checking for active battles...');
      const battle = await getActiveBattle(wallet.address);
      console.log('[BattlePage] Active battle query result:', battle);
      
      if (battle) {
        console.log('[BattlePage] Found active battle:', {
          id: battle.id,
          player: {
            healthPoints: battle.player.healthPoints,
            shield: battle.player.shield
          },
          opponent: {
            healthPoints: battle.opponent.healthPoints,
            shield: battle.opponent.shield
          },
          turns: battle.turns.length
        });
        // If there's an active battle, get the battle status separately
        setActiveBattle(battle);
        const status = await getBattleStatus(wallet.address);
        if (status) {
          console.log('[BattlePage] Battle status:', status);
          setBattleStatus(status);
        }
        return;
      }

      // If no active battle, check for battle status
      const status = await getBattleStatus(wallet.address);
      if (status) {
        setBattleStatus(status);
        setActiveBattle(null);
        return;
      }

      // If neither exists, clear both
      setBattleStatus(null);
      setActiveBattle(null);
    } catch (error) {
      console.error('Error loading battle status:', error);
    }
  }, [wallet?.address]);

  useEffect(() => {
    updateBattleData();
    // Update more frequently (every 5 seconds) to ensure we don't miss battle state changes
    const interval = setInterval(updateBattleData, 5000);
    return () => clearInterval(interval);
  }, [updateBattleData]);

  const handleStartBattle = async () => {
    if (!wallet?.address) return;
    try {
      setIsActionLoading(true);
      const response = await enterBattle(wallet);
      // Immediately check for battle status after starting
      await updateBattleData();
      if (response.status === 'success' && response.data) {
        const battleData = response.data as ActiveBattle;
        setActiveBattle(battleData);
        // Get updated battle status
        const status = await getBattleStatus(wallet.address);
        if (status) {
          setBattleStatus(status);
        }
      }
    } catch (error) {
      console.error('Error starting battle:', error);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleReturnFromBattle = async () => {
    if (!wallet?.address) return;
    try {
      setIsActionLoading(true);
      await returnFromBattle(wallet);
      // Immediately check for updated battle status
      await updateBattleData();
    } catch (error) {
      console.error('Error returning from battle:', error);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleAttack = async (moveName: string) => {
    if (!wallet?.address || !activeBattle) return;
    try {
      setIsActionLoading(true);
      const response = await executeAttack(wallet, activeBattle.id, moveName);
      if (response.status === 'success') {
        if ('result' in response.data!) {
          // Battle is over
          const result = response.data as BattleResult;
          setBattleStatus(result.session);
          setActiveBattle(null);
        } else {
          // Battle continues
          const battleData = response.data as ActiveBattle;
          setActiveBattle(battleData);
          // Get updated battle status
          const status = await getBattleStatus(wallet.address);
          if (status) {
            setBattleStatus(status);
          }
        }
      }
    } catch (error) {
      console.error('Error executing attack:', error);
    } finally {
      setIsActionLoading(false);
    }
  };

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

  const renderBattleContent = () => {
    if (activeBattle) {
      return (
        <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Player Monster */}
            <div>
              <h3 className={`text-lg font-bold mb-2 ${theme.text}`}>Your Monster</h3>
              <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container} space-y-3`}>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Health: {activeBattle.player.healthPoints}/{activeBattle.player.health * 10}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${(activeBattle.player.healthPoints / (activeBattle.player.health * 10)) * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Shield: {activeBattle.player.shield}/{activeBattle.player.defense}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${(activeBattle.player.shield / activeBattle.player.defense) * 100}%` }}
                    />
                  </div>
                </div>
                <p>Attack: {activeBattle.player.attack}</p>
                <p>Defense: {activeBattle.player.defense}</p>
                <p>Speed: {activeBattle.player.speed}</p>
              </div>
              <div className="mt-4 space-y-2">
                {Object.entries(activeBattle.player.moves).map(([name, move]) => (
                  <button
                    key={name}
                    onClick={() => handleAttack(name)}
                    disabled={activeBattle.moveCounts?.player?.[name] >= move.count}
                    className={`w-full px-4 py-2 rounded-lg font-bold transition-all duration-300 ${
                      activeBattle.moveCounts?.player?.[name] >= move.count 
                        ? 'bg-gray-500 cursor-not-allowed' 
                        : `${theme.buttonBg} ${theme.buttonHover}`
                    } ${theme.text}`}
                  >
                    {name} {" "}
                    {move.damage > 0 && `(Damage: ${move.damage})`}
                    {move.attack > 0 && ` (Attack: +${move.attack})`}
                    {move.health > 0 && ` (Heal: ${move.health * 10})`}
                    {move.defense > 0 && ` (Shield: +${move.defense})`}
                    {move.speed > 0 && ` (Speed: +${move.speed})`}
                    {` (${activeBattle.moveCounts?.player?.[name] || 0}/${move.count || 1} uses)`}
                  </button>
                ))}
              </div>
            </div>

            {/* Opponent Monster */}
            <div>
              <h3 className={`text-lg font-bold mb-2 ${theme.text}`}>Opponent</h3>
              <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container} space-y-3`}>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Health: {activeBattle.opponent.healthPoints}/{activeBattle.opponent.health * 10}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${(activeBattle.opponent.healthPoints / (activeBattle.opponent.health * 10)) * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Shield: {activeBattle.opponent.shield}/{activeBattle.opponent.defense}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${(activeBattle.opponent.shield / activeBattle.opponent.defense) * 100}%` }}
                    />
                  </div>
                </div>
                <p>Attack: {activeBattle.opponent.attack}</p>
                <p>Defense: {activeBattle.opponent.defense}</p>
                <p>Speed: {activeBattle.opponent.speed}</p>
              </div>
              <div className="mt-4">
                <h4 className={`text-md font-bold mb-2 ${theme.text}`}>Opponent's Moves</h4>
                <div className="space-y-2">
                  {Object.entries(activeBattle.opponent.moves).map(([name, move]) => (
                    <div
                      key={name}
                      className={`px-4 py-2 rounded-lg ${theme.container} ${theme.text}`}
                    >
                      {name} {" "}
                      {move.damage > 0 && `(Damage: ${move.damage})`}
                      {move.attack > 0 && ` (Attack: +${move.attack})`}
                      {move.health > 0 && ` (Heal: ${move.health * 10})`}
                      {move.defense > 0 && ` (Shield: +${move.defense})`}
                      {move.speed > 0 && ` (Speed: +${move.speed})`}
                      {` (${activeBattle.moveCounts?.opponent?.[name] || 0}/${move.count || 1} uses)`}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Battle Log */}
          <div className="col-span-2 mt-6">
            <h3 className={`text-lg font-bold mb-2 ${theme.text}`}>Battle Log</h3>
            <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container} max-h-60 overflow-y-auto`}>
              {activeBattle.turns.map((turn, index) => (
                <div key={index} className="mb-2">
                  <span className="font-bold">{turn.attacker === 'player' ? 'Your Monster' : 'Opponent'}</span> used{' '}
                  <span className="font-bold">{turn.move}</span>
                  {turn.missed ? (
                    <span className="text-red-500"> but missed!</span>
                  ) : (
                    <>
                      {turn.shieldDamage > 0 && (
                        <span className="text-blue-500"> dealing {turn.shieldDamage} shield damage</span>
                      )}
                      {turn.healthDamage > 0 && (
                        <span className="text-red-500"> and {turn.healthDamage} health damage</span>
                      )}
                      {turn.statsChanged && (
                        <>
                          {turn.statsChanged.speed && (
                            <span className="text-green-500"> (+{turn.statsChanged.speed} Speed)</span>
                          )}
                          {turn.statsChanged.defense && (
                            <span className="text-blue-500"> (+{turn.statsChanged.defense} Shield)</span>
                          )}
                          {turn.statsChanged.health && (
                            <span className="text-green-500"> (+{turn.statsChanged.health} Healing)</span>
                          )}
                        </>
                      )}
                      <span>. </span>
                      <span className="text-gray-400">
                        (Shield: {turn.remainingShield}, Health: {turn.remainingHealth})
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Battle Stats */}
          <div>
            <h3 className={`text-xl font-bold mb-4 ${theme.text}`}>Current Session</h3>
            <div className="space-y-4">
              <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container}`}>
                <span className="font-semibold">Battles Remaining:</span> {battleStatus?.battlesRemaining}
              </div>
              <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container}`}>
                <span className="font-semibold">Wins:</span> {battleStatus?.wins}
              </div>
              <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container}`}>
                <span className="font-semibold">Losses:</span> {battleStatus?.losses}
              </div>
              <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container}`}>
                <span className="font-semibold">Win Rate:</span>{' '}
                {battleStatus && ((battleStatus.wins / (battleStatus.wins + battleStatus.losses)) * 100).toFixed(1)}%
              </div>
              <div className={`${theme.text} p-4 rounded bg-opacity-20 ${theme.container}`}>
                <span className="font-semibold">Session Started:</span>{' '}
                {battleStatus && formatTimeAgo(battleStatus.startTime)}
              </div>
              <div className="space-y-2">
                {battleStatus?.battlesRemaining > 0 && (
                  <button
                    onClick={handleStartBattle}
                    className={`w-full px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                  >
                    Start Next Battle
                  </button>
                )}
                <button
                  onClick={handleReturnFromBattle}
                  className={`w-full px-6 py-3 rounded-lg font-bold transition-all duration-300 bg-red-500 hover:bg-red-600 text-white`}
                >
                  Return from Battle
                </button>
              </div>
            </div>
          </div>

          {/* Battle Progress */}
          <div>
            <h3 className={`text-xl font-bold mb-4 ${theme.text}`}>Battle Progress</h3>
            <div className="relative pt-1">
              <div className="flex mb-2 items-center justify-between">
                <div>
                  <span className={`text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full ${theme.text} bg-opacity-20 ${theme.container}`}>
                    Battles Used
                  </span>
                </div>
                <div className={`text-right ${theme.text}`}>
                  <span className="text-xs font-semibold inline-block">
                    {battleStatus && `${4 - battleStatus.battlesRemaining}/4`}
                  </span>
                </div>
              </div>
              <div className="flex h-2 mb-4 overflow-hidden rounded bg-gray-200">
                <div
                  style={{ width: battleStatus ? `${((4 - battleStatus.battlesRemaining) / 4) * 100}%` : '0%' }}
                  className="bg-blue-500 transition-all duration-500"
                ></div>
              </div>
            </div>

            {/* Battle Record */}
            <div className="mt-8">
              <h4 className={`text-lg font-bold mb-4 ${theme.text}`}>Battle Record</h4>
              <div className="flex justify-center">
                <div className="w-48 h-48">
                  <div className="relative w-full h-full">
                    {/* Win/Loss Pie Chart */}
                    <svg viewBox="0 0 36 36" className="w-full h-full">
                      <path
                        d="M18 2.0845
                          a 15.9155 15.9155 0 0 1 0 31.831
                          a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#E2E8F0"
                        strokeWidth="3"
                      />
                      <path
                        d="M18 2.0845
                          a 15.9155 15.9155 0 0 1 0 31.831
                          a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#4F46E5"
                        strokeWidth="3"
                        strokeDasharray={battleStatus ? `${(battleStatus.wins / (battleStatus.wins + battleStatus.losses)) * 100}, 100` : '0,100'}
                      />
                      <text x="18" y="20.35" className="fill-current text-lg font-bold text-center" textAnchor="middle">
                        {battleStatus && battleStatus.wins + battleStatus.losses > 0 ? 
                          `${((battleStatus.wins / (battleStatus.wins + battleStatus.losses)) * 100).toFixed(0)}%` : 
                          '0%'}
                      </text>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
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
            ) : !battleStatus && !activeBattle ? (
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
            ) : (
              <>
                {isActionLoading && (
                  <div className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <Loading darkMode={darkMode} />
                  </div>
                )}
                {renderBattleContent()}
              </>
            )}
          </div>
        </div>
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};

export default BattlePage;
