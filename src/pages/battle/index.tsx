import React from 'react';
import { useWallet } from '../../hooks/useWallet';
import { useBattle } from '../../contexts/BattleContext';
import { currentTheme } from '../../constants/theme';
import Header from '../../components/Header';
import Footer from '../../components/Footer';
import { Link } from 'react-router-dom';

export const BattlePage = (): JSX.Element => {
  const { darkMode } = useWallet();
  const { battleManagerInfo, isLoading, refreshBattleInfo } = useBattle();
  const theme = currentTheme(darkMode);

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

  return (
    <div className="min-h-screen flex flex-col">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header theme={theme} darkMode={darkMode} />
        
        <div className={`container mx-auto px-6 py-8 flex-1 ${theme.text}`}>
          <div className="max-w-4xl mx-auto">
            <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
              <h1 className="text-3xl font-bold mb-6 text-center">Battle Arena</h1>
              
              {/* Battle Explanation */}
              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-3">How Battles Work</h2>
                <p className="mb-4">
                  Engage in strategic battles with your monsters! Each battle tests your monster's stats and your tactical skills.
                  Win battles to earn rewards and climb the leaderboard.
                </p>
                <p>
                  You have <span className="font-bold">{battleManagerInfo.battlesRemaining} battles</span> remaining in your current session.
                </p>
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
                <h2 className="text-xl font-semibold mb-4 text-center">Your Battle Stats</h2>
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

export default BattlePage;
