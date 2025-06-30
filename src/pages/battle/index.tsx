import React, { useState, useEffect } from 'react';
import { useWallet } from '../../hooks/useWallet';
import { useBattle } from '../../contexts/BattleContext';
import { currentTheme } from '../../constants/theme';
import Header from '../../components/Header';
import Footer from '../../components/Footer';
import { Link, useNavigate } from 'react-router-dom';
import { executeActivity, returnFromBattle, message } from '../../utils/aoHelpers';
import { useTokens } from '../../contexts/TokenContext';
import { createDataItemSigner } from '../../config/aoConnection';
import { TARGET_BATTLE_PID, SupportedAssetId, AdminSkinChanger } from '../../constants/Constants';
import { useMonster } from '../../contexts/MonsterContext';

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

// Elegant modal component for confirmations
const ConfirmModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  theme: any;
}> = ({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', cancelText = 'Cancel', theme }) => {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className={`${theme.container} border-2 ${theme.border} rounded-xl shadow-2xl p-8 w-full max-w-lg relative z-10 transform transition-all duration-300 scale-100 animate-in fade-in zoom-in`} style={{
        backdropFilter: 'blur(20px)',
        backgroundColor: theme.container.includes('bg-white') ? 'rgba(255, 255, 255, 0.95)' : 'rgba(31, 41, 55, 0.95)'
      }}>
        <h3 className="text-2xl font-bold mb-6 text-center">{title}</h3>
        <div className="mb-8 text-center">{message}</div>
        <div className="flex gap-4 justify-center">
          <button
            onClick={onClose}
            className={`px-6 py-3 rounded-xl border-2 ${theme.border} hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300 font-semibold min-w-[120px]`}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-xl transition-all duration-300 font-semibold min-w-[120px] shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export const BattlePage = (): JSX.Element => {
  const { wallet, darkMode, triggerRefresh, walletStatus } = useWallet();
  const { battleManagerInfo, activeBattle, isLoading, refreshBattleInfo } = useBattle();
  const { tokenBalances, refreshAllTokens } = useTokens();
  const { monster } = useMonster();
  const [isReturningFromBattle, setIsReturningFromBattle] = useState<boolean>(false);
  const [isReturningFromBattleDirect, setIsReturningFromBattleDirect] = useState<boolean>(false);
  const [battleStatus, setBattleStatus] = useState<string>('Loading...');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);
  const navigate = useNavigate();
  const theme = currentTheme(darkMode);
  
  // Get battle activity configuration from wallet status
  const battleActivity = walletStatus?.monster?.activities?.battle;

  // Refresh battle info on mount
  React.useEffect(() => {
    const init = async () => {
      try {
        const result = await refreshBattleInfo();
        console.log('Battle info loaded:', result);
        
        // Determine battle status
        if (activeBattle) {
          console.log('User is in active battle:', activeBattle.id);
          setBattleStatus('In Battle');
        } else if (battleManagerInfo.battlesRemaining > 0) {
          console.log('User has battles remaining:', battleManagerInfo.battlesRemaining);
          setBattleStatus('Ready to Battle');
        } else {
          console.log('User is not currently in battle, 0 battles remaining');
          setBattleStatus('Not in Battle');
        }
      } catch (error) {
        console.error('Failed to load battle info:', error);
        setBattleStatus('Error Loading Battle Info');
      }
    };
    
    init();
  }, [refreshBattleInfo, activeBattle, battleManagerInfo.battlesRemaining]);
  
  // Handle Send Monster to Battle action - following MonsterActivities implementation
  const handleSendToBattle = async () => {
    if (isReturningFromBattle || !battleActivity) return;
    
    try {
      setIsReturningFromBattle(true);
      console.log('Sending monster to battle...');
      
      // Get token information from battle activity configuration
      const tokenId = battleActivity.cost.token;
      const tokenAmount = battleActivity.cost.amount;
      
      // Check if we have enough tokens
      const asset = tokenBalances[tokenId as SupportedAssetId];
      
      if (!asset || asset.balance < tokenAmount) {
        console.error('Not enough tokens for battle activity', {
          token: tokenId,
          asset,
          currentBalance: asset?.balance || 0,
          required: tokenAmount
        });
        return;
      }
      
      if (!wallet) {
        console.error('No wallet connected');
        return;
      }
      
      const signer = await createDataItemSigner(wallet);
      
      await message({
        process: tokenId,
        tags: [
          { name: "Action", value: "Transfer" },
          { name: "Quantity", value: tokenAmount.toString() },
          { name: "Recipient", value: AdminSkinChanger },
          { name: "X-Action", value: "BATTLE" }
        ],
        signer,
        data: ""
      }, () => {
        // Refresh data after sending to battle
        console.log('Successfully sent monster to battle');
        refreshBattleInfo();
        triggerRefresh();
        refreshAllTokens();
      });
    } catch (error) {
      console.error('Failed to send monster to battle:', error);
    } finally {
      setIsReturningFromBattle(false);
    }
  };
  
  // Check if the user should be warned about forfeiting battles
  const handleReturnFromBattleClick = () => {
    // If user has remaining battles, show confirmation modal
    if (battleManagerInfo.battlesRemaining > 0) {
      setIsConfirmModalOpen(true);
    } else {
      // No battles remaining, just return directly
      handleReturnFromBattleConfirmed();
    }
  };
  
  // Handle Return Monster from Battle action after confirmation (if needed)
  const handleReturnFromBattleConfirmed = async () => {
    if (isReturningFromBattleDirect) return;
    
    try {
      setIsReturningFromBattleDirect(true);
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

  return (
    <div className="min-h-screen flex flex-col">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header theme={theme} darkMode={darkMode} />
        
        <div className={`container mx-auto px-4 py-6 flex-1 ${theme.text}`}>
          <div className="w-full max-w-7xl mx-auto">
            <div className={`p-8 rounded-2xl ${theme.container} border-2 ${theme.border} backdrop-blur-md relative shadow-xl`}>
              {/* Battle action buttons - displayed only after battle state is determined */}
              <div className="absolute right-8 top-8 z-10 flex flex-col gap-3">
                {battleStatus !== 'Loading...' && (
                  battleStatus === 'Ready to Battle' || battleStatus === 'In Battle' ? (
                    <button
                      onClick={handleReturnFromBattleClick}
                      disabled={isReturningFromBattleDirect}
                      className={`px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 ${isReturningFromBattleDirect ? 'opacity-70 cursor-not-allowed' : ''}`}
                      style={{ minWidth: '200px' }}
                    >
                      {isReturningFromBattleDirect ? '🔄 Returning...' : '🏃‍♂️ Return Monster from Battle'}
                    </button>
                  ) : (
                    <button
                      onClick={handleSendToBattle}
                      disabled={isReturningFromBattle || !battleActivity}
                      className={`px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 ${isReturningFromBattle || !battleActivity ? 'opacity-70 cursor-not-allowed' : ''}`}
                      style={{ minWidth: '200px' }}
                    >
                      {isReturningFromBattle ? '⚔️ Sending...' : (
                        <>
                          ⚔️ Enter Battle
                          {battleActivity && (
                            <span className="block text-xs mt-1 opacity-90">
                              Cost: {battleActivity.cost.amount} {tokenBalances[battleActivity.cost.token as SupportedAssetId]?.info.ticker || 'token'}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  )
                )}
              </div>
              
              {/* Confirmation modal for returning from battle with remaining battles */}
              <ConfirmModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={handleReturnFromBattleConfirmed}
                title="Forfeit Remaining Battles?"
                message={
                  <div>
                    <p>You still have <span className="font-bold text-orange-500">{battleManagerInfo.battlesRemaining} {battleManagerInfo.battlesRemaining === 1 ? 'battle' : 'battles'}</span> remaining in your current session.</p>
                    <p className="mt-2">If you return your monster from battle now, you will forfeit these remaining battles.</p>
                    <p className="mt-2">Are you sure you want to continue?</p>
                  </div>
                }
                confirmText="Yes, Return Monster"
                cancelText="Cancel"
                theme={theme}
              />
              
              <h1 className="text-4xl font-bold mb-8 text-center bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">⚔️ Battle Arena ⚔️</h1>
              
              {/* Monster & Battle Info Section */}
              <div className="grid lg:grid-cols-2 gap-8 mb-8">
                {/* Battle Status */}
                <div className={`p-6 rounded-xl ${theme.container} bg-opacity-50 border ${theme.border}`}>
                  <h2 className="text-2xl font-semibold mb-4 flex items-center">
                    🛡️ Battle Status
                  </h2>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold">Current Status:</span>
                      <span className={`font-bold px-3 py-1 rounded-full text-sm ${
                        activeBattle ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' : 
                        battleManagerInfo.battlesRemaining > 0 ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 
                        'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      }`}>
                        {battleStatus}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="font-semibold">Battles Remaining:</span>
                      <span className="font-bold text-lg">{battleManagerInfo.battlesRemaining}</span>
                    </div>
                    {battleManagerInfo.battlesRemaining === 0 && !activeBattle && 
                      <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-2 rounded">⚠️ You are not currently in battle mode.</p>
                    }
                    {activeBattle && 
                      <p className="text-orange-500 text-sm bg-orange-50 dark:bg-orange-900/20 p-2 rounded">⚔️ You are currently in an active battle!</p>
                    }
                  </div>
                </div>

                {/* Monster Info */}
                {monster && (
                  <div className={`p-6 rounded-xl ${theme.container} bg-opacity-50 border ${theme.border}`}>
                    <h2 className="text-2xl font-semibold mb-4 flex items-center">
                      🐲 Your Monster
                    </h2>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">Name:</span>
                        <span className="font-bold">{monster.name || 'Unnamed Monster'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">Level:</span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">{monster.level || 1}</span>
                      </div>
                      {monster.health && (
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">Health:</span>
                          <span className="font-bold text-green-600 dark:text-green-400">{monster.health}</span>
                        </div>
                      )}
                      {monster.attack && (
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">Attack:</span>
                          <span className="font-bold text-red-600 dark:text-red-400">{monster.attack}</span>
                        </div>
                      )}
                      {monster.defense && (
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">Defense:</span>
                          <span className="font-bold text-yellow-600 dark:text-yellow-400">{monster.defense}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
              </div>

              {/* How Battles Work */}
              <div className={`mb-8 p-6 rounded-xl ${theme.container} bg-opacity-30 border ${theme.border}`}>
                <h2 className="text-2xl font-semibold mb-4 text-center">🎯 How Battles Work</h2>
                <div className="grid md:grid-cols-2 gap-6 text-center">
                  <div>
                    <h3 className="font-bold text-lg mb-2">⚔️ Battle Mechanics</h3>
                    <p className="text-gray-600 dark:text-gray-300">
                      Engage in strategic battles with your monsters! Each battle tests your monster's stats and your tactical skills.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-bold text-lg mb-2">🏆 Win Rewards</h3>
                    <p className="text-gray-600 dark:text-gray-300">
                      Win battles to earn rewards and climb the leaderboard. Show off your skills against other players!
                    </p>
                  </div>
                </div>
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
