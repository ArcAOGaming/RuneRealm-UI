import React, { useState, useEffect } from 'react';
import { useWallet } from '../../hooks/useWallet';
import { useBattle } from '../../contexts/BattleContext';
import { currentTheme } from '../../constants/theme';
import Header from '../../components/Header';
import Footer from '../../components/Footer';
import { useNavigate } from 'react-router-dom';
import { executeActivity, returnFromBattle } from '../../utils/aoHelpers';

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
    className={`px-4 py-2 rounded-md font-medium transition-colors ${
      disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
    } ${className}`}
    style={style}
  >
    {children}
  </button>
);

// Stat card component
const StatCard: React.FC<{
  title: string;
  value: string | number;
  icon: string;
  color: string;
}> = ({ title, value, icon, color }) => (
  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-center h-full">
    <div className={`text-3xl mb-2 ${color}`}>{icon}</div>
    <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">{title}</h3>
    <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
  </div>
);

// Battle option card component
const BattleOptionCard: React.FC<{
  title: string;
  description: string;
  buttonText: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  theme: any;
}> = ({ title, description, buttonText, icon, onClick, disabled, theme }) => (
  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden border-2 border-transparent hover:border-blue-500 transition-all duration-200 h-full flex flex-col">
    <div className="p-6 flex-1 flex flex-col">
      <div className="flex items-center mb-4">
        <span className="text-4xl mr-3">{icon}</span>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h2>
      </div>
      <p className="text-gray-600 dark:text-gray-300 mb-6 flex-1">{description}</p>
      <Button
        onClick={onClick}
        disabled={disabled}
        className={`w-full mt-auto ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
        }`}
        style={{
          backgroundColor: theme.primary,
          color: theme.text,
          padding: '0.75rem 1.5rem',
          borderRadius: '0.5rem',
          fontWeight: 600,
          transition: 'all 0.2s',
        }}
      >
        {disabled ? 'No Battles Remaining' : buttonText}
      </Button>
    </div>
  </div>
);

interface BattleStats {
  wins: number;
  losses: number;
  battlesRemaining: number;
}

const BattlePage: React.FC = () => {
  const { darkMode, wallet, triggerRefresh } = useWallet();
  const { battleManagerInfo, isLoading, refreshBattleInfo, activeBattle } = useBattle();
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();
  const [isReturningFromBattle, setIsReturningFromBattle] = useState<boolean>(false);
  const [isReturningFromBattleDirect, setIsReturningFromBattleDirect] = useState<boolean>(false);
  const [battleStatus, setBattleStatus] = useState<string>('Loading...');

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

  // Handle return from battle using executeActivity
  const handleReturnFromBattle = async () => {
    if (!wallet) {
      console.error('No wallet connected');
      return;
    }
    
    try {
      setIsReturningFromBattle(true);
      // Call executeActivity with parameters: wallet, activity type, canReturn flag, token, cost
      // For returning from battle, we pass BATTLE as activity type and true for canReturn
      await executeActivity(wallet, 'BATTLE', true, '', '', () => {
        // Refresh data after returning from battle
        triggerRefresh();
        refreshBattleInfo();
        console.log('Successfully returned from battle using executeActivity');
      });
      // Redirect to home page after battle
      navigate('/');
    } catch (error) {
      console.error('Error returning from battle using executeActivity:', error);
    } finally {
      setIsReturningFromBattle(false);
    }
  };
  
  // Handle return from battle using returnFromBattle directly
  const handleReturnFromBattleDirect = async () => {
    if (!wallet) {
      console.error('No wallet connected');
      return;
    }
    
    try {
      setIsReturningFromBattleDirect(true);
      console.log('Returning from battle using returnFromBattle directly...');
      
      await returnFromBattle(wallet, () => {
        // Refresh data after returning from battle
        console.log('Successfully returned from battle using returnFromBattle directly');
        refreshBattleInfo();
        triggerRefresh();
      });
      // Redirect to home page after battle
      navigate('/');
    } catch (error) {
      console.error('Error returning from battle using returnFromBattle directly:', error);
    } finally {
      setIsReturningFromBattleDirect(false);
    }
  };

  // Extract battle stats from the context
  const battleStats = {
    wins: battleManagerInfo?.wins || 0,
    losses: battleManagerInfo?.losses || 0,
    battlesRemaining: battleManagerInfo?.battlesRemaining || 0,
  };

  // Always show the return from battle button on the battle arena page as requested

  const winRate = battleStats.wins + battleStats.losses > 0 
    ? (battleStats.wins / (battleStats.wins + battleStats.losses) * 100).toFixed(1)
    : '0';

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!battleManagerInfo) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <Header theme={theme} darkMode={darkMode} />
        <main className="flex-grow flex items-center justify-center px-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 max-w-md w-full text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">No Battle Info Available</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Please try refreshing the page or checking your wallet connection.
            </p>
            <Button
              onClick={() => {}}
              className="w-full"
              style={{
                backgroundColor: theme.primary,
                color: theme.text,
                padding: '0.75rem 1.5rem',
                borderRadius: '0.5rem',
                fontWeight: 600,
              }}
            >
              Refresh Page
            </Button>
          </div>
        </main>
        <Footer darkMode={darkMode} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header theme={theme} darkMode={darkMode} />
      <main className="flex-grow container mx-auto px-4 py-8 relative">
        {/* Return from Battle buttons - always displayed on the right side of the battle arena page */}
        <div className="absolute right-6 top-8 z-10 flex flex-col gap-2">
          <Button
            onClick={handleReturnFromBattle}
            disabled={isReturningFromBattle}
            className={`bg-red-500 hover:bg-red-600 text-white shadow-lg transition-all duration-300 ${isReturningFromBattle ? 'opacity-70' : ''}`}
            style={{ minWidth: '160px' }}
          >
            {isReturningFromBattle ? 'Returning...' : 'Return via Activity'}
          </Button>
          <Button
            onClick={handleReturnFromBattleDirect}
            disabled={isReturningFromBattleDirect}
            className={`bg-orange-500 hover:bg-orange-600 text-white shadow-lg transition-all duration-300 ${isReturningFromBattleDirect ? 'opacity-70' : ''}`}
            style={{ minWidth: '160px' }}
          >
            {isReturningFromBattleDirect ? 'Returning...' : 'Return Direct'}
          </Button>
        </div>
        <div className="max-w-4xl mx-auto">
          {/* Battle Status */}
          <div className="mb-4 text-center">
            <span className="font-semibold mr-2">Current Status:</span> 
            <span className={`font-bold px-3 py-1 rounded-full ${activeBattle ? 'bg-orange-500/20 text-orange-500' : battleManagerInfo.battlesRemaining > 0 ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
              {battleStatus}
            </span>
            {battleManagerInfo.battlesRemaining === 0 && !activeBattle && 
              <p className="text-red-500 text-sm mt-1">You are not currently in battle mode.</p>
            }
            {activeBattle && 
              <p className="text-orange-500 text-sm mt-1">You are currently in an active battle!</p>
            }
          </div>
          
          {/* Battle Stats */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-8">
            <h1 className="text-3xl font-bold text-center mb-6 text-gray-900 dark:text-white">Battle Hub</h1>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard
                title="Battles Remaining"
                value={battleStats.battlesRemaining}
                icon="⚔️"
                color="text-blue-500"
              />
              <StatCard
                title="Wins"
                value={battleStats.wins}
                icon="🏆"
                color="text-green-500"
              />
              <StatCard
                title="Losses"
                value={battleStats.losses}
                icon="💀"
                color="text-red-500"
              />
              <StatCard
                title="Win Rate"
                value={
                  battleStats.wins + battleStats.losses > 0
                    ? `${Math.round((battleStats.wins / (battleStats.wins + battleStats.losses)) * 100)}%`
                    : '0%'
                }
                icon="📊"
                color="text-purple-500"
              />
            </div>
          </div>

          {/* Battle Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <BattleOptionCard 
              title="Bot Battle"
              description="Practice against AI opponents to hone your skills"
              buttonText="Fight Bots"
              icon="🤖"
              onClick={() => navigate('/battle/bot')}
              disabled={battleStats.battlesRemaining <= 0}
              theme={theme}
            />
            <BattleOptionCard 
              title="Ranked Battle"
              description="Challenge other players in competitive ranked matches"
              buttonText="Find Opponent"
              icon="🏆"
              onClick={() => navigate('/battle/ranked')}
              disabled={battleStats.battlesRemaining <= 0}
              theme={theme}
            />
          </div>
        </div>
      </main>
      <Footer darkMode={darkMode} />
    </div>
  );
};

export default BattlePage;
