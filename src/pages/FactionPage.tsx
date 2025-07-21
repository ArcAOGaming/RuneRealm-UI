import React, { useEffect, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useNavigate } from 'react-router-dom';
import { getFactionOptions, FactionOptions, setFaction, purchaseAccess, TokenOption, getTotalOfferings, OfferingStats, getUserOfferings } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { Gateway, ACTIVITY_POINTS } from '../constants/Constants';
import PurchaseModal from '../components/PurchaseModal';
import CheckInButton from '../components/CheckInButton';
import Header from '../components/Header';
import Confetti from 'react-confetti';
import LoadingAnimation from '../components/LoadingAnimation';
import Footer from '../components/Footer';

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
    <div className={`min-h-screen flex flex-col overflow-hidden ${theme.bg}`}>
      <Header theme={theme} darkMode={darkMode} />

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

      <main className={`flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 py-4 md:py-8 overflow-y-auto ${theme.text}`}>
        {/* Title Section */}
        <div className="w-full max-w-full mb-6 md:mb-10 text-center">
          <h1 className={`text-4xl md:text-6xl font-extrabold tracking-wide mb-2 ${theme.text} animate-fade-in`}>
            Factions
          </h1>
          <p className="text-lg md:text-2xl opacity-80 font-medium animate-fade-in">
            Choose your path, earn rewards, and lead your team!
          </p>
        </div>

        {/* Your Faction Section */}
        {walletStatus?.faction && currentFaction && (
          <section className="w-full max-w-full mb-10 px-0 animate-slide-down">
            <div className="flex items-center mb-3 gap-2 px-4">
              <span className="text-2xl font-extrabold text-green-400 drop-shadow-lg">Your Faction</span>
              <span className="px-4 py-2 bg-green-400 text-black font-bold rounded-full shadow text-sm uppercase tracking-wider animate-pulse">
                CURRENT
              </span>
              <button
                onClick={() => navigate(`/factions/${FACTION_TO_PATH[currentFaction.name as keyof typeof FACTION_TO_PATH]}`)}
                className="ml-auto px-4 py-2 rounded-lg font-bold transition-all duration-300 bg-gradient-to-r from-green-400 to-green-700 text-white hover:scale-110 hover:shadow-lg"
              >
                Detail
              </button>
            </div>
            <div className={`relative w-full p-7 rounded-3xl ${theme.container} border-4 border-green-400 shadow-2xl flex flex-col md:flex-row gap-8 items-center transition-all duration-300`}>
              {/* Decorative highlight bar */}
              <div className="absolute left-0 top-0 h-full w-3 bg-gradient-to-b from-green-400 to-transparent rounded-l-3xl animate-bar-glow"></div>
              {/* Mascot and Info */}
              <div className="flex items-center gap-7 w-full md:w-auto">
                {currentFaction.mascot && (
                  <div className="border-4 border-green-400 bg-black p-4 rounded-2xl shadow-xl animate-pop">
                    <img 
                      src={`${Gateway}${currentFaction.mascot}`}
                      alt={`${currentFaction.name} Mascot`}
                      className="w-28 h-28 md:w-36 md:h-36 object-cover rounded-xl"
                    />
                  </div>
                )}
                <div>
                  <h2 className={`text-2xl md:text-3xl font-bold mb-2 text-green-400 ${theme.text}`}>{currentFaction.name}</h2>
                  {currentFaction.perks && (
                    <ul className="space-y-1">
                      {currentFaction.perks.map((perk, idx) => (
                        <li key={idx} className={`text-base ${theme.text} opacity-85 flex items-center`}>
                          <span className="mr-2 text-blue-400">●</span>{perk}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="flex-1 border-t md:border-l md:border-t-0 pt-4 md:pt-0 md:pl-8 w-full">
                <h3 className={`text-xl font-semibold mb-2 text-green-300 ${theme.text}`}>Daily Offerings</h3>
                <p className={`text-base mb-3 ${theme.text}`}>Offer praise once daily. Build streaks for RUNE rewards!</p>
                <div className={`grid grid-cols-2 gap-6 ${theme.container} bg-opacity-70 rounded-xl p-6 mb-3`}>
                  <div>
                    <div className={`text-base mb-2 ${theme.text}`}>Your Offerings: <span className="font-bold float-right">{userOfferings?.IndividualOfferings || 0}</span></div>
                    <div className={`text-base mb-2 ${theme.text}`}>Times Fed: <span className="font-bold float-right">{walletStatus?.monster?.totalTimesFed || 0}</span></div>
                    <div className={`text-base mb-2 ${theme.text}`}>Times Played: <span className="font-bold float-right">{walletStatus?.monster?.totalTimesPlay || 0}</span></div>
                    <div className={`text-base mb-2 ${theme.text}`}>Missions: <span className="font-bold float-right">{walletStatus?.monster?.totalTimesMission || 0}</span></div>
                    <div className={`text-base font-bold pt-3 border-t border-gray-700 mt-2 text-green-400`}>Total Points: <span className="float-right">{calculateUserPoints()}</span></div>
                  </div>
                  <div>
                    <div className={`text-base mb-2 ${theme.text}`}>Avg Level: <span className="font-bold float-right">{currentFaction.averageLevel ? Math.round(currentFaction.averageLevel * 10) / 10 : 0}</span></div>
                    <div className={`text-base text-blue-300`}>
                      <div>Offering: {ACTIVITY_POINTS.OFFERING} pts</div>
                      <div>Feed: {ACTIVITY_POINTS.FEED} pt</div>
                      <div>Play: {ACTIVITY_POINTS.PLAY} pts</div>
                      <div>Mission: {ACTIVITY_POINTS.MISSION} pts</div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <CheckInButton onOfferingComplete={loadAllData} />
                  {nextOfferingTime && (
                    <div className={`text-base bg-black/20 px-4 py-2 rounded-lg ${theme.text}`}>
                      Next offering in: <span className="font-bold text-green-300">{nextOfferingTime}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Faction Selection Info (jika belum punya faksi) */}
        {!walletStatus?.faction && walletStatus?.isUnlocked && (
          <section className="w-full max-w-full mb-8 px-0 animate-fade-in">
            <h2 className="text-2xl font-bold mb-4 text-yellow-400 px-4">Pick Your Faction</h2>
            <div className={`p-7 rounded-2xl ${theme.container} border-2 ${theme.border} shadow-lg flex flex-col gap-3 text-left`}>
              <p className="text-lg md:text-xl font-semibold text-red-400 mb-2">
                ⚠️ Faction selection is FINAL. Choose wisely!
              </p>
              <ul className="list-disc pl-5 space-y-2 text-base md:text-lg">
                <li><span className="font-semibold">Rewards Distribution:</span> Shared among members. Biggest isn't always best!</li>
                <li><span className="font-semibold">Activity Matters:</span> Most active get extra rewards. Inactive get none.</li>
                <li><span className="font-semibold">Sources:</span> Partnerships, premium sales, in-game, fundraising, staking.</li>
              </ul>
            </div>
          </section>
        )}

        {/* Grid Factions Available */}
        <section className="w-full max-w-full mt-10 px-0">
          <h2 className="text-2xl md:text-3xl font-bold mb-4 text-blue-400 px-4">Factions Available</h2>
          {isInitialLoad && !factions.length ? (
            <div className="flex justify-center items-center min-h-[350px] animate-fade-in">
              <LoadingAnimation />
            </div>
          ) : (
            <div 
              className={`grid gap-8 w-full grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 px-3`}
            >
              {factions
                .filter(f => !walletStatus?.faction || walletStatus?.faction !== f.name)
                .map((faction) => (
                  <div
                    key={faction.name}
                    className={`flex flex-col h-full w-full p-7 rounded-3xl ${theme.container} border-4 ${theme.border} shadow-lg
                      transform transition-all duration-300 hover:scale-105 hover:shadow-2xl min-h-[480px] cursor-pointer relative animate-pop`}
                  >
                    {/* Mascot & Info */}
                    <div className="relative rounded-2xl overflow-hidden bg-black/10 mx-auto mb-5">
                      {faction.mascot && (
                        <img
                          src={`${Gateway}${faction.mascot}`}
                          alt={`${faction.name} Mascot`}
                          className="w-full h-[220px] object-contain transition-transform duration-500 animate-float"
                        />
                      )}
                    </div>
                    <div className="flex-grow mt-3 px-2">
                      <h3 className={`text-2xl font-bold mb-3 text-yellow-400 ${theme.text}`}>{faction.name}</h3>
                      {faction.perks && (
                        <ul className="space-y-2 mb-3">
                          {faction.perks.map((perk, index) => (
                            <li key={index} className={`text-base text-blue-300 flex items-start leading-tight`}>
                              <span className="mr-2 text-blue-400">•</span>
                              <span>{perk}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className={`grid grid-cols-2 gap-4 ${theme.container} bg-opacity-60 rounded-xl p-4 mb-3 text-base`}>
                        <div>
                          <div className={`mb-2 ${theme.text}`}>Members: <span className="float-right font-bold">{faction.memberCount}</span></div>
                          <div className={`mb-2 ${theme.text}`}>Monsters: <span className="float-right font-bold">{faction.monsterCount}</span></div>
                          <div className={`mb-2 ${theme.text}`}>Avg Level: <span className="float-right font-bold">{faction.averageLevel ? Math.round(faction.averageLevel * 10) / 10 : 0}</span></div>
                          <div className={`mb-2 ${theme.text}`}>Offerings: <span className="float-right font-bold">{offeringStats?.[faction.name as keyof OfferingStats] || 0}</span></div>
                        </div>
                        <div>
                          <div className={`mb-2 ${theme.text}`}>Times Fed: <span className="float-right font-bold">{faction.totalTimesFed || 0}</span></div>
                          <div className={`mb-2 ${theme.text}`}>Times Played: <span className="float-right font-bold">{faction.totalTimesPlay || 0}</span></div>
                          <div className={`mb-2 ${theme.text}`}>Missions: <span className="float-right font-bold">{faction.totalTimesMission || 0}</span></div>
                          <div className={`mt-2 font-bold text-green-400`}>Points: <span className="float-right">{calculateFactionPoints(faction)}</span></div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 px-2 pb-2 flex gap-3">
                      <button
                        onClick={() => navigate(`/factions/${FACTION_TO_PATH[faction.name as keyof typeof FACTION_TO_PATH]}`)}
                        className={`flex-1 px-3 py-2 rounded-lg font-bold transition-all duration-300 bg-gradient-to-r from-blue-400 to-blue-700 text-white hover:scale-110 hover:shadow-lg`}
                      >
                        Detail
                      </button>
                      {!walletStatus?.isUnlocked ? (
                        <button
                          onClick={() => setIsPurchaseModalOpen(true)}
                          className={`flex-1 px-3 py-2 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} text-black`}
                        >
                          Unlock Access
                        </button>
                      ) : !walletStatus?.faction && (
                        <button
                          onClick={() => handleJoinFaction(faction.name)}
                          disabled={isLoading}
                          className={`flex-1 px-3 py-2 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} ${isLoading ? "opacity-50 cursor-not-allowed" : "hover:scale-105"}`}
                        >
                          {isLoading ? 'Joining...' : 'Join Faction'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>
      </main>
      <Footer darkMode={darkMode} />

      {/* Custom Animations */}
      <style>{`
        @keyframes fade-in {
          0% { opacity: 0; transform: translateY(20px);}
          100% { opacity: 1; transform: translateY(0);}
        }
        .animate-fade-in {
          animation: fade-in 0.7s cubic-bezier(.4,0,.2,1) both;
        }
        @keyframes slide-down {
          0% { opacity: 0; transform: translateY(-40px);}
          100% { opacity: 1; transform: translateY(0);}
        }
        .animate-slide-down {
          animation: slide-down 0.8s cubic-bezier(.4,0,.2,1) both;
        }
        @keyframes pop {
          0% { transform: scale(0.7);}
          80% { transform: scale(1.05);}
          100% { transform: scale(1);}
        }
        .animate-pop {
          animation: pop 0.4s cubic-bezier(.4,0,.2,1) both;
        }
        @keyframes float {
          0% { transform: translateY(0);}
          50% { transform: translateY(-10px);}
          100% { transform: translateY(0);}
        }
        .animate-float {
          animation: float 2.5s infinite cubic-bezier(.4,0,.2,1);
        }
        @keyframes bar-glow {
          0%,100% { opacity: 1; filter: blur(1px);}
          50% { opacity: 0.6; filter: blur(6px);}
        }
        .animate-bar-glow {
          animation: bar-glow 2s infinite;
        }
      `}</style>
    </div>
  );
};