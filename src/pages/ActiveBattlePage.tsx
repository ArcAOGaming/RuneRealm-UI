import React, { useEffect, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getBattleManagerInfo, getActiveBattle, executeAttack, BattleManagerInfo, ActiveBattle, BattleResult } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Loading from '../components/Loading';
import { useNavigate } from 'react-router-dom';

// Popup component for battle transitions
const BattlePopup: React.FC<{
  winner: 'player' | 'opponent';
  stats: { wins: number; losses: number };
  onClose: () => void;
}> = ({ winner, stats, onClose }): JSX.Element => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center z-50 bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg text-center transform scale-100 animate-bounce">
        <div>
          <div className="text-2xl font-bold mb-4">
            {winner === 'player' ? (
              <span className="text-green-500">Victory!</span>
            ) : (
              <span className="text-red-500">Defeat!</span>
            )}
          </div>
          <div className="text-gray-600 dark:text-gray-300">
            <div>Wins: {stats.wins}</div>
            <div>Losses: {stats.losses}</div>
            <div>Win Rate: {((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)}%</div>
          </div>
          <button
            onClick={onClose}
            className="mt-4 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Return to Battle Manager
          </button>
        </div>
      </div>
    </div>
  );
};

// Attack animation component
const AttackAnimation: React.FC<{
  attacker: 'player' | 'opponent';
  moveName: string;
  onComplete: () => void;
}> = ({ attacker, moveName, onComplete }): JSX.Element => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center z-40 pointer-events-none">
      <div className={`text-2xl font-bold ${attacker === 'player' ? 'text-blue-500' : 'text-red-500'} transform scale-100 animate-pulse`}>
        {attacker === 'player' ? 'Your Monster' : 'Opponent'} using {moveName}...
      </div>
    </div>
  );
};

// Small loading indicator for updates
const UpdateIndicator: React.FC = () => (
  <div className="fixed bottom-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-full text-sm animate-pulse">
    Updating...
  </div>
);

export const ActiveBattlePage: React.FC = (): JSX.Element => {
  const { wallet, darkMode, setDarkMode } = useWallet();
  const [battleManagerInfo, setBattleManagerInfo] = useState<BattleManagerInfo | null>(null);
  const [activeBattle, setActiveBattle] = useState<ActiveBattle | null>(null);
  const [previousBattle, setPreviousBattle] = useState<ActiveBattle | null>(null);
  const [showPopup, setShowPopup] = useState<{
    winner: 'player' | 'opponent';
    stats: { wins: number; losses: number };
  } | null>(null);
  const [attackAnimation, setAttackAnimation] = useState<{
    attacker: 'player' | 'opponent';
    moveName: string;
  } | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();

  // Effect to handle battle animations
  useEffect(() => {
    if (!activeBattle || !previousBattle || activeBattle === previousBattle) return;

    if (activeBattle.turns.length > previousBattle.turns.length) {
      const newTurnIndex = previousBattle.turns.length;
      const newTurn = activeBattle.turns[newTurnIndex];
      setAttackAnimation({
        attacker: newTurn.attacker,
        moveName: newTurn.move
      });
    }
  }, [activeBattle, previousBattle]);

  // Effect to handle initial load and polling
  useEffect(() => {
    let mounted = true;
    
    const checkBattleStatus = async () => {
      if (!wallet?.address || !mounted) return;
      
      try {
        if (!initialLoading) {
          setIsUpdating(true);
        }
        const info = await getBattleManagerInfo(wallet.address);
        if (!mounted) return;
        setBattleManagerInfo(info);
        
        const battle = await getActiveBattle(wallet.address);
        if (!mounted) return;
        
        if (battle) {
          if (!activeBattle) {
            // Initial battle load
            setActiveBattle(battle);
            setPreviousBattle(battle);
          } else {
            // Only update if there are changes
            if (JSON.stringify(battle) !== JSON.stringify(activeBattle)) {
              setPreviousBattle(activeBattle);
              setActiveBattle(battle);
            }
          }
        } else if (activeBattle) {
          // Battle ended
          const playerWon = activeBattle.opponent.healthPoints <= 0;
          setShowPopup({
            winner: playerWon ? 'player' : 'opponent',
            stats: {
              wins: info.wins,
              losses: info.losses
            }
          });
          setActiveBattle(null);
          setPreviousBattle(null);
        } else {
          // No battle at all
          navigate('/battle');
        }
      } catch (error) {
        console.error('Error checking battle status:', error);
      } finally {
        setInitialLoading(false);
        setIsUpdating(false);
      }
    };

    checkBattleStatus();
    const interval = setInterval(checkBattleStatus, 10000); // Poll less frequently
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [wallet?.address, navigate, activeBattle]);

  const handleAttack = async (moveName: string) => {
    if (!wallet?.address || !activeBattle) return;
    try {
      setIsUpdating(true);
      const response = await executeAttack(wallet, activeBattle.id, moveName);
      if (response.status === 'success') {
        if ('result' in response.data!) {
          // Battle is over
          const result = response.data as BattleResult;
          setShowPopup({
            winner: result.result === 'win' ? 'player' : 'opponent',
            stats: {
              wins: result.session.wins,
              losses: result.session.losses
            }
          });
          setBattleManagerInfo(result.session);
          setActiveBattle(null);
        } else {
          // Battle continues - animate turns one at a time
          const battleData = response.data as ActiveBattle;
          const previousTurns = activeBattle?.turns.length || 0;
          const newTurns = battleData.turns.length;
          
          if (newTurns > previousTurns) {
            // Show first turn animation
            const firstTurn = battleData.turns[previousTurns];
            setAttackAnimation({
              attacker: firstTurn.attacker,
              moveName: firstTurn.move
            });
            
            // Create partial battle state with first turn
            const partialBattle = {...battleData};
            partialBattle.turns = battleData.turns.slice(0, previousTurns + 1);
            
            // Update stats based on first turn
            if (firstTurn.statsChanged) {
              const stats = firstTurn.statsChanged;
              if (firstTurn.attacker === 'player') {
                partialBattle.player.speed += stats.speed || 0;
                partialBattle.player.shield = Math.min(
                  (partialBattle.player.shield || 0) + (stats.defense || 0),
                  partialBattle.player.defense
                );
              } else {
                partialBattle.opponent.speed += stats.speed || 0;
                partialBattle.opponent.shield = Math.min(
                  (partialBattle.opponent.shield || 0) + (stats.defense || 0),
                  partialBattle.opponent.defense
                );
              }
            }
            
            // Apply first turn state
            setActiveBattle(partialBattle);
            setPreviousBattle(partialBattle);
            
            // After first animation, show second turn if it exists
            if (newTurns > previousTurns + 1) {
              const secondTurn = battleData.turns[previousTurns + 1];
              setTimeout(() => {
                setAttackAnimation({
                  attacker: secondTurn.attacker,
                  moveName: secondTurn.move
                });
                
                // After second animation, update to final state
                setTimeout(() => {
                  setActiveBattle(battleData);
                  setPreviousBattle(battleData);
                  // Get updated battle status
                  getBattleManagerInfo(wallet.address).then(info => {
                    if (info) {
                      setBattleManagerInfo(info);
                    }
                  });
                }, 2000);
              }, 2000);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error executing attack:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReturnToBattleManager = () => {
    navigate('/battle');
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
            ) : !battleManagerInfo || !activeBattle ? (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md text-center`}>
                <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>No Active Battle</h2>
                <p className={`mb-4 ${theme.text}`}>Returning to battle manager...</p>
              </div>
            ) : (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
                {showPopup && (
                  <BattlePopup
                    winner={showPopup.winner}
                    stats={showPopup.stats}
                    onClose={handleReturnToBattleManager}
                  />
                )}
                {attackAnimation && (
                  <AttackAnimation
                    attacker={attackAnimation.attacker}
                    moveName={attackAnimation.moveName}
                    onComplete={() => setAttackAnimation(null)}
                  />
                )}
                {isUpdating && <UpdateIndicator />}
                
                <h2 className={`text-2xl font-bold mb-6 ${theme.text}`}>Active Battle</h2>
                
                <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 mb-4 transition-all duration-300`}>
                  <h3 className={`text-lg font-bold mb-4 ${theme.text}`}>Battle Status</h3>
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
                </div>

                <div className="mt-6">
                  <h3 className={`text-lg font-bold mb-4 ${theme.text}`}>Available Moves</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Player Moves */}
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20`}>
                      <h4 className="text-md font-semibold mb-3">Your Moves</h4>
                      <div className="space-y-2">
                        {Object.entries(activeBattle.player.moves).map(([moveName, move]) => (
                          <button
                            key={moveName}
                            onClick={() => handleAttack(moveName)}
                            disabled={isUpdating}
                            className={`w-full p-3 rounded-lg font-medium text-left transition-all duration-300 
                              ${moveName === 'attack' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'} 
                              text-white relative overflow-hidden group`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="capitalize">{moveName}</span>
                              <span className="text-sm opacity-75">
                                {move.count} uses left
                              </span>
                            </div>
                            <div className="text-sm mt-1 space-x-3">
                              {move.damage > 0 && (
                                <span>⚔️ +{move.damage}</span>
                              )}
                              {move.defense > 0 && (
                                <span>🛡️ +{move.defense}</span>
                              )}
                              {move.speed > 0 && (
                                <span>⚡ +{move.speed}</span>
                              )}
                              {move.health > 0 && (
                                <span>❤️ +{move.health}</span>
                              )}
                            </div>
                            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity duration-300"></div>
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    {/* Opponent Moves */}
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20`}>
                      <h4 className="text-md font-semibold mb-3">Opponent's Moves</h4>
                      <div className="space-y-2">
                        {Object.entries(activeBattle.opponent.moves).map(([moveName, move]) => (
                          <div
                            key={moveName}
                            className={`w-full p-3 rounded-lg font-medium text-left
                              ${moveName === 'attack' ? 'bg-red-500/50' : 'bg-blue-500/50'} 
                              text-white`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="capitalize">{moveName}</span>
                              <span className="text-sm opacity-75">
                                {move.count} uses left
                              </span>
                            </div>
                            <div className="text-sm mt-1 space-x-3">
                              {move.damage > 0 && (
                                <span>⚔️ +{move.damage}</span>
                              )}
                              {move.defense > 0 && (
                                <span>🛡️ +{move.defense}</span>
                              )}
                              {move.speed > 0 && (
                                <span>⚡ +{move.speed}</span>
                              )}
                              {move.health > 0 && (
                                <span>❤️ +{move.health}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* Battle Log */}
                  <div className="mt-8">
                    <h3 className={`text-lg font-bold mb-4 ${theme.text}`}>Battle Log</h3>
                    <div className="space-y-4 max-h-96 overflow-y-auto p-4 rounded-lg bg-gray-100 dark:bg-gray-800">
                      {activeBattle.turns.map((turn, index) => (
                        <div
                          key={index}
                          className={`flex ${turn.attacker === 'player' ? 'justify-start' : 'justify-end'}`}
                        >
                          <div
                            className={`max-w-[80%] p-3 rounded-lg ${
                              turn.attacker === 'player'
                                ? 'bg-blue-500 rounded-tr-lg'
                                : 'bg-red-500 rounded-tl-lg'
                            } text-white`}
                          >
                            <div className="font-medium mb-1">
                              {turn.attacker === 'player' ? 'Your Monster' : 'Opponent'} used {turn.move}
                            </div>
                            <div className="text-sm space-x-2">
                              {turn.healthDamage > 0 && (
                                <span>⚔️ {turn.healthDamage} damage</span>
                              )}
                              {turn.shieldDamage > 0 && (
                                <span>🛡️ {turn.shieldDamage} shield damage</span>
                              )}
                              {turn.missed && (
                                <span>❌ Missed!</span>
                              )}
                              {turn.statsChanged && (
                                <>
                                  {turn.statsChanged.speed && (
                                    <span>⚡ {turn.statsChanged.speed > 0 ? '+' : ''}{turn.statsChanged.speed} speed</span>
                                  )}
                                  {turn.statsChanged.defense && (
                                    <span>🛡️ {turn.statsChanged.defense > 0 ? '+' : ''}{turn.statsChanged.defense} defense</span>
                                  )}
                                  {turn.statsChanged.health && (
                                    <span>❤️ {turn.statsChanged.health > 0 ? '+' : ''}{turn.statsChanged.health} health</span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleReturnToBattleManager}
                    className={`w-full mt-4 px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                  >
                    Return to Battle Manager
                  </button>
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

export default ActiveBattlePage;
