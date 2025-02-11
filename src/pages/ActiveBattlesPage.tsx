import React, { useEffect, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getBattleManagerInfo, getActiveBattle, enterBattle, BattleManagerInfo, ActiveBattle } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Loading from '../components/Loading';
import { useNavigate } from 'react-router-dom';

export const ActiveBattlesPage: React.FC = (): JSX.Element => {
  const { wallet, darkMode, setDarkMode } = useWallet();
  const [battleManagerInfo, setBattleManagerInfo] = useState<BattleManagerInfo | null>(null);
  const [activeBattle, setActiveBattle] = useState<ActiveBattle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();

  useEffect(() => {
    const checkBattleStatus = async () => {
      if (!wallet?.address) return;
      
      try {
        setIsLoading(true);
        // First get battle manager info
        const info = await getBattleManagerInfo(wallet.address);
        setBattleManagerInfo(info);
        
        // Only check for active battles if we have battles remaining
        if (info && info.battlesRemaining > 0) {
          const battle = await getActiveBattle(wallet.address);
          setActiveBattle(battle);
        } else {
          setActiveBattle(null);
        }
      } catch (error) {
        console.error('Error checking battle status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkBattleStatus();
    const interval = setInterval(checkBattleStatus, 5000);
    return () => clearInterval(interval);
  }, [wallet?.address]);

  const handleJoinBattle = async () => {
    if (!wallet?.address || !activeBattle) return;
    navigate('battle');
  };

  const handleStartNewBattle = async () => {
    if (!wallet?.address) return;
    try {
      setIsLoading(true);
      const response = await enterBattle(wallet);
      if (response.status === 'success' && response.data) {
        navigate('battle');
      }
    } catch (error) {
      console.error('Error starting battle:', error);
    } finally {
      setIsLoading(false);
    }
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
                <p className={`mb-4 ${theme.text}`}>Please connect your wallet to view active battles.</p>
              </div>
            ) : isLoading ? (
              <div className="flex justify-center items-center py-12">
                <Loading darkMode={darkMode} />
              </div>
            ) : !battleManagerInfo ? (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md text-center`}>
                <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>No Battle Status</h2>
                <p className={`mb-4 ${theme.text}`}>You need to send your monster to battle first.</p>
                <button
                  onClick={() => navigate('monsters')}
                  className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                >
                  Go to Monsters
                </button>
              </div>
            ) : (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
                <h2 className={`text-2xl font-bold mb-6 ${theme.text}`}>Active Battles</h2>
                
                {activeBattle ? (
                  <div className="mb-6">
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20 mb-4`}>
                      <h3 className={`text-lg font-bold mb-2 ${theme.text}`}>Current Battle</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="font-semibold">Your Monster</p>
                          <p>HP: {activeBattle.player.healthPoints}/{activeBattle.player.health * 10}</p>
                          <p>Shield: {activeBattle.player.shield}/{activeBattle.player.defense}</p>
                        </div>
                        <div>
                          <p className="font-semibold">Opponent</p>
                          <p>HP: {activeBattle.opponent.healthPoints}/{activeBattle.opponent.health * 10}</p>
                          <p>Shield: {activeBattle.opponent.shield}/{activeBattle.opponent.defense}</p>
                        </div>
                      </div>
                      <button
                        onClick={handleJoinBattle}
                        className={`w-full mt-4 px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                      >
                        Join Battle
                      </button>
                    </div>
                  </div>
                ) : battleManagerInfo.battlesRemaining > 0 ? (
                  <div className="text-center mb-6">
                    <p className={`mb-4 ${theme.text}`}>No active battles. Start a new one?</p>
                    <button
                      onClick={handleStartNewBattle}
                      className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                    >
                      Start New Battle
                    </button>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className={`mb-4 ${theme.text}`}>No battles remaining in current session.</p>
                    <button
                      onClick={() => navigate('battle')}
                      className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                    >
                      View Battle Stats
                    </button>
                  </div>
                )}

                <div className="mt-6">
                  <h3 className={`text-lg font-bold mb-4 ${theme.text}`}>Session Stats</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20`}>
                      <p className="font-semibold">Battles Remaining</p>
                      <p className="text-2xl">{battleManagerInfo.battlesRemaining}</p>
                    </div>
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20`}>
                      <p className="font-semibold">Wins</p>
                      <p className="text-2xl">{battleManagerInfo.wins}</p>
                    </div>
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20`}>
                      <p className="font-semibold">Losses</p>
                      <p className="text-2xl">{battleManagerInfo.losses}</p>
                    </div>
                    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20`}>
                      <p className="font-semibold">Win Rate</p>
                      <p className="text-2xl">
                        {((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
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

export default ActiveBattlesPage;
