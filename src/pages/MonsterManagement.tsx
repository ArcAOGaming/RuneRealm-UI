import React, { useEffect, useState } from 'react';
import '../styles/MonsterManagement.css';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import { purchaseAccess, TokenOption, adoptMonster, MonsterStats } from '../utils/aoHelpers';
import { createDataItemSigner } from '../config/aoConnection';
import { message } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { TARGET_BATTLE_PID } from '../constants/Constants';
import PurchaseModal from '../components/PurchaseModal';
import StatAllocationModal from '../components/StatAllocationModal';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Confetti from 'react-confetti';
import { MonsterCardDisplay } from '../components/MonsterCardDisplay';
import { ActivityCard } from '../components/ActivityCard';
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
  const [isFeeding, setIsFeeding] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLevelingUp, setIsLevelingUp] = useState(false);
  const [showStatModal, setShowStatModal] = useState(false);
  const [isOnMission, setIsOnMission] = useState(false);
  const [isInBattle, setIsInBattle] = useState(false);
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
        // Trigger a refresh to update the monster state
        triggerRefresh();
      } else {
        setForceUpdate({});
      }
    }, 1000);

    return () => {
      console.log('[MonsterManagement] Cleaning up progress timer');
      clearInterval(timer);
    };
  }, [localMonster?.status.type, localMonster?.status.until_time, triggerRefresh]);

  // Add battle handler
  const handleBattle = async () => {
    if (!walletStatus?.monster || !wallet?.address) return;

    const isBattleTime = walletStatus.monster.status.type === 'Battle';
    const canReturn = isBattleTime && Date.now() > walletStatus.monster.status.until_time;

    try {
      setIsInBattle(true);
      console.log('Handling battle');
      
      const signer = createDataItemSigner(window.arweaveWallet);

      if (canReturn) {
        await message({
          process: TARGET_BATTLE_PID,
          tags: [
            { name: "Action", value: "ReturnFromBattle" }
          ],
          signer,
          data: ""
        }, triggerRefresh);
      } else {
        const battleConfig = walletStatus.monster.activities.battle;
        const fuelAsset = assetBalances.find(a => a.info.processId === battleConfig.cost.token);
        
        if (!fuelAsset || fuelAsset.balance < battleConfig.cost.amount) {
          console.error('Not enough battle fuel');
          return;
        }

        await message({
          process: battleConfig.cost.token,
          tags: [
            { name: "Action", value: "Transfer" },
            { name: "Quantity", value: battleConfig.cost.amount.toString() },
            { name: "Recipient", value: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI" },
            { name: "X-Action", value: "Battle" }
          ],
          signer,
          data: ""
        }, triggerRefresh);

        // Navigate to battle page
        navigate('/battle');
      }

      refreshAssets();
    } catch (error) {
      console.error('Error with battle:', error);
    } finally {
      setIsInBattle(false);
    }
  };

  const handleFeedMonster = async () => {
    if (!walletStatus?.monster || !wallet?.address) return;
    
    const feedConfig = walletStatus.monster.activities.feed.cost;
    console.log('Using berry process ID:', feedConfig.token);

    const asset = assetBalances.find(a => a.info.processId === feedConfig.token);
    console.log('Found asset:', asset);
    if (!asset || asset.balance < feedConfig.amount) {
      console.error('Not enough berries', {
        token: feedConfig.token,
        asset,
        currentBalance: asset?.balance || 0,
        required: feedConfig.amount
      });
      return;
    }

    try {
      setIsFeeding(true);
      console.log('Feeding monster with berry process:', feedConfig.token);
      
      const signer = createDataItemSigner(window.arweaveWallet);
      await message({
        process: feedConfig.token,
        tags: [
          { name: "Action", value: "Transfer" },
          { name: "Quantity", value: feedConfig.amount.toString() },
          { name: "Recipient", value: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI" },
          { name: "X-Action", value: "FEED" }
        ],
        signer,
        data: ""
      }, triggerRefresh);

      refreshAssets();
    } catch (error) {
      console.error('Error feeding monster:', error);
    } finally {
      setIsFeeding(false);
    }
  };

  const handlePlayMonster = async () => {
    if (!walletStatus?.monster || !wallet?.address) return;
    
    const playConfig = walletStatus.monster.activities.play.cost;
    console.log('Using berry process ID:', playConfig.token);

    const isPlaytime = walletStatus.monster.status.type === 'Play';
    const canReturn = isPlaytime && Date.now() > walletStatus.monster.status.until_time;

    if (!canReturn) {
      const asset = assetBalances.find(a => a.info.processId === playConfig.token);
      console.log('Found asset:', asset);
      if (!asset || asset.balance < playConfig.amount) {
        console.error('Not enough berries', {
          token: playConfig.token,
          asset,
          currentBalance: asset?.balance || 0,
          required: playConfig.amount
        });
        return;
      }
    }

    try {
      setIsPlaying(true);
      console.log('Playing with monster');
      
      const signer = createDataItemSigner(window.arweaveWallet);

      if (canReturn) {
        await message({
          process: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI",
          tags: [
            { name: "Action", value: "ReturnFromPlay" }
          ],
          signer,
          data: ""
        }, triggerRefresh);
      } else {
        await message({
          process: playConfig.token,
          tags: [
            { name: "Action", value: "Transfer" },
            { name: "Quantity", value: playConfig.amount.toString() },
            { name: "Recipient", value: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI" },
            { name: "X-Action", value: "Play" }
          ],
          signer,
          data: ""
        }, triggerRefresh);
      }

      refreshAssets();
    } catch (error) {
      console.error('Error with play action:', error);
    } finally {
      setIsPlaying(false);
    }
  };

  const handleMission = async () => {
    if (!walletStatus?.monster || !wallet?.address) return;

    const isMissionTime = walletStatus.monster.status.type === 'Mission';
    const canReturn = isMissionTime && Date.now() > walletStatus.monster.status.until_time;

    try {
      setIsOnMission(true);
      console.log('Handling mission');
      
      const signer = createDataItemSigner(window.arweaveWallet);

      if (canReturn) {
        await message({
          process: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI",
          tags: [
            { name: "Action", value: "ReturnFromMission" }
          ],
          signer,
          data: ""
        }, triggerRefresh);
      } else {
        const missionConfig = walletStatus.monster.activities.mission;
        const fuelAsset = assetBalances.find(a => a.info.processId === missionConfig.cost.token);
        
        if (!fuelAsset || fuelAsset.balance < missionConfig.cost.amount) {
          console.error('Not enough mission fuel');
          return;
        }

        await message({
          process: missionConfig.cost.token,
          tags: [
            { name: "Action", value: "Transfer" },
            { name: "Quantity", value: missionConfig.cost.amount.toString() },
            { name: "Recipient", value: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI" },
            { name: "X-Action", value: "Mission" }
          ],
          signer,
          data: ""
        }, triggerRefresh);
      }

      refreshAssets();
    } catch (error) {
      console.error('Error with mission:', error);
    } finally {
      setIsOnMission(false);
    }
  };

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

  // Utility function to get appropriate color class based on move type
  const getTypeColorClass = (type: string): string => {
    const typeColors: Record<string, string> = {
      water: 'bg-blue-500 text-white',
      fire: 'bg-red-500 text-white',
      earth: 'bg-green-500 text-white',
      air: 'bg-cyan-400 text-white',
      light: 'bg-yellow-300 text-black',
      dark: 'bg-purple-700 text-white',
      normal: 'bg-gray-400 text-black',
      boost: 'bg-orange-400 text-white',
      heal: 'bg-emerald-400 text-white',
      // Add more types as needed
    };
    
    return typeColors[type.toLowerCase()] || 'bg-gray-500 text-white'; // Default fallback
  };

  // Utility function to get rarity badge class
  const getRarityBadgeClass = (rarity: number): string => {
    const rarityClasses: Record<number, string> = {
      1: 'bg-gray-300 text-gray-800', // Common
      2: 'bg-blue-300 text-blue-800', // Uncommon
      3: 'bg-purple-300 text-purple-800', // Rare
      4: 'bg-yellow-300 text-yellow-800', // Epic
      5: 'bg-red-300 text-red-800', // Legendary
    };
    
    return rarityClasses[rarity] || 'bg-gray-300 text-gray-800'; // Default to common
  };

  // Utility function to display rarity stars
  const getRarityStars = (rarity: number): string => {
    const stars = '★'.repeat(rarity);
    return stars || '★'; // At least one star
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
    
    // Calculate if monster can feed
    const fuelBalance = assetBalances.find(a => a.info.processId === activities.feed.cost.token)?.balance || 0;
    const berryBalance = assetBalances.find(a => a.info.processId === activities.feed.cost.token)?.balance || 0;
    const canFeed = monster.status.type === 'Home' && berryBalance >= activities.feed.cost.amount;
    
    // Check if all requirements are met for each activity
    const canPlay = (monster.status.type === 'Home' && 
                    berryBalance >= activities.play.cost.amount && 
                    monster.energy >= activities.play.energyCost) ||
                    (monster.status.type === 'Play' && activityTimeUp);

    const canMission = (monster.status.type === 'Home' && 
                      fuelBalance >= activities.mission.cost.amount && 
                      monster.energy >= activities.mission.energyCost && 
                      monster.happiness >= activities.mission.happinessCost) ||
                      (monster.status.type === 'Mission' && activityTimeUp);

    const isBattleTime = monster.status.type === 'Battle';
    const canReturn = isBattleTime && Date.now() > monster.status.until_time;
    const canBattle = (monster.status.type === 'Home' && 
                     fuelBalance >= activities.battle.cost.amount && 
                     monster.energy >= activities.battle.energyCost && 
                     monster.happiness >= activities.battle.happinessCost) ||
                     (monster.status.type === 'Battle' && canReturn);

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
              canPlay={canPlay}
              canFeed={canFeed}
              canMission={canMission}
              canBattle={canBattle}
              canReturn={canReturn}
              assetBalances={assetBalances}
              isFeeding={isFeeding}
              isPlaying={isPlaying}
              isInBattle={isInBattle}
              isOnMission={isOnMission}
              timeUp={activityTimeUp}
              handleFeedMonster={handleFeedMonster}
              handlePlayMonster={handlePlayMonster}
              handleBattle={handleBattle}
              handleMission={handleMission}
              theme={theme}
              berryBalance={berryBalance}
              fuelBalance={fuelBalance}
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
    localMonster?.level,
    localMonster?.status,
    localMonster?.energy,
    localMonster?.happiness,
    localMonster?.exp,
    localMonster?.attack,
    localMonster?.defense,
    localMonster?.speed,
    localMonster?.health,
    localMonster?.moves,
    assetBalances,
    isAdopting,
    isFeeding,
    isPlaying,
    isLevelingUp,
    isOnMission,
    darkMode,
    theme,
    handleAdoptMonster,
    handleFeedMonster,
    handlePlayMonster,
    handleMission,
    handleLevelUp,
    handleBattle,
    isInBattle,
    timeUpdateTrigger // Only keep this dependency
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
            <h1 className={`monster-management-title ${theme.text}`}>Monster Management</h1>
            
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
