import { useState } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { useBattle } from '../../contexts/BattleContext';
import { currentTheme } from '../../constants/theme';
import Header from '../../components/ui/Header';
import Footer from '../../components/ui/Footer';
import { useNavigate } from 'react-router-dom';
import Loading from '../../components/ui/Loading';

export const RankedBattlePage = (): JSX.Element => {
  const { darkMode } = useWallet();
  const {
    battleManagerInfo,
    isLoading: isBattleLoading,
    startRankedBattle,
  } = useBattle();
  
  const [isLoading, setIsLoading] = useState(false);
  const [showChallengeOptions, setShowChallengeOptions] = useState(false);
  const [challengeAddress, setChallengeAddress] = useState('');
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();

  const handleStartRankedBattle = async (type: 'open' | 'targeted' = 'open') => {
    try {
      setIsLoading(true);
      let success;
      
      if (type === 'open') {
        success = await startRankedBattle('open');
      } else {
        if (!challengeAddress) {
          alert('Please enter a wallet address to challenge');
          return;
        }
        success = await startRankedBattle('targeted', challengeAddress);
      }

      if (success) {
        navigate('/battle/active');
      }
    } catch (error) {
      console.error('Error starting ranked battle:', error);
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
                <h1 className="text-2xl font-bold">Ranked Battles</h1>
              </div>

              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-4">Compete Against Players</h2>
                <p className="mb-6">
                  Challenge other players in ranked battles to climb the leaderboard and earn rewards.
                  Test your skills and strategies against real opponents!
                </p>
                
                <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg mb-6">
                  <h3 className="font-semibold mb-2">Ranked Battle Rules:</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Win ranked matches to increase your rating</li>
                    <li>Higher ranks unlock better rewards</li>
                    <li>Seasonal leaderboards with prizes</li>
                    <li>Fair matchmaking based on rating</li>
                  </ul>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-200 dark:border-blue-800 mb-6">
                  <div className="grid grid-cols-2 gap-4 mb-2">
                    <div>
                      <p className="text-sm text-blue-600 dark:text-blue-400">Your Rank</p>
                      <p className="text-xl font-bold">#{battleManagerInfo.ranking || 'Unranked'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-blue-600 dark:text-blue-400">Rating</p>
                      <p className="text-xl font-bold">{battleManagerInfo.rating ?? 1000}</p>
                    </div>
                  </div>
                  <p className="text-sm text-blue-600 dark:text-blue-400">
                    Battles Remaining: <span className="font-semibold">{battleManagerInfo.battlesRemaining ?? 0}</span>
                  </p>
                </div>

                {battleManagerInfo.battlesRemaining > 0 ? (
                  <div className="space-y-4">
                    <button
                      onClick={() => handleStartRankedBattle('open')}
                      className="w-full px-6 py-3 rounded-lg font-bold bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                    >
                      Find Ranked Match
                    </button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className={`px-2 ${theme.bg} text-gray-500`}>OR</span>
                      </div>
                    </div>

                    {!showChallengeOptions ? (
                      <button
                        onClick={() => setShowChallengeOptions(true)}
                        className="w-full px-6 py-3 rounded-lg font-bold border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        Challenge Specific Player
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <input
                            type="text"
                            value={challengeAddress}
                            onChange={(e) => setChallengeAddress(e.target.value)}
                            placeholder="Enter player's wallet address"
                            className="w-full px-4 py-2 rounded-lg border dark:bg-gray-700 dark:border-gray-600"
                          />
                        </div>
                        <div className="flex space-x-3">
                          <button
                            onClick={() => handleStartRankedBattle('targeted')}
                            disabled={!challengeAddress}
                            className={`flex-1 px-4 py-2 rounded-lg font-bold text-white transition-colors ${
                              challengeAddress
                                ? 'bg-purple-500 hover:bg-purple-600'
                                : 'bg-gray-400 cursor-not-allowed'
                            }`}
                          >
                            Send Challenge
                          </button>
                          <button
                            onClick={() => setShowChallengeOptions(false)}
                            className="px-4 py-2 rounded-lg font-bold border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <p className="text-red-500 mb-4">No battles remaining in your current session.</p>
                    <button
                      onClick={() => navigate('/battle')}
                      className="px-6 py-2 rounded-lg font-bold border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      Back to Battle Hub
                    </button>
                  </div>
                )}
              </div>

              {/* Battle Stats */}
              <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold mb-4">Your Ranked Stats</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 text-center`}>
                    <p className="text-sm text-gray-500">Rank</p>
                    <p className="text-2xl font-bold">#{battleManagerInfo.ranking || '--'}</p>
                  </div>
                  <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 text-center`}>
                    <p className="text-sm text-gray-500">Rating</p>
                    <p className="text-2xl font-bold">{battleManagerInfo.rating}</p>
                  </div>
                  <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 text-center`}>
                    <p className="text-sm text-gray-500">Wins</p>
                    <p className="text-2xl font-bold text-green-500">{battleManagerInfo.wins}</p>
                  </div>
                  <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 text-center`}>
                    <p className="text-sm text-gray-500">Losses</p>
                    <p className="text-2xl font-bold text-red-500">{battleManagerInfo.losses}</p>
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

export default RankedBattlePage;
