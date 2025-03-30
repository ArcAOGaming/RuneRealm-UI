import React, { useEffect, useState, useRef } from 'react';
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

// Helper functions for monster status display
const formatTimeRemaining = (untilTime: number): string => {
  const now = Date.now();
  const timeLeft = Math.max(0, untilTime - now);
  
  if (timeLeft <= 0) return 'Complete';
  
  const hours = Math.floor(timeLeft / (1000 * 60 * 60));
  const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
};

const calculateProgress = (sinceTime: number, untilTime: number): number => {
  const now = Date.now();
  const total = untilTime - sinceTime;
  const elapsed = now - sinceTime;
  
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
};

export const MonsterManagement: React.FC = (): JSX.Element => {
  const navigate = useNavigate();
  const { wallet, walletStatus, darkMode, connectWallet, setDarkMode, triggerRefresh, refreshTrigger, assetBalances, refreshAssets } = useWallet();
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isAdopting, setIsAdopting] = useState(false);
  const [isLevelingUp, setIsLevelingUp] = useState(false);
  const [showStatModal, setShowStatModal] = useState(false);
  const [localMonster, setLocalMonster] = useState<MonsterStats | null>(null);
  const [timeUpdateTrigger, setTimeUpdateTrigger] = useState<number>(0);
  const theme = currentTheme(darkMode);
  const [, setForceUpdate] = useState({});

  // Update local monster when wallet status changes
  useEffect(() => {
    const updateData = async () => {
      console.log('[MonsterManagement] Checking for updates', {
        hasWallet: !!wallet?.address,
        hasMonster: !!walletStatus?.monster,
        refreshTrigger
      });
      
      if (walletStatus?.monster) {
        const monsterChanged = JSON.stringify(walletStatus.monster) !== JSON.stringify(localMonster);
        if (monsterChanged) {
          console.log('[MonsterManagement] Monster state updated:', {
            old: localMonster,
            new: walletStatus.monster
          });
          setLocalMonster(walletStatus.monster);
        } else {
          console.log('[MonsterManagement] Monster state unchanged');
        }
      }
    };
    updateData();
  }, [wallet?.address, walletStatus?.monster, refreshTrigger, localMonster]);

  // Add effect to update timers every second
  useEffect(() => {
    // Only set interval if monster is active in an activity
    if (localMonster && localMonster.status && localMonster.status.type !== 'Home') {
      const timer = setInterval(() => {
        setTimeUpdateTrigger(Date.now());
      }, 1000);
      
      return () => clearInterval(timer);
    }
  }, [localMonster?.status?.type]);

  // Store the latest triggerRefresh function in a ref to avoid dependency issues
  const triggerRefreshRef = useRef(triggerRefresh);
  
  // Update the ref whenever triggerRefresh changes
  useEffect(() => {
    triggerRefreshRef.current = triggerRefresh;
  }, [triggerRefresh]);

  // Handle timer updates for progress bars and countdowns
  useEffect(() => {
    if (!localMonster || localMonster.status.type === 'Home') {
      console.log('[MonsterManagement] No timer needed - monster is home or null');
      return;
    }

    console.log('[MonsterManagement] Starting progress timer');
    // Update every second for smooth progress
    const timer = setInterval(() => {
      const now = Date.now();
      if (now >= localMonster.status.until_time) {
        console.log('[MonsterManagement] Activity complete, clearing timer');
        clearInterval(timer);
        // Force one final update to ensure UI shows 100%
        setForceUpdate({});
        // Trigger a refresh to update the monster state using the ref
        // This avoids the dependency cycle
        triggerRefreshRef.current();
      } else {
        setForceUpdate({});
      }
    }, 1000);

    return () => {
      console.log('[MonsterManagement] Cleaning up progress timer');
      clearInterval(timer);
    };
  }, [localMonster?.status.type, localMonster?.status.until_time]); // Removed triggerRefresh from dependencies

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
      }, triggerRefresh);
    } catch (error) {
      console.error('Error leveling up monster:', error);
    } finally {
      setIsLevelingUp(false);
    }
  };

  const handleAdoptMonster = async () => {
    try {
      setIsAdopting(true);
      const result = await adoptMonster(wallet, triggerRefresh);
      console.log('Adopt monster result:', result);
      if (result.status === "success") {
        setShowConfetti(true);
        setTimeout(() => {
          setShowConfetti(false);
        }, 5000);
      }
    } catch (error) {
      console.error('Error adopting monster:', error);
    } finally {
      setIsAdopting(false);
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

    const monster = { ...walletStatus.monster };
    const activities = walletStatus.monster.activities;
    
    // Calculate if any activity is complete (timeUp is true)
    const activityTimeUp = monster.status.type !== 'Home' && 
                        monster.status.until_time && 
                        Date.now() > monster.status.until_time;

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
            {/* Monster Status Display - Always visible */}
            <div className={`status-section ${theme.container} rounded-lg p-4`}>
              <h3 className={`text-xl font-bold mb-2 ${theme.text}`}>Current Status</h3>
              <div className="flex flex-col space-y-2">
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
            </div>
            
            {/* Activities Section */}
            <MonsterActivities 
              monster={monster}
              activities={activities}
              theme={theme}
            />
            
            {/* Level Up Button - Moved below activities */}
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
    timeUpdateTrigger
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
            
            {walletStatus?.isUnlocked && walletStatus?.faction && (
              <div className="mt-8">
                <LootBoxUtil className="max-w-2xl mx-auto" />
              </div>
            )}
          </div>
        </div>
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};

export default MonsterManagement;
