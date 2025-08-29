import React, { useEffect, useState } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { useFaction } from '../../contexts/FactionContext';
import { useNavigate } from 'react-router-dom';
import { setFaction, purchaseAccess, TokenOption } from '../../utils/aoHelpers';
import { FactionOptions, OfferingStats } from '../../utils/interefaces';
import { currentTheme } from '../../constants/theme';
import { Gateway, ACTIVITY_POINTS } from '../../constants/Constants';
import PurchaseModal from '../../components/ui/PurchaseModal';
import Header from '../../components/ui/Header';
import Confetti from 'react-confetti';
import LoadingAnimation from '../../components/ui/LoadingAnimation';
import Footer from '../../components/ui/Footer';
import CheckInButton from '../../components/faction/CheckInButton';

const FACTION_TO_PATH = {
  'Sky Nomads': 'air',
  'Aqua Guardians': 'water',
  'Inferno Blades': 'fire',
  'Stone Titans': 'rock'
};


export const FactionPage: React.FC = () => {
  const navigate = useNavigate();
  const { wallet, walletStatus, darkMode, connectWallet, setDarkMode, refreshTrigger, triggerRefresh } = useWallet();
  const { 
    factions, 
    offeringStats, 
    userFactionStatus, 
    isLoadingFactions, 
    isLoadingOfferingStats, 
    isLoadingUserStatus,
    refreshAllData,
    hardRefresh,
    getCurrentFaction,
    getUserTotalPoints,
    getFactionTotalPoints
  } = useFaction();
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [nextOfferingTime, setNextOfferingTime] = useState<string>('');
  const theme = currentTheme(darkMode);

  useEffect(() => {
    const updateNextOfferingTime = () => {
      if (!userFactionStatus?.offerings?.LastOffering) {
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
        const lastOffering = new Date(userFactionStatus.offerings.LastOffering * 1000);
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
  }, [userFactionStatus?.offerings?.LastOffering]);

  // Function to load data - now uses context
  const loadAllData = async () => {
    await refreshAllData();
  };

  // Load data when wallet changes or refresh is triggered
  useEffect(() => {
    if (wallet?.address) {
      refreshAllData();
    }
  }, [wallet?.address, refreshTrigger, refreshAllData]);

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

  // Calculate total points for a faction - now uses context
  const calculateFactionPoints = (faction: FactionOptions) => {
    return getFactionTotalPoints(faction);
  };

  // Calculate user's total points - now uses context
  const calculateUserPoints = () => {
    return getUserTotalPoints();
  };

  const currentFaction = getCurrentFaction();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className={`h-screen flex flex-col ${theme.bg}`}>
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

        <div className={`flex-1 flex flex-col px-2 sm:px-4 py-2 sm:py-4 overflow-hidden ${theme.text}`}>
          {/* Header Section */}
          <div className="flex-shrink-0 mb-2 sm:mb-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2 sm:mb-4">
              <div className="relative">
                <h1 className={`text-2xl sm:text-3xl md:text-4xl font-bold ${theme.text} bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent`}>
                  ⚔️ Factions ⚔️
                </h1>
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 rounded-lg blur opacity-20 animate-pulse"></div>
              </div>
              <button
                onClick={hardRefresh}
                className={`px-3 py-1.5 sm:px-4 sm:py-2 text-sm sm:text-base rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} shadow-lg hover:shadow-xl border border-blue-500/30`}
                disabled={isLoadingFactions || isLoadingOfferingStats || isLoadingUserStatus}
              >
                {(isLoadingFactions || isLoadingOfferingStats || isLoadingUserStatus) ? '🔄 Refreshing...' : '🔄 Hard Refresh'}
              </button>
            </div>
            
            {/* Non-premium user message */}
            {!walletStatus?.isUnlocked && (
              <div className={`relative p-6 sm:p-8 rounded-2xl ${theme.container} border-2 ${theme.border} mb-6 sm:mb-8 backdrop-blur-md overflow-hidden`}>
                <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 via-orange-500/10 to-yellow-500/10 animate-pulse"></div>
                <div className="relative z-10">
                  <div className="text-center">
                    <div className="text-6xl mb-4">🔒</div>
                    <h2 className={`text-2xl sm:text-3xl font-bold mb-4 ${theme.text}`}>🏰 Join the Battle!</h2>
                    <p className={`text-base sm:text-lg mb-6 ${theme.text} opacity-90`}>
                      Unlock your destiny! Purchase an Eternal Pass to choose your faction and begin your legendary journey.
                    </p>
                    <button
                      onClick={() => setIsPurchaseModalOpen(true)}
                      className={`px-8 py-4 rounded-xl font-bold text-lg transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} shadow-2xl hover:shadow-3xl border-2 border-yellow-500/50 bg-gradient-to-r from-yellow-600/20 to-orange-600/20`}
                    >
                      ⚡ Buy Eternal Pass ⚡
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {!walletStatus?.faction && walletStatus?.isUnlocked && (
              <div className={`relative p-6 sm:p-8 rounded-2xl ${theme.container} border-2 ${theme.border} mb-6 sm:mb-8 backdrop-blur-md overflow-hidden`}>
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-blue-500/10 to-cyan-500/10"></div>
                <div className="relative z-10">
                  <div className="text-center mb-6">
                    <div className="text-5xl mb-3">⚡</div>
                    <h2 className={`text-2xl sm:text-3xl font-bold mb-4 ${theme.text}`}>🎯 Choose Your Destiny</h2>
                  </div>
                  <div className={`space-y-4 ${theme.text}`}>
                    <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-center">
                      <p className="text-lg font-bold text-red-400 flex items-center justify-center gap-2">
                        ⚠️ Faction selection is FINAL - No team switching! ⚠️
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                        <h3 className="font-bold text-blue-400 mb-2">💰 Rewards Distribution</h3>
                        <p className="text-sm opacity-90">Faction rewards split among members - bigger isn't always better!</p>
                      </div>
                      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                        <h3 className="font-bold text-green-400 mb-2">🎮 Activity Matters</h3>
                        <p className="text-sm opacity-90">Active members get rewards, inactive members get nothing!</p>
                      </div>
                      <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 sm:col-span-2 lg:col-span-1">
                        <h3 className="font-bold text-purple-400 mb-2">🏆 Reward Sources</h3>
                        <div className="text-xs opacity-80 space-y-1">
                          <div>• Partnerships</div>
                          <div>• Premium sales</div>
                          <div>• In-game revenue</div>
                          <div>• Staking profits</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Loading State or Content */}
          {(isLoadingFactions || isLoadingOfferingStats) && !factions.length ? (
            <div className="flex-1 flex justify-center items-center">
              <LoadingAnimation />
            </div>
          ) : factions.length > 0 && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className={`grid gap-2 sm:gap-3 md:gap-4 h-full auto-rows-fr ${
                factions.length <= 2 
                  ? 'grid-cols-1 sm:grid-cols-2' 
                  : factions.length === 3 
                  ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' 
                  : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              }`}>
                {factions.map((faction) => {
                  const isUserFaction = walletStatus?.faction === faction.name;
                  return (
                  <div
                    key={faction.name}
                    onClick={() => navigate(`/factions/${FACTION_TO_PATH[faction.name as keyof typeof FACTION_TO_PATH]}`)}
                    className={`group relative flex flex-col h-full rounded-lg sm:rounded-xl md:rounded-2xl ${theme.container} border-2 ${isUserFaction ? 'border-yellow-400/70 shadow-yellow-400/30 shadow-lg' : theme.border} backdrop-blur-md transform transition-all duration-500 hover:shadow-2xl cursor-pointer overflow-hidden ${isUserFaction ? 'animate-pulse' : ''}`}
                  >
                    {/* Gold shimmer effect for user's faction */}
                    {isUserFaction && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400/20 to-transparent animate-shimmer"></div>
                    )}
                    
                    {/* Animated background gradient */}
                    <div className={`absolute inset-0 bg-gradient-to-br ${isUserFaction ? 'from-yellow-500/10 via-gold-500/10 to-orange-500/10' : 'from-blue-500/5 via-purple-500/5 to-pink-500/5'} ${isUserFaction ? 'group-hover:from-yellow-500/20 group-hover:via-gold-500/20 group-hover:to-orange-500/20' : 'group-hover:from-blue-500/10 group-hover:via-purple-500/10 group-hover:to-pink-500/10'} transition-all duration-500`}></div>
                    
                    {/* Faction mascot with enhanced styling */}
                    <div className="relative px-0.5 sm:px-1 pt-0.5 sm:pt-1 pb-0 flex-shrink-0">
                      <div className="relative rounded-lg sm:rounded-xl overflow-hidden bg-gradient-to-br from-black/10 to-black/5 border border-white/10">
                        {faction.mascot && (
                          <img
                            src={`${Gateway}${faction.mascot}`}
                            alt={`${faction.name} Mascot`}
                            className="w-full h-[100px] sm:h-[120px] md:h-[140px] lg:h-[160px] object-contain group-hover:scale-110 transition-transform duration-700"
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      </div>
                    </div>
                    
                    {/* Faction info section */}
                    <div className="relative z-10 flex-grow p-2 sm:p-3 md:p-4 pt-0 flex flex-col">
                      <h3 className={`text-sm sm:text-base md:text-lg lg:text-xl font-bold ${theme.text} mb-2 sm:mb-3 md:mb-4 text-center bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent`}>
                        {faction.name}
                      </h3>
                      
                      {/* Perks section */}
                      <div className="mb-2 sm:mb-3 md:mb-4 flex-shrink-0">
                        <h4 className="text-xs sm:text-sm font-bold text-yellow-400 mb-1 sm:mb-2 flex items-center gap-1">
                          ✨ Faction Perks
                        </h4>
                        {faction.perks && (
                          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2 sm:p-3">
                            <ul className="space-y-1">
                              {faction.perks.slice(0, 1).map((perk, index) => (
                                <li key={index} className={`text-xs ${theme.text} opacity-90 flex items-start leading-tight`}>
                                  <span className="mr-1 sm:mr-2 text-yellow-400 flex-shrink-0">⭐</span>
                                  <span className="line-clamp-2">{perk}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                      
                      {/* General Stats */}
                      <div className="mb-1.5 sm:mb-2 flex-shrink-0">
                        <h4 className="text-xs font-bold text-blue-400 mb-1 flex items-center gap-1">
                          📊 General Stats
                        </h4>
                        <div className="grid grid-cols-3 gap-1">
                          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-1 sm:p-1.5">
                            <div className="text-center">
                              <div className="text-xs sm:text-sm font-bold text-blue-400">{faction.memberCount}</div>
                              <div className="text-xs opacity-70">👥 Members</div>
                            </div>
                          </div>
                          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-1 sm:p-1.5">
                            <div className="text-center">
                              <div className="text-xs sm:text-sm font-bold text-green-400">{faction.monsterCount}</div>
                              <div className="text-xs opacity-70">🐲 Monsters</div>
                            </div>
                          </div>
                          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-1 sm:p-1.5">
                            <div className="text-center">
                              <div className="text-xs sm:text-sm font-bold text-purple-400">
                                {faction.averageLevel ? Math.round(faction.averageLevel * 10) / 10 : 0}
                              </div>
                              <div className="text-xs opacity-70">📊 Avg Level</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Activity Stats */}
                      <div className="mb-1.5 sm:mb-2 flex-shrink-0">
                        <h4 className="text-xs font-bold text-orange-400 mb-1 flex items-center gap-1">
                          ⚡ Activity Stats
                        </h4>
                        <div className="grid grid-cols-2 gap-1 mb-1">
                          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-1 sm:p-1.5">
                            <div className="text-center">
                              <div className="text-xs sm:text-sm font-bold text-orange-400">
                                {offeringStats?.[faction.name as keyof OfferingStats] || 0}
                              </div>
                              <div className="text-xs opacity-70">🙏 Offerings</div>
                            </div>
                          </div>
                          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-1 sm:p-1.5">
                            <div className="text-center">
                              <div className="text-xs sm:text-sm font-bold text-red-400">{faction.totalTimesFed || 0}</div>
                              <div className="text-xs opacity-70">🍖 Fed</div>
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-1 sm:p-1.5">
                            <div className="text-center">
                              <div className="text-xs sm:text-sm font-bold text-cyan-400">{faction.totalTimesPlay || 0}</div>
                              <div className="text-xs opacity-70">🎮 Played</div>
                            </div>
                          </div>
                          <div className="bg-pink-500/10 border border-pink-500/30 rounded-lg p-1 sm:p-1.5">
                            <div className="text-center">
                              <div className="text-xs sm:text-sm font-bold text-pink-400">{faction.totalTimesMission || 0}</div>
                              <div className="text-xs opacity-70">⚔️ Missions</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Total points highlight */}
                      <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/50 rounded-lg p-2 sm:p-3 mb-2 sm:mb-3 flex-shrink-0">
                        <div className="text-center">
                          <div className="text-xs opacity-70 mb-1">🏆 TOTAL FACTION POWER</div>
                          <div className="text-base sm:text-lg md:text-xl font-bold text-yellow-400">
                            {calculateFactionPoints(faction)}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Action button */}
                    <div className="relative z-10 p-2 sm:p-3 md:p-4 pt-0 flex-shrink-0">
                      {!walletStatus?.isUnlocked ? (
                        <div className={`text-center py-3 font-bold ${theme.text} opacity-60 bg-gray-500/10 rounded-lg border border-gray-500/30`}>
                          🔒 Premium Required
                        </div>
                      ) : !walletStatus?.faction ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleJoinFaction(faction.name);
                          }}
                          disabled={isLoading}
                          className={`w-full px-4 py-3 rounded-xl font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} shadow-lg hover:shadow-xl border-2 border-green-500/50 bg-gradient-to-r from-green-600/20 to-emerald-600/20`}
                        >
                          {isLoading ? '⏳ Joining...' : '⚔️ Join Faction ⚔️'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};
