import React, { useState, useEffect } from 'react';
import { useWallet } from '../../hooks/useWallet';
import { useBattle } from '../../contexts/BattleContext';
import { currentTheme } from '../../constants/theme';
import Header from '../../components/Header';
import Footer from '../../components/Footer';
import { Link, useNavigate } from 'react-router-dom';
import { returnFromBattle } from '../../utils/aoHelpers';
import { useTokens } from '../../contexts/TokenContext';
import { useMonster } from '../../contexts/MonsterContext';
import { MonsterCardDisplay } from '../../components/MonsterCardDisplay';
import { BattleStatus } from '../../components/battle/BattleStatus';
import { BattleEndModal } from '../../components/battle/BattleEndModal';

// Simple button component
const Button: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ onClick, disabled, className = '', style, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={className}
    style={style}
  >
    {children}
  </button>
);



export const BattlePage = (): JSX.Element => {
  const { wallet, darkMode, triggerRefresh, walletStatus } = useWallet();
  const { battleManagerInfo, activeBattle, refreshBattleInfo } = useBattle();
  const { monster } = useMonster();
  const [isReturningFromBattleDirect, setIsReturningFromBattleDirect] = useState<boolean>(false);
  const [isBattleEndModalOpen, setIsBattleEndModalOpen] = useState<boolean>(false);
  const [isForfeiting, setIsForfeiting] = useState<boolean>(false);
  const navigate = useNavigate();
  const theme = currentTheme(darkMode);
  
  // Get battle activity configuration from wallet status
  const battleActivity = walletStatus?.monster?.activities?.battle;

  // Refresh battle info on mount
  React.useEffect(() => {
    refreshBattleInfo();
  }, [refreshBattleInfo]);
  
  // Check if the user should be warned about forfeiting battles
  const handleReturnFromBattleClick = () => {
    // If user has remaining battles, show forfeit modal
    if (battleManagerInfo.battlesRemaining > 0) {
      setIsForfeiting(true);
      setIsBattleEndModalOpen(true);
    } else {
      // No battles remaining, show clean end modal
      setIsForfeiting(false);
      setIsBattleEndModalOpen(true);
    }
  };
  
  // Handle Return Monster from Battle action after confirmation
  const handleReturnFromBattleConfirmed = async () => {
    if (isReturningFromBattleDirect) return;
    
    try {
      setIsReturningFromBattleDirect(true);
      setIsBattleEndModalOpen(false);
      console.log('Returning monster from battle using returnFromBattle directly...');
      
      await returnFromBattle(wallet, () => {
        // Refresh data after returning from battle
        console.log('Successfully returned monster from battle using returnFromBattle directly');
        refreshBattleInfo();
        triggerRefresh();
      });
    } catch (error) {
      console.error('Failed to return monster from battle using returnFromBattle directly:', error);
    } finally {
      setIsReturningFromBattleDirect(false);
    }
  };



  // Get congratulatory message based on win rate
  const getCongratulatoryMessage = () => {
    const totalBattles = battleManagerInfo.wins + battleManagerInfo.losses;
    if (totalBattles === 0) return "Thanks for participating!";
    
    const winRate = (battleManagerInfo.wins / totalBattles) * 100;
    
    if (winRate > 50) {
      return "🎉 Congratulations! Excellent performance!";
    } else if (winRate === 50) {
      return "👍 Fair try! You're getting the hang of it!";
    } else {
      return "💪 Better luck next time! Keep practicing!";
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header theme={theme} darkMode={darkMode} />
        
        <div className={`container mx-auto px-4 py-6 flex-1 ${theme.text}`}>
          <div className="w-full max-w-7xl mx-auto">
            <div className={`p-8 rounded-2xl ${theme.container} border-2 ${theme.border} backdrop-blur-md relative shadow-xl`}>
              
              {/* Battle End Modal - handles both forfeit and clean end scenarios */}
              <BattleEndModal
                isOpen={isBattleEndModalOpen}
                onClose={() => setIsBattleEndModalOpen(false)}
                onConfirm={handleReturnFromBattleConfirmed}
                isForfeiting={isForfeiting}
                isReturningFromBattleDirect={isReturningFromBattleDirect}
                theme={theme}
              />
              
              <h1 className="text-4xl font-bold mb-8 text-center bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">⚔️ Battle Arena ⚔️</h1>
              
              {/* Main Battle Info Section */}
              <div className="grid lg:grid-cols-2 gap-8 mb-8">
                {/* Left Column: Battle Status + How Battles Work */}
                <div className="space-y-6">
                  {/* Battle Status */}
                  <BattleStatus
                    theme={theme}
                    isReturningFromBattleDirect={isReturningFromBattleDirect}
                    onReturnFromBattleClick={handleReturnFromBattleClick}
                  />

                  {/* How Battles Work */}
                  <div className={`p-6 rounded-xl ${theme.container} bg-opacity-30 border ${theme.border}`}>
                    <h2 className="text-xl font-semibold mb-4 text-center">🎯 How Battles Work</h2>
                    <div className="space-y-4 text-sm">
                      <div>
                        <h3 className="font-bold text-base mb-2">⚔️ Battle Mechanics</h3>
                        <p className="text-gray-600 dark:text-gray-300">
                          Engage in strategic battles with your monsters! Each battle tests your monster's stats and your tactical skills.
                        </p>
                      </div>
                      <div>
                        <h3 className="font-bold text-base mb-2">🏆 Win Rewards</h3>
                        <p className="text-gray-600 dark:text-gray-300">
                          Win battles to earn rewards and climb the leaderboard. Show off your skills against other players!
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Monster Card */}
                {monster && (
                  <div className="flex items-center justify-center">
                    <div className="w-full max-w-lg">
                      <MonsterCardDisplay 
                        monster={monster}
                        expanded={true}
                        className="w-full"
                        darkMode={darkMode}
                      />
                    </div>
                  </div>
                )}
              </div>



              {/* Battle Options */}
              <div className="grid md:grid-cols-2 gap-6 mb-8">
                {/* Bot Battle Card */}
                <Link 
                  to="/battle/bot"
                  className={`p-6 rounded-xl ${theme.container} border ${theme.border} hover:shadow-lg transition-all duration-300 flex flex-col h-full`}
                >
                  <div className="flex-1">
                    <h3 className="text-xl font-bold mb-3 text-center">Bot Battle</h3>
                    <p className="text-gray-600 dark:text-gray-300 mb-4">
                      Test your skills against AI opponents. Perfect for practice and honing your strategies.
                    </p>
                    <ul className="text-sm space-y-2 mb-4">
                      <li>• Battle against computer-controlled monsters</li>
                      <li>• No risk to your ranking</li>
                      <li>• Great for learning mechanics</li>
                    </ul>
                  </div>
                  <button className="w-full mt-4 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors">
                    Battle Bot
                  </button>
                </Link>

                {/* Ranked Battle Card */}
                <Link 
                  to="/battle/ranked"
                  className={`p-6 rounded-xl ${theme.container} border ${theme.border} hover:shadow-lg transition-all duration-300 flex flex-col h-full`}
                >
                  <div className="flex-1">
                    <h3 className="text-xl font-bold mb-3 text-center">Ranked Battle</h3>
                    <p className="text-gray-600 dark:text-gray-300 mb-4">
                      Compete against other players and climb the leaderboard. Show off your skills!
                    </p>
                    <ul className="text-sm space-y-2 mb-4">
                      <li>• Battle against real players</li>
                      <li>• Earn ranking points</li>
                      <li>• Compete for top spots</li>
                    </ul>
                  </div>
                  <button className="w-full mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors">
                    Start Ranked Match
                  </button>
                </Link>
              </div>

              {/* Session Stats */}
              <div className="mt-8">
                <h2 className="text-2xl font-semibold mb-6 text-center">📊 Your Battle Statistics</h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className={`p-6 rounded-xl ${theme.container} bg-opacity-40 border ${theme.border} text-center hover:shadow-lg transition-all duration-300`}>
                    <div className="text-3xl mb-2">⚔️</div>
                    <p className="text-sm text-gray-500 font-medium">Battles Left</p>
                    <p className="text-3xl font-bold mt-2">
                      {battleManagerInfo.battlesRemaining}
                      {battleManagerInfo.battlesRemaining === 0 && !activeBattle && 
                        <span className="block text-xs text-red-500 mt-2 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">Not in battle</span>
                      }
                      {activeBattle && 
                        <span className="block text-xs text-orange-500 mt-2 bg-orange-50 dark:bg-orange-900/20 px-2 py-1 rounded">In active battle</span>
                      }
                    </p>
                  </div>
                  <div className={`p-6 rounded-xl ${theme.container} bg-opacity-40 border ${theme.border} text-center hover:shadow-lg transition-all duration-300`}>
                    <div className="text-3xl mb-2">🏆</div>
                    <p className="text-sm text-gray-500 font-medium">Wins</p>
                    <p className="text-3xl font-bold text-green-500 mt-2">{battleManagerInfo.wins}</p>
                  </div>
                  <div className={`p-6 rounded-xl ${theme.container} bg-opacity-40 border ${theme.border} text-center hover:shadow-lg transition-all duration-300`}>
                    <div className="text-3xl mb-2">💀</div>
                    <p className="text-sm text-gray-500 font-medium">Losses</p>
                    <p className="text-3xl font-bold text-red-500 mt-2">{battleManagerInfo.losses}</p>
                  </div>
                  <div className={`p-6 rounded-xl ${theme.container} bg-opacity-40 border ${theme.border} text-center hover:shadow-lg transition-all duration-300`}>
                    <div className="text-3xl mb-2">📈</div>
                    <p className="text-sm text-gray-500 font-medium">Win Rate</p>
                    <p className="text-3xl font-bold mt-2">
                      {battleManagerInfo.wins + battleManagerInfo.losses > 0
                        ? (
                            <span className={`${
                              Math.round((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100) >= 70 ? 'text-green-500' :
                              Math.round((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100) >= 50 ? 'text-yellow-500' :
                              'text-red-500'
                            }`}>
                              {Math.round((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100)}%
                            </span>
                          )
                        : <span className="text-gray-500">N/A</span>}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};

export default BattlePage;
