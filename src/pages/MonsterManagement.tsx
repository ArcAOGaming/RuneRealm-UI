import React, { useEffect, useState } from 'react';
import '../styles/MonsterManagement.css';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import { purchaseAccess, TokenOption, adoptMonster, getAssetBalances, MonsterStats } from '../utils/aoHelpers';
import { AssetBalance } from '../utils/interefaces';
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

export const MonsterManagement: React.FC = (): JSX.Element => {
  const navigate = useNavigate();
  const { wallet, walletStatus, darkMode, connectWallet, setDarkMode, triggerRefresh, refreshTrigger } = useWallet();
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isAdopting, setIsAdopting] = useState(false);
  const [isFeeding, setIsFeeding] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLevelingUp, setIsLevelingUp] = useState(false);
  const [showStatModal, setShowStatModal] = useState(false);
  const [isOnMission, setIsOnMission] = useState(false);
  const [isInBattle, setIsInBattle] = useState(false);
  const [assetBalances, setAssetBalances] = useState<AssetBalance[]>([]);
  const [localMonster, setLocalMonster] = useState<MonsterStats | null>(null);
  const theme = currentTheme(darkMode);
  const [, setForceUpdate] = useState({});

  // Update local monster and load assets when wallet status changes
  useEffect(() => {
    const updateData = async () => {
      console.log('[MonsterManagement] Checking for updates', {
        hasWallet: !!wallet?.address,
        hasMonster: !!walletStatus?.monster,
        refreshTrigger
      });

      if (wallet?.address) {
        await loadAssetBalances();
      }
      
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

  const loadAssetBalances = async () => {
    try {
      const balances = await getAssetBalances(wallet);
      console.log('Current asset balances:', balances);
      setAssetBalances(balances);
    } catch (error) {
      console.error('Error loading asset balances:', error);
    }
  };

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

      await loadAssetBalances();
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

      await loadAssetBalances();
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

      await loadAssetBalances();
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

      await loadAssetBalances();
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

  // Format time remaining with rounding to nearest minute
  const formatTimeRemaining = (until: number) => {
    const remaining = Math.max(0, until - Date.now());
    const minutes = remaining / 60000;
    const roundedMinutes = Math.ceil(minutes);
    
    if (minutes < 1) {
      const seconds = Math.ceil((remaining % 60000) / 1000);
      return `${seconds}s`;
    } else {
      // Round up if more than 30 seconds into the minute
      const seconds = Math.floor((remaining % 60000) / 1000);
      if (seconds > 30) {
        return `~${roundedMinutes}m`;
      } else {
        return `~${Math.floor(minutes)}m`;
      }
    }
  };

  // Calculate progress percentage (0-100) for activities
  const calculateProgress = (since: number, until: number) => {
    const now = Date.now();
    // If time is up, return 100% immediately
    if (now >= until) return 100;
    const total = until - since;
    const elapsed = now - since;
    // Round to 2 decimal places to avoid floating point issues
    const progress = Math.round((elapsed / total) * 10000) / 100;
    return Math.min(100, Math.max(0, progress));
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
          <h2 className={`no-monster-title ${theme.text}`}>No Monster Yet</h2>
          <p className={`no-monster-text ${theme.text}`}>Ready to begin your journey? Adopt your first monster!</p>
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

    const monster = localMonster || walletStatus.monster;
    const isPlaytime = monster.status.type === 'Play';
    const isMissionTime = monster.status.type === 'Mission';
    const now = Date.now();
    const timeUp = (isPlaytime || isMissionTime) && now >= monster.status.until_time;

    // Use monster's activities directly
    const activities = monster.activities;

    // Get berry balance for play action
    const berryBalance = assetBalances.find(a => a.info.processId === monster.activities?.play?.cost?.token)?.balance || 0;
    const fuelBalance = assetBalances.find(a => a.info.processId === monster.activities?.mission?.cost?.token)?.balance || 0;

    // Check if all requirements are met for each activity
    const canFeed = monster.status.type === 'Home' && 
                    berryBalance >= activities.feed.cost.amount && 
                    monster.energy < 100;

    const canPlay = (monster.status.type === 'Home' && 
                    berryBalance >= activities.play.cost.amount && 
                    monster.energy >= activities.play.energyCost) ||
                    (monster.status.type === 'Play' && timeUp);

    const canMission = (monster.status.type === 'Home' && 
                      fuelBalance >= activities.mission.cost.amount && 
                      monster.energy >= activities.mission.energyCost && 
                      monster.happiness >= activities.mission.happinessCost) ||
                      (monster.status.type === 'Mission' && timeUp);

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
          {/* Left Column - Monster Card and Basic Info */}
          <div className="flex flex-col items-center md:w-2/5">
            <div className="monster-card-header w-full flex justify-between items-center mb-4">
              <div className={`monster-level ${theme.text}`}>
                Level {monster.level}
              </div>
              <button
                onClick={handleLevelUp}
                disabled={isLevelingUp || monster.status.type !== 'Home' || monster.exp < getFibonacciExp(monster.level)}
                className={`px-4 py-2 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} rounded-lg ${(isLevelingUp || monster.status.type !== 'Home' || monster.exp < getFibonacciExp(monster.level)) ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isLevelingUp ? 'Leveling Up...' : 'Level Up'}
              </button>
            </div>
            
            <MonsterCardDisplay 
              monster={monster}
              className="w-full max-w-md mb-4"
            />
            <h2 className={`text-2xl font-bold ${theme.text}`}>{monster.name}</h2>
          </div>

          {/* Right Column - Stats and Info */}
          <div className="flex flex-col md:w-3/5 space-y-6">
            {/* Moves Display */}
            <div className="moves-section">
              <h3 className={`moves-title ${theme.text} mb-2`}>Moves</h3>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(monster.moves).map(([name, move]) => (
                  <div 
                    key={name} 
                    className={`move-card ${move.type} p-2 rounded-lg bg-opacity-20 backdrop-blur-sm relative overflow-hidden`}
                  >
                    {/* Type Badge in Corner */}
                    <div className={`absolute top-0 right-0 px-2 py-0.5 text-xs font-bold ${getTypeColorClass(move.type)} rounded-bl-lg uppercase`}>
                      {move.type}
                    </div>
                    
                    {/* Rarity Stars (under type badge) */}
                    {(move as any).rarity && (
                      <div className="absolute top-5 right-0 px-2 py-0.5">
                        <span className={`text-xs font-medium text-yellow-500`}>
                          {getRarityStars((move as any).rarity)}
                        </span>
                      </div>
                    )}
                    
                    {/* Move Name with Count */}
                    <div className="flex items-center gap-1 mb-1">
                      <div className={`move-name ${theme.text} font-bold text-sm truncate`}>{name}</div>
                      {(move as any).count > 1 && (
                        <span className="bg-gray-200 text-gray-900 rounded-full px-1.5 text-xs font-medium">
                          x{(move as any).count}
                        </span>
                      )}
                    </div>
                    
                    {/* Move Stats - condensed to one row with smaller text */}
                    <div className="move-stats flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-xs">
                      {move.attack !== 0 && move.attack !== undefined && (
                        <div className={`stat-item ${theme.text} flex items-center`}>
                          <span className="stat-icon mr-0.5">⚔️</span>
                          <span className={`${move.attack < 0 ? 'text-red-500' : ''}`}>
                            {move.attack > 0 ? '+' : ''}{move.attack}
                          </span>
                        </div>
                      )}
                      
                      {move.defense !== 0 && move.defense !== undefined && (
                        <div className={`stat-item ${theme.text} flex items-center`}>
                          <span className="stat-icon mr-0.5">🛡️</span>
                          <span className={`${move.defense < 0 ? 'text-red-500' : ''}`}>
                            {move.defense > 0 ? '+' : ''}{move.defense}
                          </span>
                        </div>
                      )}
                      
                      {move.speed !== 0 && move.speed !== undefined && (
                        <div className={`stat-item ${theme.text} flex items-center`}>
                          <span className="stat-icon mr-0.5">⚡</span>
                          <span className={`${move.speed < 0 ? 'text-red-500' : ''}`}>
                            {move.speed > 0 ? '+' : ''}{move.speed}
                          </span>
                        </div>
                      )}
                      
                      {move.health !== 0 && move.health !== undefined && (
                        <div className={`stat-item ${theme.text} flex items-center`}>
                          <span className="stat-icon mr-0.5">❤️</span>
                          <span className={`${move.health < 0 ? 'text-red-500' : ''}`}>
                            {move.health > 0 ? '+' : ''}{move.health}
                          </span>
                        </div>
                      )}
                      
                      {(move as any).damage !== 0 && (move as any).damage !== undefined && (
                        <div className={`stat-item ${theme.text} flex items-center`}>
                          <span className="stat-icon mr-0.5">💥</span>
                          <span className={`${(move as any).damage < 0 ? 'text-red-500' : ''}`}>
                            {(move as any).damage > 0 ? '+' : ''}{(move as any).damage}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Status Bars */}
            <div className="space-y-3">
              {/* Status */}
              <div className="status-bar">
                <div className="status-header flex justify-between">
                  <span className={`${theme.text} text-sm`}>Status: {monster.status.type}</span>
                  {monster.status.type !== 'Home' && (
                    <span className={`${theme.text} text-sm`}>
                      Time Remaining: {formatTimeRemaining(monster.status.until_time)}
                    </span>
                  )}
                </div>
                {monster.status.type !== 'Home' && (
                  <div className="progress-bar mt-1 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="progress-bar-fill activity bg-blue-500 h-2" 
                      style={{ 
                        width: `${calculateProgress(monster.status.since, monster.status.until_time)}%` 
                      }}
                    ></div>
                  </div>
                )}
              </div>

              {/* Energy Bar */}
              <div className="status-bar">
                <div className="status-header flex justify-between">
                  <span className={`${theme.text} text-sm`}>Energy</span>
                  <span className={`${theme.text} text-sm`}>{monster.energy}/100</span>
                </div>
                <div className="progress-bar mt-1 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="progress-bar-fill energy bg-yellow-500 h-2" 
                    style={{ width: `${monster.energy}%` }}
                  ></div>
                </div>
              </div>

              {/* Happiness Bar */}
              <div className="status-bar">
                <div className="status-header flex justify-between">
                  <span className={`${theme.text} text-sm`}>Happiness</span>
                  <span className={`${theme.text} text-sm`}>{monster.happiness}/100</span>
                </div>
                <div className="progress-bar mt-1 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="progress-bar-fill happiness bg-pink-500 h-2" 
                    style={{ width: `${monster.happiness}%` }}
                  ></div>
                </div>
              </div>

              {/* Experience Bar */}
              <div className="status-bar">
                <div className="status-header flex justify-between">
                  <span className={`${theme.text} text-sm`}>Experience</span>
                  <span className={`${theme.text} text-sm`}>{monster.exp}/{getFibonacciExp(monster.level)}</span>
                </div>
                <div className="progress-bar mt-1 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="progress-bar-fill experience bg-purple-500 h-2" 
                    style={{ width: `${Math.min((monster.exp / getFibonacciExp(monster.level)) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Stats Display - Now Horizontal */}
              <div className="stats-display mt-4">
                <h3 className={`text-xl font-bold mb-2 ${theme.text}`}>Stats</h3>
                <div className="flex flex-wrap gap-2">
                  <div className={`stat-item p-2 rounded-lg ${theme.container} transition-all duration-200`}>
                    <span className="font-semibold">Attack:</span> {monster.attack}/{5 + (monster.level * 5)}
                  </div>
                  <div className={`stat-item p-2 rounded-lg ${theme.container} transition-all duration-200`}>
                    <span className="font-semibold">Defense:</span> {monster.defense}/{5 + (monster.level * 5)}
                  </div>
                  <div className={`stat-item p-2 rounded-lg ${theme.container} transition-all duration-200`}>
                    <span className="font-semibold">Speed:</span> {monster.speed}/{5 + (monster.level * 5)}
                  </div>
                  <div className={`stat-item p-2 rounded-lg ${theme.container} transition-all duration-200`}>
                    <span className="font-semibold">Health:</span> {monster.health}/{5 + (monster.level * 5)}
                  </div>
                </div>
              </div>
                
              {/* Activities - Now moved under stats in the side column */}
              <div className="activities-container mt-6">
                <h3 className={`text-xl font-bold mb-2 ${theme.text}`}>Activities</h3>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                  <ActivityCard
                    title="Feed"
                    badge="INSTANT"
                    badgeColor="yellow"
                    gradientFrom="yellow-400"
                    gradientTo="orange-500"
                    tokenLogo={assetBalances.find(a => a.info.processId === activities.feed.cost.token)?.info.logo}
                    tokenBalance={berryBalance}
                    tokenRequired={activities.feed.cost.amount}
                    costs={[]}
                    rewards={[
                      { icon: "✨", text: `+${activities.feed.energyGain} Energy`, color: "green-500" }
                    ]}
                    onAction={handleFeedMonster}
                    isLoading={isFeeding}
                    isDisabled={!canFeed}
                    actionText="Feed"
                    loadingText="Feeding..."
                    theme={theme}
                    highlightSelectable={true}
                  />

                  <ActivityCard
                    title="Play"
                    badge={`${activities.play.duration / 60000}m`}
                    badgeColor="green"
                    gradientFrom="green-400"
                    gradientTo="emerald-500"
                    tokenLogo={assetBalances.find(a => a.info.processId === activities.play.cost.token)?.info.logo}
                    tokenBalance={berryBalance}
                    tokenRequired={activities.play.cost.amount}
                    costs={[
                      { icon: "⚡", text: `-${activities.play.energyCost} Energy`, isAvailable: monster.energy >= activities.play.energyCost }
                    ]}
                    rewards={[
                      { icon: "💝", text: `+${activities.play.happinessGain} Happy`, color: "pink-500" }
                    ]}
                    onAction={handlePlayMonster}
                    isLoading={isPlaying}
                    isDisabled={!canPlay || (monster.status.type !== 'Home' && monster.status.type !== 'Play')}
                    actionText={(monster.status.type === 'Play' && timeUp) ? 'Return from Play' : 'Play'}
                    loadingText="Playing..."
                    theme={theme}
                    highlightSelectable={true}
                  />

                  <ActivityCard
                    title="Battle"
                    badge="ARENA"
                    badgeColor="red"
                    gradientFrom="red-400"
                    gradientTo="purple-500"
                    tokenLogo={assetBalances.find(a => a.info.processId === activities.battle.cost.token)?.info.logo}
                    tokenBalance={fuelBalance}
                    tokenRequired={activities.battle.cost.amount}
                    costs={[
                      { icon: "⚡", text: `-${activities.battle.energyCost} Energy`, isAvailable: monster.energy >= activities.battle.energyCost },
                      { icon: "💝", text: `-${activities.battle.happinessCost} Happy`, isAvailable: monster.happiness >= activities.battle.happinessCost }
                    ]}
                    rewards={[
                      { icon: "⚔️", text: "4 Battles", color: "purple-500" }
                    ]}
                    onAction={handleBattle}
                    isLoading={isInBattle}
                    isDisabled={!canBattle || (monster.status.type !== 'Home' && monster.status.type !== 'Battle')}
                    actionText={(monster.status.type === 'Battle' && canReturn) ? 'Return from Battle' : 'Start Battle'}
                    loadingText="In Battle..."
                    theme={theme}
                    highlightSelectable={true}
                  />

                  <ActivityCard
                    title="Mission"
                    badge={`${activities.mission.duration / 3600000}h`}
                    badgeColor="blue"
                    gradientFrom="blue-400"
                    gradientTo="indigo-500"
                    tokenLogo={assetBalances.find(a => a.info.processId === activities.mission.cost.token)?.info.logo}
                    tokenBalance={fuelBalance}
                    tokenRequired={activities.mission.cost.amount}
                    costs={[
                      { icon: "⚡", text: `-${activities.mission.energyCost} Energy`, isAvailable: monster.energy >= activities.mission.energyCost },
                      { icon: "💝", text: `-${activities.mission.happinessCost} Happy`, isAvailable: monster.happiness >= activities.mission.happinessCost }
                    ]}
                    rewards={[
                      { icon: "✨", text: "+1 EXP", color: "blue-500" }
                    ]}
                    onAction={handleMission}
                    isLoading={isOnMission}
                    isDisabled={!canMission || (monster.status.type !== 'Home' && monster.status.type !== 'Mission')}
                    actionText={(monster.status.type === 'Mission' && timeUp) ? 'Return from Mission' : 'Start Mission'}
                    loadingText="On Mission..."
                    theme={theme}
                    highlightSelectable={true}
                  />
                </div>
              </div>
            </div>
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
    isInBattle
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
