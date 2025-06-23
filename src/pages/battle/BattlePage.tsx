import React from 'react';
import { useWallet } from '../../hooks/useWallet';
import { useBattle } from '../../contexts/BattleContext';
import { currentTheme } from '../../constants/theme';
import Header from '../../components/Header';
import Footer from '../../components/Footer';
import { useNavigate } from 'react-router-dom';

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
  const { darkMode } = useWallet();
  const { battleManagerInfo, isLoading, refreshBattleInfo } = useBattle();
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();

  // Refresh battle info on mount
  React.useEffect(() => {
    const init = async () => {
      try {
        await refreshBattleInfo();
      } catch (error) {
        console.error('Failed to load battle info:', error);
      }
    };
    
    init();
  }, [refreshBattleInfo]);

  // Extract battle stats from the context
  const battleStats = {
    wins: battleManagerInfo?.wins || 0,
    losses: battleManagerInfo?.losses || 0,
    battlesRemaining: battleManagerInfo?.battlesRemaining || 0,
  };

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
      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
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
