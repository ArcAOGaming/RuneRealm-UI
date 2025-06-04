import React, { useEffect, useState, useRef, useCallback } from 'react';
import '../styles/MonsterManagement.css';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import { purchaseAccess, TokenOption, adoptMonster, MonsterStats } from '../utils/aoHelpers';
import { createDataItemSigner } from '../config/aoConnection';
import { message } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import PurchaseModal from '../components/PurchaseModal';
import StatAllocationModal from '../components/StatAllocationModal';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Confetti from 'react-confetti';
import { MonsterCardDisplay } from '../components/MonsterCardDisplay';
import LootBoxUtil from '../components/LootBoxUtil';
import MonsterActivities from '../components/MonsterActivities';
import { useMonster } from '../contexts/MonsterContext';
import MonsterSpriteView from '../components/MonsterSpriteView';

export const MonsterManagement: React.FC = (): JSX.Element => {
  const navigate = useNavigate();
  // Include refreshTrigger for lootbox updates
  const { wallet, walletStatus, darkMode, connectWallet, setDarkMode, triggerRefresh } = useWallet();
  const { 
    monster: localMonster, 
    lootBoxes, 
    isLoadingLootBoxes,
    timeUpdateTrigger,
    getRarityName,
    formatTimeRemaining,
    calculateProgress,
    refreshMonsterAfterActivity
  } = useMonster();
  
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isAdopting, setIsAdopting] = useState(false);
  const [isLevelingUp, setIsLevelingUp] = useState(false);
  const [showStatModal, setShowStatModal] = useState(false);
  const theme = currentTheme(darkMode);
  const [, setForceUpdate] = useState({});

  // Force a re-render when time update trigger changes in the context
  useEffect(() => {
    if (localMonster && localMonster.status && localMonster.status.type !== 'Home') {
      // Just update the UI when the timer changes in the context
      setForceUpdate({});
      
      // Log the current progress
      if (localMonster.status.until_time) {
        const now = Date.now();
        const progress = calculateProgress(localMonster.status.since, localMonster.status.until_time);
        console.log(`[MonsterManagement] Progress update: ${Math.round(progress * 100)}%`);
        
        // If the activity just completed, log it
        if (now >= localMonster.status.until_time) {
          console.log('[MonsterManagement] Activity detected as complete');
        }
      }
    }
  }, [timeUpdateTrigger, localMonster]);

  const handleLevelUp = () => {
    if (!walletStatus?.monster || !wallet?.address) return;
    setShowStatModal(true);
  };

  const handleStatConfirm = async (stats: { attack: number; defense: number; speed: number; health: number }) => {
    try {
      setIsLevelingUp(true);
      console.log('Leveling up monster with stats:', stats);
      
      const signer = createDataItemSigner(window.arweaveWallet);
      await message({
        process: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI",
        tags: [
          { name: "Action", value: "LevelUp" },
          { name: "AttackPoints", value: stats.attack.toString() },
          { name: "DefensePoints", value: stats.defense.toString() },
          { name: "SpeedPoints", value: stats.speed.toString() },
          { name: "HealthPoints", value: stats.health.toString() }
        ],
        signer,
        data: ""
      }, () => {
        console.log('[MonsterManagement] Activity executed, refreshing soon...');
        // Trigger the regular refresh
        triggerRefresh();
        
        // Also schedule the forced monster refresh to get the updated monster state
        console.log('[MonsterManagement] Scheduling monster refresh after level up');
        refreshMonsterAfterActivity();
      });
    } catch (error) {
      console.error('[MonsterManagement] Error executing activity:', error);
    } finally {
      setIsLevelingUp(false);
    }
  };

  const handleAdoptMonster = async () => {
    if (isAdopting) return; // Prevent multiple clicks
    
    setIsAdopting(true);
    try {
      await adoptMonster(wallet, () => {
        // Trigger regular refresh
        triggerRefresh();
        
        // Schedule monster refresh after adoption
        console.log('[MonsterManagement] Monster adoption initiated, scheduling refresh');
        refreshMonsterAfterActivity();
      });
    } catch (error) {
      console.error('[MonsterManagement] Adoption error:', error);
    } finally {
      setIsAdopting(false);
    }
  };

  const handlePurchase = async (selectedToken: TokenOption) => {
    try {
      await purchaseAccess(selectedToken, () => {
        // Refresh data after a short delay
        setTimeout(() => triggerRefresh(), 2000);
      });
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

  // Calculate required exp for next level using Fibonacci sequence starting at 5
  const getFibonacciExp = (level: number) => {
    if (level === 0) return 1;
    if (level === 1) return 2;
    
    let a = 1, b = 2;
    for (let i = 2; i <= level; i++) {
      const next = a + b;
      a = b;
      b = next;
    }
    return b;
  };

  // Memoized helper function to determine if a monster's activity is complete
  const isActivityComplete = useCallback((monster: MonsterStats | null): boolean => {
    if (!monster || monster.status.type === 'Home' || monster.status.type === 'Battle') return false;
    return monster.status.until_time && Date.now() > monster.status.until_time;
  }, []);

  const renderMonsterCard = React.useMemo(() => {
    if (!walletStatus?.monster) {
      return (
        <div className={`no-monster-card ${theme.container} border ${theme.border} backdrop-blur-md`}>
          <h2 className={`no-monster-title ${theme.text}`}>Adopt a Monster</h2>
          <button
            onClick={handleAdoptMonster}
            disabled={isAdopting}
            className={`adopt-button ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
          >
            {isAdopting ? 'Adopting...' : 'Adopt Monster'}
          </button>
        </div>
      );
    }

    // Use monster directly from context instead of walletStatus to ensure we have the latest state
    const monster = localMonster || walletStatus.monster;
    const activities = walletStatus.monster.activities;
    
    // Use the memoized helper function to check if activity is complete
    const activityTimeUp = isActivityComplete(monster);

    return (
      <div className={`monster-card ${theme.container} border ${theme.border} backdrop-blur-md p-6`}>
        <div className="flex flex-col md:flex-row gap-8">
          {/* Left Column - Monster Card */}
          <div className="flex flex-col items-center md:w-1/2">
            <MonsterCardDisplay 
              monster={monster}
              expanded={true}
              className="w-full h-full"
            />
          </div>

          {/* Right Column - Stats and Info */}
          <div className="flex flex-col md:w-1/2 space-y-6">
            {/* Enhanced Monster Status Display - Always visible */}
            <div className={`status-section ${theme.container} rounded-lg p-6`}>
              <h3 className={`text-xl font-bold mb-2 ${theme.text}`}>Current Status</h3>
              
              {/* Status information and progress bar */}
              <div className="flex flex-col space-y-2 mb-4">
                <div className="flex justify-between items-center">
                  <span className={`font-medium ${theme.text}`}>
                    Status: <span className="font-bold">{monster.status.type}</span>
                  </span>
                  {monster.status.type !== 'Home' && monster.status.type !== 'Battle' && monster.status.until_time && (
                    <span className={`${theme.text} ${activityTimeUp ? 'text-green-500 font-bold' : ''}`}>
                      {activityTimeUp ? 'Ready to Return!' : `Time Remaining: ${formatTimeRemaining(monster.status.until_time)}`}
                    </span>
                  )}
                </div>
                
                {monster.status.type !== 'Home' && monster.status.type !== 'Battle' && monster.status.until_time && (
                  <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${activityTimeUp ? 'bg-green-500' : 'bg-blue-500'} rounded-full`}
                      style={{ 
                        width: `${calculateProgress(monster.status.since, monster.status.until_time)}%` 
                      }}
                    ></div>
                  </div>
                )}
              </div>
              
              {/* Monster Status Scene */}
              <div className={`monster-status-scene relative bg-cover bg-center rounded-lg overflow-hidden`} 
                   style={{
                     height: '280px', // Fixed height for sprite animations
                     backgroundImage: monster.status.type === 'Home' 
                       ? `url(${new URL('../assets/backgrounds/home.png', import.meta.url).href})` 
                       : monster.status.type === 'Battle'
                         ? `url(${new URL('../assets/backgrounds/1.png', import.meta.url).href})`
                         : `url(${new URL('../assets/backgrounds/activity.png', import.meta.url).href})`
                   }}>
                
                {/* Status Bubble - Shows what the monster is doing */}
                <div className="absolute top-2 right-2 bg-white bg-opacity-80 rounded-full px-3 py-1 z-10 font-semibold text-sm">
                  {monster.status.type === 'Home' ? 'Resting at Home' : monster.status.type}
                </div>
                
                {/* Animated Monster Sprite */}
                <MonsterSpriteView 
                  sprite={monster.sprite}
                  containerWidth={400}
                  containerHeight={280}
                  behaviorMode={monster.status.type === 'Home' ? 'pacing' : 'activity'}
                  activityType={monster.status.type}
                />
                
                {/* Status Effect Particles - Optional visual effects based on activity */}
                {monster.status.type === 'Play' && (
                  <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2">
                    <div className="flex gap-2">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Status message at bottom */}
                <div className="absolute bottom-0 inset-x-0 bg-black bg-opacity-50 text-white p-2 text-center text-sm">
                  {monster.status.type === 'Home' 
                    ? 'Your monster is relaxing at home' 
                    : monster.status.type === 'Play'
                      ? 'Your monster is playing games'
                      : monster.status.type === 'Mission'
                        ? 'Your monster is on a mission'
                        : monster.status.type === 'Battle'
                          ? 'Your monster is in battle'
                          : `Your monster is ${monster.status.type}`
                  }
                </div>
              </div>
            </div>
            
            {/* Activities Section */}
            <MonsterActivities 
              monster={monster}
              activities={activities}
              theme={theme}
            />
            
            {/* Loot Box Section - Added below activities */}
            <div className={`loot-box-section ${theme.container} rounded-lg p-4 mt-4`}>
              <LootBoxUtil 
                className="w-full" 
                externalLootBoxes={lootBoxes} 
                loadDataIndependently={false} 
              />
            </div>
            
            {/* Level Up Button - Moved below loot boxes */}
            {monster.status.type === 'Home' && monster.exp >= getFibonacciExp(monster.level) && (
              <div className={`level-up-section ${theme.container} rounded-lg p-4 mt-4`}>
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className={`text-xl font-bold ${theme.text}`}>Level Up Available</h3>
                    <p className={`${theme.text}`}>Your monster has enough experience to level up</p>
                  </div>
                  <button
                    onClick={handleLevelUp}
                    disabled={isLevelingUp}
                    className={`px-4 py-2 rounded-lg ${theme.buttonBg} ${theme.buttonHover} ${theme.text} level-up-button-glow`}
                  >
                    {isLevelingUp ? 'Leveling...' : 'Level Up'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }, [
    walletStatus?.monster,
    localMonster?.level,
    localMonster?.status,
    localMonster?.energy,
    localMonster?.happiness,
    localMonster?.exp,
    isAdopting,
    isLevelingUp,
    darkMode,
    theme,
    handleAdoptMonster,
    handleLevelUp,
    timeUpdateTrigger,
    isActivityComplete
  ]);

  return (
    <div className="monster-management-container">
      <div className={`monster-management-inner ${theme.bg}`}>
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

        <StatAllocationModal
          isOpen={showStatModal}
          onClose={() => setShowStatModal(false)}
          onConfirm={handleStatConfirm}
          darkMode={darkMode}
        />
        <PurchaseModal
          isOpen={isPurchaseModalOpen}
          onClose={() => setIsPurchaseModalOpen(false)}
          onPurchase={handlePurchase}
          contractName="Eternal Pass"
        />

        <div className={`monster-management-content ${theme.text}`}>
          <div className="monster-management-wrapper">
            {!walletStatus?.isUnlocked ? (
              <div className={`no-monster-card ${theme.container} border ${theme.border} backdrop-blur-md`}>
                <h2 className={`no-monster-title ${theme.text}`}>Unlock Access to Manage Monsters</h2>
                <button
                  onClick={() => setIsPurchaseModalOpen(true)}
                  className={`adopt-button ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                >
                  Purchase Access
                </button>
              </div>
            ) : !walletStatus?.faction ? (
              <div className={`no-monster-card ${theme.container} border ${theme.border} backdrop-blur-md`}>
                <h2 className={`no-monster-title ${theme.text}`}>Join a Faction First</h2>
                <a
                  href="/factions"
                  className={`adopt-button ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                >
                  Choose Your Faction
                </a>
              </div>
            ) : (
              renderMonsterCard
            )}
            
            {/* Loot boxes now appear within the monster card component */}
          </div>
        </div>
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};

export default MonsterManagement;
