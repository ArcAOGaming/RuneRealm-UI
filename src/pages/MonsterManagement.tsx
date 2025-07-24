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
import LootBoxUtil from '../components/LootBoxUtil';
import MonsterActivities from '../components/MonsterActivities';
import { useMonster } from '../contexts/MonsterContext';
import MonsterStatusWindow from '../components/MonsterStatusWindow';
import MonsterStatsDisplay from '../components/MonsterStatsDisplay';
import MonsterCardModal from '../components/MonsterCardModal';

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
  const [currentEffect, setCurrentEffect] = useState<string | null>(null);
  const [showCardModal, setShowCardModal] = useState(false);
  const theme = currentTheme(darkMode);
  const [, setForceUpdate] = useState({});
  const effectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerEffect = (effect: string) => {
    setCurrentEffect(effect);
    
    // Clear any existing timeout
    if (effectTimeoutRef.current) {
      clearTimeout(effectTimeoutRef.current);
    }
    
    // Auto-clear the effect after 2 seconds (the duration of the effect animation)
    effectTimeoutRef.current = setTimeout(() => {
      setCurrentEffect(null);
    }, 2000);
  };

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
      if (!wallet) {
        await connectWallet();
        return;
      }
      
      setIsLevelingUp(true);
      console.log('Leveling up monster with stats:', stats);
      
      const signer = createDataItemSigner(wallet);
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
      await adoptMonster(wallet, walletStatus, () => {
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
      if (!wallet) {
        await connectWallet();
        return;
      }
      await purchaseAccess(wallet, selectedToken, () => {
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
    
    return (
      <>
        <div className={`monster-card ${theme.container} border ${theme.border} backdrop-blur-md p-6 flex flex-col h-full max-h-full min-h-[600px]`}>
          {/* Top section containing status window and secondary panel - Flexible height */}
          <div className="flex flex-row space-x-4 flex-1 min-h-0">
            {/* Main Content Area - Status Window (65%) */}
            <div className="monster-status-section flex-grow flex flex-col">
              <MonsterStatusWindow 
                monster={monster}
                theme={theme}
                currentEffect={currentEffect}
                onEffectTrigger={triggerEffect}
                formatTimeRemaining={formatTimeRemaining}
                calculateProgress={calculateProgress}
                isActivityComplete={isActivityComplete}
                onShowCard={() => setShowCardModal(true)}
              />
            </div>

            {/* Secondary Panel - Monster Stats, Treasure and Level Up (35%) */}
            <div className="monster-secondary-section w-[35%] flex flex-col">
              {/* Monster Stats Display - Flexible height */}
              <div className="flex-1 min-h-0">
                <MonsterStatsDisplay
                  monster={monster}
                  theme={theme}
                  isLevelingUp={isLevelingUp}
                  onLevelUp={handleLevelUp}
                />
              </div>
              
              {/* Loot Box Section - Fixed height but responsive */}
              <div className={`loot-box-section ${theme.container} rounded-lg p-2 mb-3 h-[200px] flex-shrink-0`}>
                <LootBoxUtil 
                  className="w-full h-full"
                  externalLootBoxes={lootBoxes} 
                  loadDataIndependently={false} 
                />
              </div>
              
              {/* Level Up Button - Fixed height */}
              {monster.status.type === 'Home' && monster.exp >= getFibonacciExp(monster.level) && (
                <div className={`level-up-section ${theme.container} rounded-lg p-4 flex-shrink-0`}>
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

          {/* Activities Section - Always visible at bottom, centered and evenly spaced */}
          <div className="monster-activities-section w-full mt-6 flex-shrink-0">
            <div className="flex justify-center">
              <div className="w-full max-w-6xl">
                <MonsterActivities 
                  monster={monster}
                  activities={activities}
                  theme={theme}
                />
              </div>
            </div>
          </div>
        </div>
        
        {/* Monster Card Modal */}
        <MonsterCardModal 
          isOpen={showCardModal}
          onClose={() => setShowCardModal(false)}
          monster={monster}
          darkMode={darkMode}
        />
      </>
    );
  }, [
    walletStatus?.monster,
    localMonster,
    theme,
    currentEffect,
    triggerEffect,
    formatTimeRemaining,
    calculateProgress,
    isActivityComplete,
    lootBoxes,
    isAdopting,
    isLevelingUp,
    handleAdoptMonster,
    handleLevelUp
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
