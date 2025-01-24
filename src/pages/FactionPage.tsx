import React, { useEffect, useState, useCallback } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getFactionOptions, FactionOptions, setFaction, purchaseAccess, TokenOption } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { Gateway } from '../constants/Constants';
import PurchaseModal from '../components/PurchaseModal';
import Header from '../components/Header';
import Confetti from 'react-confetti';
import LoadingAnimation from '../components/LoadingAnimation';

export const FactionPage: React.FC = () => {
  const { wallet, walletStatus, darkMode, connectWallet, setDarkMode } = useWallet();
  const [factions, setFactions] = useState<FactionOptions[]>([]);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isLoadingFactions, setIsLoadingFactions] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const theme = currentTheme(darkMode);

  const loadFactions = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) {
        setIsLoadingFactions(true);
      }
      const options = await getFactionOptions();
      setFactions(options || []);
    } catch (error) {
      console.error('Error loading factions:', error);
      setFactions([]);
    } finally {
      setIsLoadingFactions(false);
    }
  }, []);

  useEffect(() => {
    if (wallet) {
      loadFactions(true);
      setIsInitialLoad(false);
    } else {
      setFactions([]);
      setIsInitialLoad(false);
    }
  }, [wallet, loadFactions]); // Re-run when wallet changes

  const handleJoinFaction = async (factionName: string) => {
    try {
      setIsLoading(true);
      await setFaction(wallet, factionName);
      await loadFactions(false); // Load factions without showing loading animation
      await connectWallet();
    } catch (error) {
      console.error('Error joining faction:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePurchase = async (selectedToken: TokenOption) => {
    try {
      await purchaseAccess(selectedToken);
      setShowConfetti(true);
      setIsPurchaseModalOpen(false);
      setTimeout(() => {
        setShowConfetti(false);
        connectWallet();
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
            {walletStatus?.faction && currentFaction && (
              <div className={`p-4 rounded-xl ${theme.container} border ${theme.border} mb-8 backdrop-blur-md`}>
                <div className="flex items-center gap-4">
                  {currentFaction.mascot && (
                    <img 
                      src={`${Gateway}${currentFaction.mascot}`}
                      alt={`${currentFaction.name} Mascot`}
                      className="w-24 h-24 object-cover rounded-lg"
                    />
                  )}
                  <div>
                    <h2 className={`text-2xl font-bold mb-2 ${theme.text}`}>Your Faction</h2>
                    <p className={`text-xl ${theme.text}`}>{currentFaction.name}</p>
                    {currentFaction.perks && (
                      <div className="mt-2">
                        <p className={`text-sm ${theme.text} opacity-75`}>{currentFaction.perks[0]}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Loading State or Factions Grid */}
          {isInitialLoad ? (
            <LoadingAnimation />
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
                  className={`flex flex-col h-full p-2.5 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md transform transition-all duration-300 hover:scale-[1.02] hover:shadow-xl min-h-[560px]`}
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
                    <h3 className={`text-xl font-bold mb-2 ${theme.text}`}>{faction.name}</h3>
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
      </div>
    </div>
  );
};
