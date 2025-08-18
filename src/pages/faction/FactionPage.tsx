import React, { useEffect, useState } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { useNavigate } from 'react-router-dom';
import { getFactionOptions, FactionOptions, setFaction, purchaseAccess, TokenOption, getTotalOfferings, OfferingStats, getUserOfferings } from '../../utils/aoHelpers';
import { currentTheme } from '../../constants/theme';
import { Gateway, ACTIVITY_POINTS } from '../../constants/Constants';
import PurchaseModal from '../../components/PurchaseModal';
import Header from '../../components/Header';
import Confetti from 'react-confetti';
import LoadingAnimation from '../../components/LoadingAnimation';
import Footer from '../../components/Footer';
import CheckInButton from '../../components/CheckInButton';

const FACTION_TO_PATH = {
  'Sky Nomads': 'air',
  'Aqua Guardians': 'water',
  'Inferno Blades': 'fire',
  'Stone Titans': 'rock'
};

interface OfferingData {
  LastOffering: number;
  IndividualOfferings: number;
  Streak: number;
}

// Type guard function to check if a value is an OfferingData object
const isOfferingData = (value: unknown): value is OfferingData => {
  return typeof value === 'object' && 
         value !== null && 
         'LastOffering' in value &&
         'IndividualOfferings' in value &&
         'Streak' in value;
};

export const FactionPage: React.FC = () => {
  const navigate = useNavigate();
  const { wallet, walletStatus, darkMode, connectWallet, setDarkMode, refreshTrigger, triggerRefresh } = useWallet();
  const [factions, setFactions] = useState<FactionOptions[]>([]);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [offeringStats, setOfferingStats] = useState<OfferingStats | null>(null);
  const [userOfferings, setUserOfferings] = useState<OfferingData | null>(null);
  const [nextOfferingTime, setNextOfferingTime] = useState<string>('');
  const theme = currentTheme(darkMode);

  useEffect(() => {
    const updateNextOfferingTime = () => {
      if (!userOfferings?.LastOffering) {
        const now = new Date();
        const midnight = new Date();
        midnight.setUTCHours(24, 0, 0, 0);
        
        if (midnight.getTime() <= now.getTime()) {
          midnight.setUTCDate(midnight.getUTCDate() + 1);
        }

        const hours = Math.floor((midnight.getTime() - now.getTime()) / (1000 * 60 * 60));
        const minutes = Math.floor(((midnight.getTime() - now.getTime()) % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor(((midnight.getTime() - now.getTime()) % (1000 * 60)) / 1000);

        setNextOfferingTime(`${hours}h ${minutes}m ${seconds}s`);
      } else {
        const lastOffering = new Date(userOfferings.LastOffering * 1000);
        const nextOffering = new Date(lastOffering);
        nextOffering.setUTCDate(nextOffering.getUTCDate() + 1);
        nextOffering.setUTCHours(0, 0, 0, 0);

        const now = new Date();
        const diff = nextOffering.getTime() - now.getTime();

        if (diff <= 0) {
          setNextOfferingTime('');
          return;
        }

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        setNextOfferingTime(`${hours}h ${minutes}m ${seconds}s`);
      }
    };

    updateNextOfferingTime();
    const interval = setInterval(updateNextOfferingTime, 1000);
    return () => clearInterval(interval);
  }, [userOfferings?.LastOffering]);

  // Function to load data
  const loadAllData = async () => {
    if (!wallet?.address) {
      setFactions([]);
      setOfferingStats(null);
      setUserOfferings(null);
      setIsInitialLoad(false);
      return;
    }

    try {
      const [factionData, totalStats, userStats] = await Promise.all([
        getFactionOptions(wallet),
        getTotalOfferings(),
        getUserOfferings(wallet.address)
      ]);

      if (factionData) setFactions(factionData);
      if (totalStats) setOfferingStats(totalStats);
      if (userStats && isOfferingData(userStats)) {
        setUserOfferings(userStats);
      } else {
        setUserOfferings(null);
      }
    } catch (error) {
      console.error('Error loading faction data:', error);
    } finally {
      setIsInitialLoad(false);
    }
  };

  // Load data when wallet changes or refresh is triggered
  useEffect(() => {
    loadAllData();
  }, [wallet?.address, refreshTrigger]);

  const handleJoinFaction = async (factionName: string) => {
    if (!wallet) {
      console.error('Wallet not connected');
      return;
    }
    
    try {
      setIsLoading(true);
      await setFaction(wallet, factionName, walletStatus, triggerRefresh);
    } catch (error) {
      console.error('Error joining faction:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePurchase = async (selectedToken: TokenOption) => {
    try {
      if (!wallet) {
        await connectWallet();
        return;
      }
      await purchaseAccess(wallet, selectedToken, triggerRefresh);
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

  // Calculate total points for a faction
  const calculateFactionPoints = (faction: FactionOptions) => {
    const offeringPoints = Number(offeringStats?.[faction.name as keyof OfferingStats] || 0) * ACTIVITY_POINTS.OFFERING;
    const feedPoints = Number(faction.totalTimesFed || 0) * ACTIVITY_POINTS.FEED;
    const playPoints = Number(faction.totalTimesPlay || 0) * ACTIVITY_POINTS.PLAY;
    const missionPoints = Number(faction.totalTimesMission || 0) * ACTIVITY_POINTS.MISSION;
    return offeringPoints + feedPoints + playPoints + missionPoints;
  };

  // Calculate user's total points
  const calculateUserPoints = () => {
    const offeringPoints = Number(userOfferings?.IndividualOfferings || 0) * ACTIVITY_POINTS.OFFERING;
    const feedPoints = Number(walletStatus?.monster?.totalTimesFed || 0) * ACTIVITY_POINTS.FEED;
    const playPoints = Number(walletStatus?.monster?.totalTimesPlay || 0) * ACTIVITY_POINTS.PLAY;
    const missionPoints = Number(walletStatus?.monster?.totalTimesMission || 0) * ACTIVITY_POINTS.MISSION;
    return offeringPoints + feedPoints + playPoints + missionPoints;
  };

  const currentFaction = factions.find(f => f.name === walletStatus?.faction);

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header
          theme={theme}
          darkMode={darkMode}
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
                      <div className="grid grid-cols-2 gap-4">
                        <div className={`grid grid-cols-2 gap-4 p-3 rounded-lg ${theme.container} bg-opacity-50 mb-4`}>
                          <div>
                            <div className={`text-sm ${theme.text}`}>
                              <span className="opacity-70">Your Offerings:</span>
                              <span className="float-right font-semibold">{userOfferings?.IndividualOfferings || 0}</span>
                            </div>
                            <div className={`text-sm ${theme.text}`}>
                              <span className="opacity-70">Times Fed:</span>
                              <span className="float-right font-semibold">{walletStatus?.monster?.totalTimesFed || 0}</span>
                            </div>
                            <div className={`text-sm ${theme.text}`}>
                              <span className="opacity-70">Times Played:</span>
                              <span className="float-right font-semibold">{walletStatus?.monster?.totalTimesPlay || 0}</span>
                            </div>
                            <div className={`text-sm ${theme.text}`}>
                              <span className="opacity-70">Missions:</span>
                              <span className="float-right font-semibold">{walletStatus?.monster?.totalTimesMission || 0}</span>
                            </div>
                            <div className={`text-sm ${theme.text} font-bold pt-2 border-t border-gray-600`}>
                              <span>Total Points:</span>
                              <span className="float-right">{calculateUserPoints()}</span>
                            </div>
                          </div>
                          <div>
                            <div className={`text-sm ${theme.text} mb-2`}>
                              <span className="opacity-70">Avg Level:</span>
                              <span className="float-right font-semibold">{currentFaction.averageLevel ? Math.round(currentFaction.averageLevel * 10) / 10 : 0}</span>
                            </div>
                            <div className={`text-sm ${theme.text} opacity-80`}>
                              <div>Offering: {ACTIVITY_POINTS.OFFERING}pts</div>
                              <div>Feed: {ACTIVITY_POINTS.FEED}pt</div>
                              <div>Play: {ACTIVITY_POINTS.PLAY}pts</div>
                              <div>Mission: {ACTIVITY_POINTS.MISSION}pts</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <CheckInButton onOfferingComplete={loadAllData} />
                        {nextOfferingTime && (
                          <div className={`text-sm ${theme.text} opacity-80`}>
                            Next offering in: {nextOfferingTime}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Loading State or Content */}
          {isInitialLoad && !factions.length ? (
            <div className="flex justify-center items-center min-h-[400px]">
              <LoadingAnimation />
            </div>
          ) : factions.length > 0 && (
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
                  onClick={() => navigate(`/factions/${FACTION_TO_PATH[faction.name as keyof typeof FACTION_TO_PATH]}`)}
                  className={`flex flex-col h-full p-2.5 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md transform transition-all duration-300 hover:scale-[1.02] hover:shadow-xl min-h-[480px] cursor-pointer`}
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
                          <div className={`grid grid-cols-2 gap-4 p-4 rounded-lg ${theme.container} bg-opacity-50`}>
                          <div className="space-y-4">
                            <div className={`text-sm ${theme.text} mb-2`}>
                              <span className="opacity-70">Members:</span>
                              <span className="float-right font-semibold">{faction.memberCount}</span>
                            </div>
                            <div className={`text-sm ${theme.text} mb-2`}>
                              <span className="opacity-70">Monsters:</span>
                              <span className="float-right font-semibold">{faction.monsterCount}</span>
                            </div>
                            <div className={`text-sm ${theme.text} mb-2`}>
                              <span className="opacity-70">Avg Level:</span>
                              <span className="float-right font-semibold">{faction.averageLevel ? Math.round(faction.averageLevel * 10) / 10 : 0}</span>
                            </div>
                            <div className={`text-sm ${theme.text} mb-2`}>
                              <span className="opacity-70">Offerings:</span>
                              <span className="float-right font-semibold">
                                {offeringStats?.[faction.name as keyof OfferingStats] || 0}
                              </span>
                            </div>
                          </div>
                          <div className="space-y-4">
                            <div className={`text-sm ${theme.text} mb-2`}>
                              <span className="opacity-70">Times Fed:</span>
                              <span className="float-right font-semibold">{faction.totalTimesFed || 0}</span>
                            </div>
                            <div className={`text-sm ${theme.text} mb-2`}>
                              <span className="opacity-70">Times Played:</span>
                              <span className="float-right font-semibold">{faction.totalTimesPlay || 0}</span>
                            </div>
                            <div className={`text-sm ${theme.text} mb-2`}>
                              <span className="opacity-70">Missions:</span>
                              <span className="float-right font-semibold">{faction.totalTimesMission || 0}</span>
                            </div>
                            <div className={`text-sm ${theme.text} font-bold mt-4`}>
                              <span>Points:</span>
                              <span className="float-right">{calculateFactionPoints(faction)}</span>
                            </div>
                          </div>
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
