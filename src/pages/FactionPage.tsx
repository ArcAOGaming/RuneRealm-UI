import React, { useEffect, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getFactionOptions, FactionOptions, setFaction, purchaseAccess, TokenOption, getTotalOfferings, OfferingStats, getUserOfferings } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { Gateway } from '../constants/Constants';
import PurchaseModal from '../components/PurchaseModal';
import CheckInButton from '../components/CheckInButton';
import Header from '../components/Header';
import Confetti from 'react-confetti';
import LoadingAnimation from '../components/LoadingAnimation';
import Inventory from '../components/Inventory';
import Footer from '../components/Footer';

export const FactionPage: React.FC = () => {
  const { wallet, walletStatus, darkMode, connectWallet, setDarkMode, refreshTrigger, triggerRefresh } = useWallet();
  const [factions, setFactions] = useState<FactionOptions[]>([]);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [offeringStats, setOfferingStats] = useState<OfferingStats | null>(null);
  const [userOfferings, setUserOfferings] = useState<number>(0);
  const theme = currentTheme(darkMode);

  // Function to load data
  const loadAllData = async (isInitialLoading = false) => {
    if (!wallet?.address) {
      if (isInitialLoading) {
        setFactions([]);
        setOfferingStats(null);
        setUserOfferings(0);
        setIsInitialLoad(false);
      }
      return;
    }

    try {
      const [factionData, totalStats, userStats] = await Promise.all([
        getFactionOptions(),
        getTotalOfferings(),
        getUserOfferings(wallet.address)
      ]);

      // Update state while preserving existing data if available
      setFactions(prevFactions => factionData || prevFactions);
      setOfferingStats(prevStats => totalStats || prevStats);
      setUserOfferings(prevOfferings => userStats || prevOfferings);
    } catch (error) {
      console.error('Error loading faction data:', error);
    } finally {
      if (isInitialLoading) {
        setIsInitialLoad(false);
      }
    }
  };

  // Initial load and refresh on trigger
  useEffect(() => {
    if (isInitialLoad) {
      loadAllData(true);
    } else {
      loadAllData(false);
    }
  }, [wallet?.address, refreshTrigger, isInitialLoad]);

  const handleJoinFaction = async (factionName: string) => {
    try {
      setIsLoading(true);
      await setFaction(wallet, factionName, triggerRefresh);
    } catch (error) {
      console.error('Error joining faction:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePurchase = async (selectedToken: TokenOption) => {
    try {
      await purchaseAccess(selectedToken, triggerRefresh);
      setShowConfetti(true);
      setIsPurchaseModalOpen(false);
      setTimeout(() => {
        setShowConfetti(false);
      }, 5000);
    } catch (error) {
      console.error('Purchase failed:', error);
      throw error;
    }
  };

  const currentFaction = factions.find(f => f.name === walletStatus?.faction);

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header
          theme={theme}
          darkMode={darkMode}
          onDarkModeToggle={() => setDarkMode(!darkMode)}
        />
        
        {showConfetti && (
          <Confetti
            width={window.innerWidth}
            height={window.innerHeight}
            recycle={false}
            numberOfPieces={500}
            gravity={0.3}
          />
        )}

        <PurchaseModal
          isOpen={isPurchaseModalOpen}
          onClose={() => setIsPurchaseModalOpen(false)}
          onPurchase={handlePurchase}
          contractName="Eternal Pass"
        />

        <div className={`container mx-auto px-6 py-8 flex-1 overflow-y-auto ${theme.text}`}>
          {/* Header Section */}
          <div className="max-w-6xl mx-auto mb-8">
            <h1 className={`text-3xl font-bold mb-4 ${theme.text}`}>Factions</h1>
            {!walletStatus?.faction && walletStatus?.isUnlocked && (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} mb-8 backdrop-blur-md`}>
                <h2 className={`text-2xl font-bold mb-4 ${theme.text}`}>Picking Your Faction</h2>
                <div className={`space-y-3 ${theme.text}`}>
                  <p className="text-lg font-semibold text-red-500">
                    Important: Faction selection is final - Team players only, no team quitting!
                  </p>
                  <div className="space-y-2">
                    <p>
                      <span className="font-semibold">Rewards Distribution:</span> Faction rewards are split among all faction members - being in the biggest faction may not be the best strategy.
                    </p>
                    <p>
                      <span className="font-semibold">Activity Matters:</span> The most active members will receive additional rewards, while non-active members will receive no rewards.
                    </p>
                    <p>
                      <span className="font-semibold">Reward Sources:</span> Rewards come from multiple sources:
                    </p>
                    <ul className="list-disc pl-6 space-y-1">
                      <li>Partnerships</li>
                      <li>Premium pass sales revenue</li>
                      <li>In-game revenue</li>
                      <li>Funds raised</li>
                      <li>Profits from staking</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
            {walletStatus?.faction && currentFaction && (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} mb-8 backdrop-blur-md`}>
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="flex items-start gap-4">
                    {currentFaction.mascot && (
                      <img 
                        src={`${Gateway}${currentFaction.mascot}`}
                        alt={`${currentFaction.name} Mascot`}
                        className="w-24 h-24 object-cover rounded-lg"
                      />
                    )}
                    <div>
                      <h2 className={`text-2xl font-bold mb-2 ${theme.text}`}>Your Faction</h2>
                      <p className={`text-xl ${theme.text} mb-2`}>{currentFaction.name}</p>
                      {currentFaction.perks && (
                        <div className="mb-4">
                          <p className={`text-sm ${theme.text} opacity-75`}>{currentFaction.perks[0]}</p>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex-1 border-t md:border-l md:border-t-0 pt-4 md:pt-0 md:pl-6">
                    <div className="mb-4">
                      <h3 className={`text-lg font-semibold mb-2 ${theme.text}`}>Daily Offerings</h3>
                      <p className={`text-sm ${theme.text} opacity-80 mb-2`}>
                        Offer praise to the altar of your team once daily. Build streaks to earn RUNE rewards - consistency is key!
                      </p>
                      <div className={`grid grid-cols-2 gap-4 p-3 rounded-lg ${theme.container} bg-opacity-50 mb-4`}>
                        <div className={`space-y-2 text-sm ${theme.text}`}>
                          <div>
                            <span className="opacity-70">Total offerings:</span>
                            <span className="float-right font-semibold">
                              {offeringStats?.[currentFaction.name as keyof OfferingStats] || 0}
                            </span>
                          </div>
                          <div>
                            <span className="opacity-70">Total times fed:</span>
                            <span className="float-right font-semibold">
                              {currentFaction.totalTimesFed || 0}
                            </span>
                          </div>
                          <div>
                            <span className="opacity-70">Total times played:</span>
                            <span className="float-right font-semibold">
                              {currentFaction.totalTimesPlay || 0}
                            </span>
                          </div>
                          <div>
                            <span className="opacity-70">Total missions:</span>
                            <span className="float-right font-semibold">
                              {currentFaction.totalTimesMission || 0}
                            </span>
                          </div>
                        </div>
                        <div className={`text-sm ${theme.text}`}>
                          <span className="opacity-70">Your Offerings:</span>
                          <span className="float-right font-semibold">
                            {userOfferings}
                          </span>
                        </div>
                      </div>
                      <CheckInButton />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Inventory Section */}
          {walletStatus?.isUnlocked && (
            <div className="max-w-6xl mx-auto mb-8">
              <Inventory />
            </div>
          )}

          {/* Loading State or Content */}
          {isInitialLoad ? (
            <div className="flex justify-center items-center min-h-[400px]">
              <LoadingAnimation />
            </div>
          ) : (
            <div 
              className={`grid gap-3 max-w-5xl mx-auto ${
                factions.length <= 3 
                  ? 'grid-cols-1 md:grid-cols-3' 
                  : factions.length === 4 
                  ? 'grid-cols-1 md:grid-cols-2' 
                  : 'grid-cols-1'
              }`}
            >
              {factions.map((faction) => (
                <div
                  key={faction.name}
                  className={`flex flex-col h-full p-2.5 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md transform transition-all duration-300 hover:scale-[1.02] hover:shadow-xl min-h-[480px]`}
                >
                  <div className="relative rounded-lg overflow-hidden bg-black/5">
                    {faction.mascot && (
                      <img
                        src={`${Gateway}${faction.mascot}`}
                        alt={`${faction.name} Mascot`}
                        className="w-full h-[360px] object-contain hover:scale-105 transition-transform duration-500"
                      />
                    )}
                  </div>
                  <div className="flex-grow mt-2.5 px-1.5">
                    <h3 className={`text-xl font-bold ${theme.text} mb-3`}>{faction.name}</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        {faction.perks && (
                          <ul className="space-y-1.5">
                            {faction.perks.map((perk, index) => (
                              <li key={index} className={`text-sm ${theme.text} opacity-80 flex items-start leading-tight`}>
                                <span className="mr-1.5 text-blue-400 flex-shrink-0">•</span>
                                <span>{perk}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className={`grid grid-cols-1 gap-2 p-2 rounded-lg ${theme.container} bg-opacity-50`}>
                        <div className={`text-sm ${theme.text}`}>
                          <span className="opacity-70">Current members:</span>
                          <span className="float-right font-semibold">{faction.memberCount}</span>
                        </div>
                        <div className={`text-sm ${theme.text}`}>
                          <span className="opacity-70">Total monsters adopted:</span>
                          <span className="float-right font-semibold">{faction.monsterCount}</span>
                        </div>
                        {offeringStats && (
                          <div className={`text-sm ${theme.text}`}>
                            <span className="opacity-70">Total offerings given:</span>
                            <span className="float-right font-semibold">
                              {offeringStats[faction.name as keyof OfferingStats]}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 px-1.5">
                    {!walletStatus?.isUnlocked ? (
                      <button
                        onClick={() => setIsPurchaseModalOpen(true)}
                        className={`w-full px-3 py-1.5 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                      >
                        Unlock Access
                      </button>
                    ) : !walletStatus?.faction && (
                      <button
                        onClick={() => handleJoinFaction(faction.name)}
                        disabled={isLoading}
                        className={`w-full px-3 py-1.5 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} hover:scale-105 ${theme.text}`}
                      >
                        {isLoading ? 'Joining...' : 'Join Faction'}
                      </button>
                    )}
                    {walletStatus?.faction === faction.name && (
                      <div className={`text-center py-1.5 font-bold ${theme.text} opacity-75`}>
                        Current Faction
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};
