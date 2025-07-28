import React, { useEffect, useState, useMemo } from "react";
import { useWallet } from "../hooks/useWallet";
import { useNavigate } from "react-router-dom";
import {
  getFactionOptions,
  FactionOptions,
  setFaction,
  purchaseAccess,
  TokenOption,
  getTotalOfferings,
  OfferingStats,
  getUserOfferings,
} from "../utils/aoHelpers";
import { currentTheme } from "../constants/theme";
import { Gateway, ACTIVITY_POINTS } from "../constants/Constants";
import PurchaseModal from "../components/PurchaseModal";
import Header from "../components/Header";
import Confetti from "react-confetti";
import LoadingAnimation from "../components/LoadingAnimation";
import Footer from "../components/Footer";

const FACTION_TO_PATH = {
  "Sky Nomads": "air",
  "Aqua Guardians": "water",
  "Inferno Blades": "fire",
  "Stone Titans": "rock",
};

interface OfferingData {
  LastOffering: number;
  IndividualOfferings: number;
  Streak: number;
}

// Type guard function to check if a value is an OfferingData object
const isOfferingData = (value: unknown): value is OfferingData => {
  return (
    typeof value === "object" &&
    value !== null &&
    "LastOffering" in value &&
    "IndividualOfferings" in value &&
    "Streak" in value
  );
};

export const FactionPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    wallet,
    walletStatus,
    darkMode,
    connectWallet,
    setDarkMode,
    refreshTrigger,
    triggerRefresh,
  } = useWallet();
  const [factions, setFactions] = useState<FactionOptions[]>([]);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [offeringStats, setOfferingStats] = useState<OfferingStats | null>(
    null
  );
  const [userOfferings, setUserOfferings] = useState<OfferingData | null>(null);
  const theme = currentTheme(darkMode);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

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
      setIsLoading(true);
      const [factionData, totalStats, userStats] = await Promise.all([
        getFactionOptions(wallet),
        getTotalOfferings(),
        getUserOfferings(wallet.address),
      ]);

      if (factionData) setFactions(factionData);
      if (totalStats) setOfferingStats(totalStats);
      if (userStats && isOfferingData(userStats)) {
        setUserOfferings(userStats);
      } else {
        setUserOfferings(null);
      }
    } catch (error) {
      console.error("Error loading faction data:", error);
    } finally {
      setIsInitialLoad(false);
      setIsLoading(false);
    }
  };

  // Load data when wallet changes or refresh is triggered
  useEffect(() => {
    loadAllData();
  }, [wallet?.address, refreshTrigger]);

  // Handle faction info modal
  useEffect(() => {
    if (!walletStatus?.faction && walletStatus?.isUnlocked) {
      setIsInfoModalOpen(true);
    }
  }, [walletStatus]);

  const handleJoinFaction = async (factionName: string) => {
    if (!wallet) {
      console.error("Wallet not connected");
      return;
    }

    try {
      setIsLoading(true);
      await setFaction(wallet, factionName, walletStatus, triggerRefresh);
    } catch (error) {
      console.error("Error joining faction:", error);
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
      console.error("Purchase failed:", error);
      throw error;
    }
  };

  // Calculate total points for a faction
  const calculateFactionPoints = (faction: FactionOptions) => {
    const offeringPoints =
      Number(offeringStats?.[faction.name as keyof OfferingStats] || 0) *
      ACTIVITY_POINTS.OFFERING;
    const feedPoints =
      Number(faction.totalTimesFed || 0) * ACTIVITY_POINTS.FEED;
    const playPoints =
      Number(faction.totalTimesPlay || 0) * ACTIVITY_POINTS.PLAY;
    const missionPoints =
      Number(faction.totalTimesMission || 0) * ACTIVITY_POINTS.MISSION;
    return offeringPoints + feedPoints + playPoints + missionPoints;
  };

  // Memoize the sorted factions list to ensure ranks are correct and improve performance
  const sortedFactions = useMemo(() => {
    if (!factions.length || !offeringStats) return [];
    return [...factions].sort(
      (a, b) => calculateFactionPoints(b) - calculateFactionPoints(a)
    );
  }, [factions, offeringStats]);

  // Calculate user's total points
  const calculateUserPoints = () => {
    const offeringPoints =
      Number(userOfferings?.IndividualOfferings || 0) *
      ACTIVITY_POINTS.OFFERING;
    const feedPoints =
      Number(walletStatus?.monster?.totalTimesFed || 0) * ACTIVITY_POINTS.FEED;
    const playPoints =
      Number(walletStatus?.monster?.totalTimesPlay || 0) * ACTIVITY_POINTS.PLAY;
    const missionPoints =
      Number(walletStatus?.monster?.totalTimesMission || 0) *
      ACTIVITY_POINTS.MISSION;
    return offeringPoints + feedPoints + playPoints + missionPoints;
  };

  const currentFaction = sortedFactions.find(
    (f) => f.name === walletStatus?.faction
  );

  return (
    <div className={`flex flex-col min-h-screen ${theme.bg}`}>
      {/* Header */}
      <div className="z-50 md:sticky md:top-0">
        <Header theme={theme} darkMode={darkMode} />
      </div>

      {showConfetti && (
        <Confetti
          width={window.innerWidth}
          height={window.innerHeight}
          recycle={false}
          numberOfPieces={500}
          gravity={0.3}
        />
      )}

      {isInfoModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`max-w-2xl w-full p-6 rounded-xl ${theme.container} border ${theme.border} shadow-lg`}
          >
            <h2 className={`text-2xl font-bold mb-4 ${theme.cardTitle}`}>
              Picking Your Faction
            </h2>
            <div className={`space-y-3 ${theme.cardText}`}>
              <p className="text-lg font-semibold text-red-500">
                Important: Faction selection is final - Team players only, no
                team quitting!
              </p>
              <div className="space-y-2">
                <p>
                  <span className="font-semibold">Rewards Distribution:</span>{" "}
                  Faction rewards are split among all faction members - being in
                  the biggest faction may not be the best strategy.
                </p>
                <p>
                  <span className="font-semibold">Activity Matters:</span> The
                  most active members will receive additional rewards, while
                  non-active members will receive no rewards.
                </p>
                <p>
                  <span className="font-semibold">Reward Sources:</span> Rewards
                  come from multiple sources:
                </p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Partnerships</li>
                  <li>Premium pass sales revenue</li>
                  <li>In-game revenue</li>
                  <li>Funds raised</li>
                  <li>Profits from staking</li>
                </ul>
              </div>
              <div className="text-right">
                <button
                  onClick={() => setIsInfoModalOpen(false)}
                  className="mt-4 inline-block px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PurchaseModal
        isOpen={isPurchaseModalOpen}
        onClose={() => setIsPurchaseModalOpen(false)}
        onPurchase={handlePurchase}
        contractName="Eternal Pass"
      />

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col w-full px-2 md:px-6 py-4 min-h-0">
        {isLoading && (
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <LoadingAnimation />
          </div>
        )}

        {walletStatus?.faction && currentFaction && (
          <div
            className={`flex-1 flex flex-col w-full rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md p-4 min-h-0 transition-all duration-300`}
          >
            <div className="flex flex-1 flex-col lg:flex-row gap-6 min-h-0">
              {/* LEFT - USER FACTION INFO */}
              <div className="flex-1 flex flex-col min-h-0">
                <h2 className={`text-2xl font-bold mb-2 ${theme.cardTitle}`}>
                  Your Faction
                </h2>

                {/* Faction Hero Section */}
                <div
                  className={`flex-1 rounded-xl overflow-hidden ${theme.cardBg} border ${theme.border} shadow-lg`}
                >
                  <div className="flex flex-col md:flex-row h-full">
                    {/* Image */}
                    <div className="w-full md:w-1/2 relative min-h-[300px] md:h-auto">
                      {currentFaction.mascot && (
                        <img
                          src={`${Gateway}${currentFaction.mascot}`}
                          alt={`${currentFaction.name} Mascot`}
                          className="absolute inset-0 w-full h-full object-contain p-6 transition-transform hover:scale-105"
                        />
                      )}
                    </div>

                    {/* Teks */}
                    <div className="w-full md:w-1/2 p-6 flex flex-col justify-center z-10">
                      <div className="mb-6">
                        <p
                          className={`text-3xl font-bold ${theme.cardTitle} mb-3`}
                        >
                          {currentFaction.name}
                        </p>
                        {currentFaction.perks && (
                          <p className={`text-lg ${theme.cardText} opacity-90`}>
                            {currentFaction.perks[0]}
                          </p>
                        )}
                      </div>

                      {/* Mini Stats */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className={`p-3 rounded-lg ${theme.container}`}>
                          <p
                            className={`text-sm ${theme.cardText} opacity-80 mb-1`}
                          >
                            Members
                          </p>
                          <p className={`text-xl font-bold ${theme.cardTitle}`}>
                            {Number(currentFaction.memberCount || 0)}
                          </p>
                        </div>
                        <div className={`p-3 rounded-lg ${theme.container}`}>
                          <p
                            className={`text-sm ${theme.cardText} opacity-80 mb-1`}
                          >
                            Avg Level
                          </p>
                          <p className={`text-xl font-bold ${theme.cardTitle}`}>
                            {currentFaction.averageLevel?.toFixed(1)}
                          </p>
                        </div>
                        <div className={`p-3 rounded-lg ${theme.container}`}>
                          <p
                            className={`text-sm ${theme.cardText} opacity-80 mb-1`}
                          >
                            Points
                          </p>
                          <p className={`text-xl font-bold ${theme.cardTitle}`}>
                            {calculateFactionPoints(currentFaction)}
                          </p>
                        </div>
                        <div className={`p-3 rounded-lg ${theme.container}`}>
                          <p
                            className={`text-sm ${theme.cardText} opacity-80 mb-1`}
                          >
                            Rank
                          </p>
                          <p className={`text-xl font-bold ${theme.cardTitle}`}>
                            #
                            {sortedFactions.findIndex(
                              (f) => f.name === currentFaction.name
                            ) + 1}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* User Stats Section */}
                <div className="mt-6">
                  <h3 className={`text-xl font-bold mb-4 ${theme.cardTitle}`}>
                    Your Contribution
                  </h3>
                  <div
                    className={`grid grid-cols-2 gap-4 p-5 rounded-xl ${theme.container} border ${theme.border}`}
                  >
                    <div className="space-y-4">
                      <div className={`${theme.cardText}`}>
                        <div className="flex justify-between">
                          <span>Offerings</span>
                          <span className="font-semibold">
                            {userOfferings?.IndividualOfferings || 0}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-gray-700 rounded-full mt-1">
                          <div
                            className="h-full bg-yellow-500 rounded-full"
                            style={{
                              width: `${Math.min(
                                (userOfferings?.IndividualOfferings || 0) * 5,
                                100
                              )}%`,
                            }}
                          ></div>
                        </div>
                      </div>

                      <div className={`${theme.cardText}`}>
                        <div className="flex justify-between">
                          <span>Times Fed</span>
                          <span className="font-semibold">
                            {walletStatus?.monster?.totalTimesFed || 0}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-gray-700 rounded-full mt-1">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{
                              width: `${Math.min(
                                (walletStatus?.monster?.totalTimesFed || 0) *
                                  10,
                                100
                              )}%`,
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className={`${theme.cardText}`}>
                        <div className="flex justify-between">
                          <span>Times Played</span>
                          <span className="font-semibold">
                            {walletStatus?.monster?.totalTimesPlay || 0}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-gray-700 rounded-full mt-1">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{
                              width: `${Math.min(
                                (walletStatus?.monster?.totalTimesPlay || 0) *
                                  10,
                                100
                              )}%`,
                            }}
                          ></div>
                        </div>
                      </div>

                      <div className={`${theme.cardText}`}>
                        <div className="flex justify-between">
                          <span>Missions</span>
                          <span className="font-semibold">
                            {walletStatus?.monster?.totalTimesMission || 0}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-gray-700 rounded-full mt-1">
                          <div
                            className="h-full bg-purple-500 rounded-full"
                            style={{
                              width: `${Math.min(
                                (walletStatus?.monster?.totalTimesMission ||
                                  0) * 10,
                                100
                              )}%`,
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {/* Total Points */}
                    <div className="col-span-2 mt-4 pt-4 border-t border-gray-700">
                      <div className="flex justify-between items-center">
                        <span
                          className={`text-lg font-bold ${theme.cardTitle}`}
                        >
                          Total Points
                        </span>
                        <span className={`text-2xl font-bold ${theme.primary}`}>
                          {calculateUserPoints()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT - FACTION LIST */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex justify-between items-center mb-4">
                  <h2 className={`text-2xl font-bold ${theme.cardTitle}`}>
                    Faction Rankings
                  </h2>
                  <span className={`text-sm ${theme.cardText} opacity-80`}>
                    {sortedFactions.length - 1} opponents
                  </span>
                </div>

                <div className="flex-1 overflow-auto pr-2 custom-scrollbar">
                  {sortedFactions
                    .filter((f) => f.name !== walletStatus?.faction)
                    .map((faction) => (
                      <div
                        key={faction.name}
                        onClick={() =>
                          navigate(
                            `/factions/${
                              FACTION_TO_PATH[
                                faction.name as keyof typeof FACTION_TO_PATH
                              ]
                            }`
                          )
                        }
                        className={`p-4 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md hover:scale-[1.01] hover:shadow-lg cursor-pointer transition-all duration-200 mb-4`}
                      >
                        <div className="flex items-start">
                          {/* Image */}
                          {faction.mascot && (
                            <div className="w-1/3 min-w-[120px] mr-4">
                              <img
                                src={`${Gateway}${faction.mascot}`}
                                alt={`${faction.name} Mascot`}
                                className="w-full h-auto object-contain"
                              />
                            </div>
                          )}

                          <div className="flex-1">
                            <div className="flex justify-between items-start mb-3">
                              <h4
                                className={`text-xl font-bold ${theme.cardTitle}`}
                              >
                                {faction.name}
                              </h4>
                              <span
                                className={`text-sm font-semibold ${theme.primary}`}
                              >
                                #
                                {sortedFactions.findIndex(
                                  (f) => f.name === faction.name
                                ) + 1}
                              </span>
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className={`${theme.cardText}`}>
                                <div className="flex justify-between">
                                  <span className="opacity-80">Members:</span>
                                  <span className="font-semibold">
                                    {faction.memberCount}
                                  </span>
                                </div>
                              </div>

                              <div className={`${theme.cardText}`}>
                                <div className="flex justify-between">
                                  <span className="opacity-80">Avg Level:</span>
                                  <span className="font-semibold">
                                    {faction.averageLevel?.toFixed(1)}
                                  </span>
                                </div>
                              </div>

                              <div className={`${theme.cardText}`}>
                                <div className="flex justify-between">
                                  <span className="opacity-80">Points:</span>
                                  <span className="font-semibold">
                                    {calculateFactionPoints(faction)}
                                  </span>
                                </div>
                              </div>

                              <div className={`${theme.cardText}`}>
                                <div className="flex justify-between">
                                  <span className="opacity-80">Offerings:</span>
                                  <span className="font-semibold">
                                    {offeringStats?.[
                                      faction.name as keyof OfferingStats
                                    ] || 0}
                                  </span>
                                </div>
                              </div>

                              <div className={`${theme.cardText}`}>
                                <div className="flex justify-between">
                                  <span className="opacity-80">Fed:</span>
                                  <span className="font-semibold">
                                    {faction.totalTimesFed || 0}
                                  </span>
                                </div>
                              </div>

                              <div className={`${theme.cardText}`}>
                                <div className="flex justify-between">
                                  <span className="opacity-80">Played:</span>
                                  <span className="font-semibold">
                                    {faction.totalTimesPlay || 0}
                                  </span>
                                </div>
                              </div>

                              <div className={`${theme.cardText}`}>
                                <div className="flex justify-between">
                                  <span className="opacity-80">Missions:</span>
                                  <span className="font-semibold">
                                    {faction.totalTimesMission || 0}
                                  </span>
                                </div>
                              </div>

                              <div className={`${theme.cardText}`}>
                                <div className="flex justify-between">
                                  <span className="opacity-80">Activity:</span>
                                  <span className="font-semibold">
                                    {(() => {
                                      const members = Number(
                                        faction.memberCount || 0
                                      );
                                      const activity = Number(
                                        (faction as any).totalActivity || 0
                                      );
                                      return members > 0
                                        ? Math.round(activity / members)
                                        : 0;
                                    })()}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Perks */}
                            {faction.perks && faction.perks.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-gray-700">
                                <p
                                  className={`text-sm font-semibold ${theme.cardText} mb-1`}
                                >
                                  Faction Perks:
                                </p>
                                <p
                                  className={`text-sm ${theme.cardText} opacity-90`}
                                >
                                  {faction.perks[0]}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {isInitialLoad && !sortedFactions.length ? (
          <div className="flex justify-center items-center min-h-[400px]">
            <LoadingAnimation />
          </div>
        ) : (
          !walletStatus?.faction &&
          sortedFactions.length > 0 && (
            <div className="flex-1 flex flex-col w-full min-h-0">
              <div
                className={`flex-1 flex flex-col w-full rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md p-4 overflow-auto min-h-0`}
              >
                <h2 className={`text-2xl font-bold mb-4 ${theme.cardTitle}`}>
                  Choose Your Faction
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 auto-rows-fr gap-6 w-full flex-1 min-h-0">
                  {sortedFactions.map((faction) => (
                    <div
                      key={faction.name}
                      onClick={() =>
                        navigate(
                          `/factions/${
                            FACTION_TO_PATH[
                              faction.name as keyof typeof FACTION_TO_PATH
                            ]
                          }`
                        )
                      }
                      className={`flex flex-col h-full rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md hover:scale-[1.02] hover:shadow-lg transition-all duration-300 cursor-pointer overflow-hidden`}
                    >
                      {/* Image */}
                      <div className="relative h-64 bg-black/10 overflow-hidden">
                        {faction.mascot && (
                          <img
                            src={`${Gateway}${faction.mascot}`}
                            alt={`${faction.name} Mascot`}
                            className="absolute inset-0 w-full h-full object-contain p-6 transition-transform duration-300 hover:scale-110"
                          />
                        )}
                      </div>

                      <div className="flex flex-col p-4 flex-1">
                        <div className="flex justify-between items-center mb-3">
                          <h3
                            className={`text-xl font-bold ${theme.cardTitle}`}
                          >
                            {faction.name}
                          </h3>
                          <span
                            className={`text-sm font-semibold ${theme.primary}`}
                          >
                            #
                            {sortedFactions.findIndex(
                              (f) => f.name === faction.name
                            ) + 1}
                          </span>
                        </div>

                        {faction.perks && (
                          <ul className="text-sm opacity-90 mb-4 space-y-1.5">
                            {faction.perks.map((perk, index) => (
                              <li
                                key={index}
                                className={`flex items-start ${theme.cardText}`}
                              >
                                <span className={`mr-2 ${theme.primary}`}>
                                  •
                                </span>
                                <span>{perk}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Stats Grid */}
                        <div
                          className={`grid grid-cols-2 gap-3 p-3 rounded-lg ${theme.cardBg} text-sm mt-auto`}
                        >
                          <div className={`${theme.cardText}`}>
                            <div className="flex justify-between">
                              <span className="opacity-80">Members:</span>
                              <span className="font-semibold">
                                {Number(faction.memberCount || 0)}
                              </span>
                            </div>
                          </div>

                          <div className={`${theme.cardText}`}>
                            <div className="flex justify-between">
                              <span className="opacity-80">Level:</span>
                              <span className="font-semibold">
                                {faction.averageLevel?.toFixed(1)}
                              </span>
                            </div>
                          </div>

                          <div className={`${theme.cardText}`}>
                            <div className="flex justify-between">
                              <span className="opacity-80">Points:</span>
                              <span className="font-semibold">
                                {calculateFactionPoints(faction)}
                              </span>
                            </div>
                          </div>

                          <div className={`${theme.cardText}`}>
                            <div className="flex justify-between">
                              <span className="opacity-80">Offerings:</span>
                              <span className="font-semibold">
                                {offeringStats?.[
                                  faction.name as keyof OfferingStats
                                ] || 0}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4">
                          {!walletStatus?.isUnlocked ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsPurchaseModalOpen(true);
                              }}
                              className={`w-full px-3 py-2 rounded-lg font-bold ${theme.buttonBg} hover:opacity-90 ${theme.text} transition-opacity`}
                            >
                              Unlock Access
                            </button>
                          ) : (
                            !walletStatus?.faction && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleJoinFaction(faction.name);
                                }}
                                disabled={isLoading}
                                className={`w-full px-3 py-2 rounded-lg font-bold ${
                                  theme.buttonBg
                                } hover:opacity-90 ${theme.text} ${
                                  isLoading ? "opacity-60 cursor-wait" : ""
                                } transition-opacity`}
                              >
                                {isLoading ? "Joining..." : "Join Faction"}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        )}
      </main>

      {/* Footer */}
      <div className="z-50 md:sticky md:bottom-0">
        <Footer darkMode={darkMode} />
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-track {
          background: ${darkMode ? "#2A1912" : "#F4E4C1"};
          border-radius: 10px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: ${theme.primary};
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
};
