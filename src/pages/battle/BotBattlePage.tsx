import React from 'react';
import { useBattle } from '../../contexts/BattleContext';
import { currentTheme } from '../../constants/theme';
import Header from '../../components/ui/Header';
import Footer from '../../components/ui/Footer';
import { useNavigate } from 'react-router-dom';
import Loading from '../../components/ui/Loading';
import { useWallet } from '../../contexts/WalletContext';

export const BotBattlePage = (): JSX.Element => {
  const { darkMode } = useWallet();
  const {
    battleManagerInfo,
    isLoading: isBattleLoading,
    startBotBattle,
  } = useBattle();
  const [isLoading, setIsLoading] = React.useState(false);
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();

  const handleStartBotBattle = async () => {
    try {
      setIsLoading(true);
      const success = await startBotBattle();
      if (success) {
        navigate('/battle/active');
      }
    } catch (error) {
      console.error('Error starting bot battle:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading || isBattleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading darkMode={darkMode} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header theme={theme} darkMode={darkMode} />
        
        <div className={`container mx-auto px-6 py-8 flex-1 ${theme.text}`}>
          <div className="max-w-3xl mx-auto">
            <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
              <div className="flex items-center mb-6">
                <button
                  onClick={() => navigate('/battle')}
                  className="mr-4 p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                  aria-label="Go back"
                >
                  ←
                </button>
                <h1 className="text-2xl font-bold">Bot Battle</h1>
              </div>

              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-4">Challenge AI Opponents</h2>
                <p className="mb-6">
                  Test your skills against computer-controlled monsters. Perfect for practicing strategies and learning game mechanics.
                </p>
                
                <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg mb-6">
                  <h3 className="font-semibold mb-2">Battle Rules:</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Battles are turn-based with your monster's stats determining outcomes</li>
                    <li>No risk to your ranking or rewards</li>
                    <li>Great for testing different monster builds</li>
                    <li>Unlimited practice battles</li>
                  </ul>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-200 dark:border-blue-800 mb-6">
                  <h3 className="font-semibold text-blue-700 dark:text-blue-300 mb-2">Battles Remaining: {battleManagerInfo?.battlesRemaining ?? 0}</h3>
                  <p className="text-sm text-blue-600 dark:text-blue-400">
                    You can start a new bot battle whenever you're ready.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={handleStartBotBattle}
                    disabled={battleManagerInfo.battlesRemaining <= 0}
                    className={`px-6 py-3 rounded-lg font-bold text-white transition-colors ${
                      battleManagerInfo.battlesRemaining > 0
                        ? 'bg-green-500 hover:bg-green-600'
                        : 'bg-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {battleManagerInfo.battlesRemaining > 0 ? 'Start Bot Battle' : 'No Battles Remaining'}
                  </button>
                  
                  <button
                    onClick={() => navigate('/battle')}
                    className="px-6 py-3 rounded-lg font-bold border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    Back to Battle Hub
                  </button>
                </div>
              </div>

              {/* Battle Stats */}
              <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold mb-4">Your Battle Stats</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 text-center`}>
                    <p className="text-sm text-gray-500">Battles Left</p>
                    <p className="text-2xl font-bold">{battleManagerInfo.battlesRemaining}</p>
                  </div>
                  <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 text-center`}>
                    <p className="text-sm text-gray-500">Wins</p>
                    <p className="text-2xl font-bold text-green-500">{battleManagerInfo.wins}</p>
                  </div>
                  <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 text-center`}>
                    <p className="text-sm text-gray-500">Losses</p>
                    <p className="text-2xl font-bold text-red-500">{battleManagerInfo.losses}</p>
                  </div>
                  <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 text-center`}>
                    <p className="text-sm text-gray-500">Win Rate</p>
                    <p className="text-2xl font-bold">
                      {battleManagerInfo.wins + battleManagerInfo.losses > 0
                        ? `${Math.round((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100)}%`
                        : 'N/A'}
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

export default BotBattlePage;
