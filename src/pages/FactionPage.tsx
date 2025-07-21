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

      <main className={`flex-1 w-full px-0 py-4 md:py-6 overflow-y-auto ${theme.text}`}>
        {/* Title Section */}
        <div className="w-full mb-6 md:mb-10 text-center">
          <h1 className={`text-4xl md:text-6xl font-extrabold tracking-wide mb-2 ${theme.text} animate-fade-in`}>
            Factions
          </h1>
          <p className="text-lg md:text-2xl opacity-80 font-medium animate-fade-in">
            Choose your path, earn rewards, and lead your team!
          </p>
        </div>

        {/* Your Faction Section */}
        {walletStatus?.faction && currentFaction && (
          <section className="your-faction-section animate-slide-down">
            <h2 className="section-title text-green-400">Your Faction</h2>
            <div className="faction-card your-faction-card">
              <div className="flex items-center gap-7">
                {currentFaction.mascot && (
                  <div className="mascot-img-container">
                    <img
                      src={`${Gateway}${currentFaction.mascot}`}
                      alt={`${currentFaction.name} Mascot`}
                      className="mascot-img"
                    />
                  </div>
                )}
                <div>
                  <h3 className="faction-name text-green-400">{currentFaction.name}</h3>
                  {currentFaction.perks && (
                    <ul className="faction-perks">
                      {currentFaction.perks.map((perk, idx) => (
                        <li key={idx} className="perk-item">
                          <span className="perk-dot">●</span>{perk}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="faction-stats">
                <h4 className="stats-title text-green-300">Daily Offerings</h4>
                <p className="stats-desc">Offer praise once daily. Build streaks for RUNE rewards!</p>
                <div className="stats-grid">
                  <div>
                    <div className="stat-row">Your Offerings: <span className="stat-value">{userOfferings?.IndividualOfferings || 0}</span></div>
                    <div className="stat-row">Times Fed: <span className="stat-value">{walletStatus?.monster?.totalTimesFed || 0}</span></div>
                    <div className="stat-row">Times Played: <span className="stat-value">{walletStatus?.monster?.totalTimesPlay || 0}</span></div>
                    <div className="stat-row">Missions: <span className="stat-value">{walletStatus?.monster?.totalTimesMission || 0}</span></div>
                    <div className="stat-row stat-total">Total Points: <span className="stat-value">{calculateUserPoints()}</span></div>
                  </div>
                  <div>
                    <div className="stat-row">Avg Level: <span className="stat-value">{currentFaction.averageLevel ? Math.round(currentFaction.averageLevel * 10) / 10 : 0}</span></div>
                    <div className="activity-points">
                      <div>Offering: {ACTIVITY_POINTS.OFFERING} pts</div>
                      <div>Feed: {ACTIVITY_POINTS.FEED} pt</div>
                      <div>Play: {ACTIVITY_POINTS.PLAY} pts</div>
                      <div>Mission: {ACTIVITY_POINTS.MISSION} pts</div>
                    </div>
                  </div>
                </div>
                <div className="stat-actions">
                  <CheckInButton onOfferingComplete={loadAllData} />
                  {nextOfferingTime && (
                    <div className="next-offering">
                      Next offering in: <span className="next-offering-value">{nextOfferingTime}</span>
                    </div>
                  )}
                </div>
                <div className="faction-card-actions mt-4">
                  <button
                    onClick={() =>
                      navigate(`/factions/${FACTION_TO_PATH[currentFaction.name as keyof typeof FACTION_TO_PATH]}`)
                    }
                    className="action-btn detail-btn"
                  >
                    Detail
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Faction Selection Info (if no faction is selected yet) */}
        {!walletStatus?.faction && walletStatus?.isUnlocked && (
          <section className="pick-faction-section animate-fade-in">
            <h2 className="section-title text-yellow-400">Pick Your Faction</h2>
            <div className="pick-faction-card">
              <p className="final-warning">
                ⚠️ Faction selection is FINAL. Choose wisely!
              </p>
              <ul className="pick-faction-list">
                <li><span className="font-semibold">Rewards Distribution:</span> Shared among members. Biggest isn't always best!</li>
                <li><span className="font-semibold">Activity Matters:</span> Most active get extra rewards. Inactive get none.</li>
                <li><span className="font-semibold">Sources:</span> Partnerships, premium sales, in-game, fundraising, staking.</li>
              </ul>
            </div>
          </section>
        )}

        {/* Grid Factions Opposing */}
        <section className="opposing-factions-section">
          <h2 className="section-title text-blue-400">Opposing Factions</h2>
          {isInitialLoad && !factions.length ? (
            <div className="loading-center animate-fade-in">
              <LoadingAnimation />
            </div>
          ) : (
            <div className="faction-grid">
              {factions
                .filter(f => !walletStatus?.faction || walletStatus?.faction !== f.name)
                .map((faction) => (
                  <div
                    key={faction.name}
                    className="faction-card"
                  >
                    <div className="mascot-img-container">
                      {faction.mascot && (
                        <img
                          src={`${Gateway}${faction.mascot}`}
                          alt={`${faction.name} Mascot`}
                          className="mascot-img"
                        />
                      )}
                    </div>
                    <div className="faction-card-body">
                      <h3 className="faction-name text-yellow-400">{faction.name}</h3>
                      {faction.perks && (
                        <ul className="faction-perks mb-3">
                          {faction.perks.map((perk, index) => (
                            <li key={index} className="perk-item text-blue-300">
                              <span className="perk-dot">•</span>
                              <span>{perk}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="stats-grid mb-3">
                        <div>
                          <div className="stat-row">Members: <span className="stat-value">{faction.memberCount}</span></div>
                          <div className="stat-row">Monsters: <span className="stat-value">{faction.monsterCount}</span></div>
                          <div className="stat-row">Avg Level: <span className="stat-value">{faction.averageLevel ? Math.round(faction.averageLevel * 10) / 10 : 0}</span></div>
                          <div className="stat-row">Offerings: <span className="stat-value">{offeringStats?.[faction.name as keyof OfferingStats] || 0}</span></div>
                        </div>
                        <div>
                          <div className="stat-row">Times Fed: <span className="stat-value">{faction.totalTimesFed || 0}</span></div>
                          <div className="stat-row">Times Played: <span className="stat-value">{faction.totalTimesPlay || 0}</span></div>
                          <div className="stat-row">Missions: <span className="stat-value">{faction.totalTimesMission || 0}</span></div>
                          <div className="stat-row stat-total text-green-400">Points: <span className="stat-value">{calculateFactionPoints(faction)}</span></div>
                        </div>
                      </div>
                    </div>
                    <div className="faction-card-actions">
                      <button
                        onClick={() => navigate(`/factions/${FACTION_TO_PATH[faction.name as keyof typeof FACTION_TO_PATH]}`)}
                        className="action-btn detail-btn"
                      >
                        Detail
                      </button>
                      {!walletStatus?.isUnlocked ? (
                        <button
                          onClick={() => setIsPurchaseModalOpen(true)}
                          className="action-btn unlock-btn"
                        >
                          Unlock Access
                        </button>
                      ) : !walletStatus?.faction && (
                        <button
                          onClick={() => handleJoinFaction(faction.name)}
                          disabled={isLoading}
                          className={`action-btn join-btn ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
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

      {/* Custom Animations & Styles */}
      <style>{`
        /* Layout & Container */
        .your-faction-section, .pick-faction-section, .opposing-factions-section {
          width: 100vw;
          max-width: 100vw;
          padding: 0 2vw;
          margin-bottom: 2.5rem;
        }
        .section-title {
          font-size: 2rem;
          font-weight: bold;
          margin-bottom: 1.5rem;
          padding-left: 0;
          text-align: left;
        }
        /* Grid */
        .faction-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 2.5rem;
          width: 100%;
        }
        @media (max-width: 1024px) {
          .faction-grid {
            gap: 1.5rem;
          }
        }
        @media (max-width: 768px) {
          .your-faction-section, .pick-faction-section, .opposing-factions-section {
            padding: 0 0.5rem;
          }
          .faction-grid {
            grid-template-columns: 1fr;
            gap: 1rem;
          }
        }
        /* Card */
        .faction-card {
          background: linear-gradient(135deg, #2d2218 80%, #432c1d 100%);
          border: 3px solid #ffb400;
          border-radius: 2rem;
          box-shadow: 0 0 16px 0 #ffecb3 inset, 0 4px 32px 0 #120b07;
          padding: 2rem 1.5rem 1.5rem 1.5rem;
          min-height: 480px;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .faction-card:hover {
          transform: scale(1.03);
          box-shadow: 0 0 32px 0 #ffecb3, 0 8px 40px 0 #432c1d;
        }
        .your-faction-card {
          border-color: #0aff9d;
          box-shadow: 0 0 24px 0 #0aff9d inset, 0 4px 32px 0 #120b07;
        }
        /* Mascot */
        .mascot-img-container {
          display: flex;
          align-items: center;
          justify-content: center;
          background: #1a1205;
          border-radius: 1.25rem;
          padding: 0.8rem;
          border: 3px solid #ffb400;
          margin-bottom: 0.5rem;
          width: 120px;
          height: 120px;
          box-shadow: 0 2px 12px #ffecb3;
        }
        .mascot-img {
          width: 96px;
          height: 96px;
          object-fit: contain;
          border-radius: 1rem;
        }
        /* Body */
        .faction-card-body {
          flex-grow: 1;
          margin-top: 1rem;
          padding: 0 0.25rem;
        }
        .faction-name {
          font-size: 1.7rem;
          font-weight: 700;
          margin-bottom: 1rem;
          letter-spacing: 0.5px;
        }
        .faction-perks {
          list-style: none;
          margin-bottom: 1.2rem;
          padding-left: 0;
        }
        .perk-item {
          font-size: 1.08rem;
          display: flex;
          align-items: start;
          margin-bottom: 0.5rem;
          line-height: 1.3;
          gap: 0.5rem;
        }
        .perk-dot {
          color: #0aff9d;
          font-size: 1.1rem;
          margin-right: 0.25rem;
        }
        .your-faction-card .perk-dot {
          color: #0aff9d;
        }
        /* Stats */
        .faction-stats, .stats-grid {
          margin-top: 1rem;
          background: rgba(255,255,255,0.05);
          border-radius: 1rem;
          padding: 1.2rem 1rem;
        }
        .stats-title {
          font-size: 1.2rem;
          font-weight: bold;
          margin-bottom: 0.7rem;
        }
        .stats-desc {
          font-size: 1rem;
          margin-bottom: 0.5rem;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.1rem;
          margin-bottom: 0.6rem;
        }
        .stat-row {
          font-size: 1rem;
          margin-bottom: 0.3rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .stat-total {
          font-weight: bold;
          border-top: 1px solid #ffb400;
          margin-top: 0.8rem;
          padding-top: 0.5rem;
          font-size: 1.05rem;
          color: #0aff9d;
        }
        .activity-points {
          font-size: 1rem;
          color: #2db4ff;
        }
        .stat-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 1rem;
          margin-top: 0.7rem;
        }
        .next-offering {
          background: #362610;
          border-radius: 0.7rem;
          padding: 0.6rem 1.2rem;
          font-size: 1rem;
          color: #fff;
        }
        .next-offering-value {
          font-weight: bold;
          color: #0aff9d;
        }
        /* Card Actions */
        .faction-card-actions {
          display: flex;
          gap: 0.8rem;
          margin-top: 1.3rem;
        }
        .action-btn {
          flex: 1;
          padding: 0.7rem 0.5rem;
          border-radius: 0.7rem;
          font-weight: bold;
          font-size: 1rem;
          transition: all 0.18s;
          box-shadow: 0 2px 8px #120b07;
          cursor: pointer;
        }
        .detail-btn {
          background: linear-gradient(90deg, #2db4ff 30%, #1e56b4 100%);
          color: #fff;
          border: none;
        }
        .unlock-btn {
          background: linear-gradient(90deg, #ffecb3 30%, #ffb400 100%);
          color: #222;
          border: none;
        }
        .join-btn {
          background: linear-gradient(90deg, #0aff9d 30%, #06825f 100%);
          color: #fff;
          border: none;
        }
        .action-btn:active, .action-btn:focus {
          outline: none;
          transform: scale(1.05);
          box-shadow: 0 4px 24px #222 inset;
        }
        /* Pick Section */
        .pick-faction-card {
          background: #1a1205;
          border: 2px solid #ffb400;
          border-radius: 1.5rem;
          box-shadow: 0 0 16px 0 #ffecb3 inset, 0 4px 24px 0 #120b07;
          padding: 1.5rem 1.2rem;
          margin-top: 0.5rem;
          margin-bottom: 1.2rem;
          text-align: left;
        }
        .final-warning {
          font-size: 1.18rem;
          font-weight: bold;
          color: #ff4343;
          margin-bottom: 1rem;
        }
        .pick-faction-list {
          list-style: disc;
          padding-left: 1.2rem;
          margin-bottom: 0;
        }
        /* Center Loader */
        .loading-center {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 350px;
        }

        /* Animations */
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
      `}</style>
    </div>
  );
};