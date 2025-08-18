import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { MonsterStats } from '../utils/interefaces';
import { getLootBoxes, getUserMonster } from '../utils/aoHelpers';
import { useWallet } from './WalletContext';

// Define the shape of our context
interface MonsterContextType {
  // Monster data
  monster: MonsterStats | null;
  setMonster: React.Dispatch<React.SetStateAction<MonsterStats | null>>;
  isLoadingMonster: boolean;
  
  // Loot boxes data
  lootBoxes: Array<{rarity: number, displayName: string}>;
  isLoadingLootBoxes: boolean;
  
  // Time tracking for activities
  timeUpdateTrigger: number;
  
  // Update functions
  loadMonsterData: () => Promise<void>;
  loadLootBoxes: () => Promise<void>;
  updateTimeTracking: () => void;
  refreshMonsterAfterActivity: () => void;
  
  // Helper functions
  getRarityName: (rarity: number) => string;
  
  // Status calculations
  formatTimeRemaining: (untilTime: number) => string;
  calculateProgress: (sinceTime: number, untilTime: number) => number;
  
  // Debug information
  debugString?: string;
}

// Create the context with a default value
const MonsterContext = createContext<MonsterContextType | undefined>(undefined);

// Helper function to get rarity name
const getRarityName = (rarity: number): string => {
  switch(rarity) {
    case 1: return 'Common';
    case 2: return 'Uncommon';
    case 3: return 'Rare';
    case 4: return 'Epic';
    case 5: return 'Legendary';
    default: return `Level ${rarity}`;
  }
};

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

// Create a provider component
export const MonsterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Get wallet data from useWallet hook
  const { wallet, walletStatus, triggerRefresh, refreshTrigger } = useWallet();
  
  // Define a constant for the delay before refreshing monster data after activities
  // We use 3 seconds to allow the blockchain to process the activity
  const ACTIVITY_REFRESH_DELAY_MS = 3000;
  
  // State for monster data
  const [monster, setMonster] = useState<MonsterStats | null>(null);
  const [isLoadingMonster, setIsLoadingMonster] = useState<boolean>(false);
  
  // State for loot boxes
  const [lootBoxes, setLootBoxes] = useState<Array<{rarity: number, displayName: string}>>([]);
  const [isLoadingLootBoxes, setIsLoadingLootBoxes] = useState<boolean>(false);
  
  // Time tracking for activities
  const [timeUpdateTrigger, setTimeUpdateTrigger] = useState<number>(0);
  
  // Refs for tracking state
  const initialLoadRef = useRef(true);
  const lastRefreshTimeRef = useRef(0);
  const lootBoxesLoadedRef = useRef(false);
  
  // Store the latest triggerRefresh function in a ref to avoid dependency issues
  const triggerRefreshRef = useRef(triggerRefresh);
  
  // Update the ref whenever triggerRefresh changes
  useEffect(() => {
    triggerRefreshRef.current = triggerRefresh;
  }, [triggerRefresh]);
  
  // Throttled refresh function to prevent multiple queries
  const throttledRefresh = useCallback(() => {
    const now = Date.now();
    // Only allow refresh if it's been at least 5 seconds since the last one
    if (now - lastRefreshTimeRef.current > 5000) {
      console.log('[MonsterContext] Executing throttled refresh');
      lastRefreshTimeRef.current = now;
      triggerRefreshRef.current();
    } else {
      console.log('[MonsterContext] Skipping refresh - throttled');
    }
  }, []);
  
  // Load monster data
  const loadMonsterData = useCallback(async () => {
    if (!wallet?.address) return;
    
    setIsLoadingMonster(true);
    try {
      // Check if monster is already in walletStatus
      if (walletStatus?.monster) {
        console.log('[MonsterContext] Setting monster from wallet status');
        setMonster(walletStatus.monster);
      } else {
        // Fetch monster directly if not in walletStatus
        console.log('[MonsterContext] Fetching monster data');
        const monsterData = await getUserMonster(wallet);
        if (monsterData) {
          console.log('[MonsterContext] Monster data fetched successfully');
          setMonster(monsterData);
        }
      }
    } catch (error) {
      console.error('[MonsterContext] Error loading monster data:', error);
    } finally {
      setIsLoadingMonster(false);
    }
  }, [wallet, walletStatus]);
  
  // Function to force refresh monster data after activities with a delay
  const refreshMonsterAfterActivity = useCallback(() => {
    if (!wallet?.address) return;
    
    console.log(`[MonsterContext] Activity completed, will refresh monster data in ${ACTIVITY_REFRESH_DELAY_MS/1000} seconds`);
    
    // Wait for the specified delay before refreshing
    setTimeout(async () => {
      console.log('[MonsterContext] Refreshing monster data after activity...');
      setIsLoadingMonster(true);
      try {
        // Force a direct update from the blockchain, bypassing walletStatus cache
        const monsterData = await getUserMonster(wallet);
        if (monsterData) {
          console.log('[MonsterContext] Monster data refreshed successfully after activity');
          setMonster(monsterData);
          // Also update the time trigger to force UI updates
          setTimeUpdateTrigger(Date.now());
        }
      } catch (error) {
        console.error('[MonsterContext] Error refreshing monster data after activity:', error);
      } finally {
        setIsLoadingMonster(false);
      }
    }, ACTIVITY_REFRESH_DELAY_MS);
  }, [wallet]);
  
  // Load loot boxes
  const loadLootBoxes = useCallback(async () => {
    if (!wallet?.address) return;
    
    setIsLoadingLootBoxes(true);
    try {
      console.log('[MonsterContext] Loading lootbox data');
      const response = await getLootBoxes(wallet.address);
      
      if (response?.result) {
        // Process lootbox data
        const boxes: Array<{rarity: number, displayName: string}> = [];
        
        if (Array.isArray(response.result) && response.result.length > 0) {
          response.result.forEach((box: any) => {
            if (Array.isArray(box)) {
              box.forEach((rarityLevel: number) => {
                boxes.push({
                  rarity: rarityLevel,
                  displayName: getRarityName(rarityLevel)
                });
              });
            } else if (typeof box === 'number') {
              boxes.push({
                rarity: box,
                displayName: getRarityName(box)
              });
            }
          });
        }
        
        setLootBoxes(boxes);
        console.log('[MonsterContext] Processed loot boxes:', boxes);
        lootBoxesLoadedRef.current = true;
      } else {
        setLootBoxes([]);
      }
    } catch (error) {
      console.error('[MonsterContext] Error loading loot boxes:', error);
      setLootBoxes([]);
    } finally {
      setIsLoadingLootBoxes(false);
    }
  }, [wallet?.address]);
  
  // Update time tracking (called by timer)
  const updateTimeTracking = useCallback(() => {
    setTimeUpdateTrigger(Date.now());
  }, []);
  
  // Track previous wallet address and monster data to prevent unnecessary refreshes
  const prevWalletAddressRef = useRef(wallet?.address);
  const prevMonsterRef = useRef<MonsterStats | null>(null);
  
  // Initialize data on component mount or when wallet/monster changes
  useEffect(() => {
    const updateData = async () => {
      // Prevent redundant executions by checking if wallet or monster data has actually changed
      const walletChanged = prevWalletAddressRef.current !== wallet?.address;
      const newMonsterData = walletStatus?.monster;
      const prevMonsterData = prevMonsterRef.current;
      
      // Only update if this is the initial load, wallet changed, or monster data significantly changed
      const shouldUpdate = (
        initialLoadRef.current || 
        walletChanged || 
        (newMonsterData && !prevMonsterData) || 
        (newMonsterData && prevMonsterData && 
          (newMonsterData.name !== prevMonsterData.name || 
           newMonsterData.level !== prevMonsterData.level ||
           newMonsterData.status?.type !== prevMonsterData.status?.type))
      );
      
      if (!shouldUpdate) {
        return; // Skip update if nothing important changed
      }
      
      console.log('[MonsterContext] Checking for updates', {
        hasWallet: !!wallet?.address,
        hasMonster: !!walletStatus?.monster,
        initialLoad: initialLoadRef.current,
        lootBoxesLoaded: lootBoxesLoadedRef.current,
        walletChanged
      });
      
      // Update monster data if available
      if (walletStatus?.monster) {
        console.log('[MonsterContext] Monster state updated');
        setMonster(walletStatus.monster);
        prevMonsterRef.current = walletStatus.monster;
      } else if (wallet?.address && (walletChanged || initialLoadRef.current)) {
        // Load monster data if not in walletStatus (only on wallet change or initial load)
        await loadMonsterData();
      }
      
      // Load lootbox data on initial load or when wallet changes
      if ((initialLoadRef.current || walletChanged) && wallet?.address) {
        await loadLootBoxes();
      }
      
      // Update refs for next comparison
      prevWalletAddressRef.current = wallet?.address;
      
      // Mark initial load as complete
      if (initialLoadRef.current) {
        initialLoadRef.current = false;
      }
    };
    
    updateData();
    // Only depend on wallet address and wallet status monster changing, not the full monster state
  }, [wallet?.address, walletStatus?.monster, loadMonsterData, loadLootBoxes]);
  
  // Update lootboxes when refresh trigger changes
  // We need to use refreshTrigger in a controlled way to avoid excessive refreshes
  const prevRefreshTriggerRef = useRef(refreshTrigger);
  const refreshTimestampRef = useRef<number>(0);
  
  // Debug refresh trigger changes
  useEffect(() => {
    console.log(`[MonsterContext] refreshTrigger changed: ${prevRefreshTriggerRef.current} -> ${refreshTrigger}`);
  }, [refreshTrigger]);
  
  useEffect(() => {
    // Only update lootboxes when refreshTrigger actually changes (not on initial mount)
    // and we've already loaded them once
    const now = Date.now();
    const timeSinceLastRefresh = now - refreshTimestampRef.current;
    
    console.log(`[MonsterContext] Evaluating refresh: prevTrigger=${prevRefreshTriggerRef.current}, currentTrigger=${refreshTrigger}, timeSinceLastRefresh=${timeSinceLastRefresh}ms`);
    
    if (
      prevRefreshTriggerRef.current !== refreshTrigger && 
      lootBoxesLoadedRef.current && 
      wallet?.address && 
      refreshTrigger > 0 && // Only refresh if trigger has a positive value
      timeSinceLastRefresh > 5000 // Add a time-based throttle of 5 seconds
    ) {
      console.log('[MonsterContext] Refreshing lootbox data due to explicit refresh trigger');
      refreshTimestampRef.current = now;
      loadLootBoxes();
    } else {
      // Log reason for skipping refresh
      if (prevRefreshTriggerRef.current === refreshTrigger) {
        console.log('[MonsterContext] Skipping refresh: Trigger unchanged');
      } else if (!lootBoxesLoadedRef.current) {
        console.log('[MonsterContext] Skipping refresh: Lootboxes not initially loaded');
      } else if (!wallet?.address) {
        console.log('[MonsterContext] Skipping refresh: No wallet address');
      } else if (refreshTrigger <= 0) {
        console.log('[MonsterContext] Skipping refresh: Invalid trigger value');
      } else if (timeSinceLastRefresh <= 5000) {
        console.log(`[MonsterContext] Skipping refresh: Too soon (${timeSinceLastRefresh}ms since last refresh)`);
      }
    }
    
    // Update the previous value after handling this refresh
    prevRefreshTriggerRef.current = refreshTrigger;
  }, [refreshTrigger, loadLootBoxes, wallet?.address]);
  
  // Set up timer for activity updates
  useEffect(() => {
    // Only set interval if monster is active in an activity
    if (monster && monster.status && monster.status.type !== 'Home') {
      // Store current status and time values to avoid unneeded triggers
      const statusType = monster.status.type;
      const untilTime = monster.status.until_time;
      
      // Check if we need to continue tracking (activity not yet complete)
      if (untilTime && Date.now() < untilTime) {
        console.log(`[MonsterContext] Starting timer for ${statusType} activity`);
        
        // Use a more frequent timer for smoother UI updates on progress bars.
        // 100ms provides a good balance between smoothness and performance.
        const timer = setInterval(() => {
          const now = Date.now();
          if (now >= untilTime) {
            // Activity complete, clear interval and trigger one final update
            console.log(`[MonsterContext] ${statusType} activity complete, clearing timer`);
            clearInterval(timer);
            updateTimeTracking();
          } else {
            updateTimeTracking();
          }
        }, 100); // Update every 100 milliseconds
        
        return () => {
          console.log(`[MonsterContext] Cleaning up ${statusType} timer`);
          clearInterval(timer);
        };
      }
    }
  }, [monster?.status?.type, monster?.status?.until_time, updateTimeTracking]);

  // Combine all values and functions to provide through context
  const contextValue: MonsterContextType = {
    monster,
    setMonster,
    isLoadingMonster,
    lootBoxes,
    isLoadingLootBoxes,
    timeUpdateTrigger,
    loadMonsterData,
    loadLootBoxes,
    updateTimeTracking,
    refreshMonsterAfterActivity,
    getRarityName,
    formatTimeRemaining,
    calculateProgress
  };
  
  return (
    <MonsterContext.Provider value={contextValue}>
      {children}
    </MonsterContext.Provider>
  );
};

// Custom hook to use the monster context
export const useMonster = (): MonsterContextType => {
  const context = useContext(MonsterContext);
  if (context === undefined) {
    throw new Error('useMonster must be used within a MonsterProvider');
  }
  return context;
};

// Debug component to display monster object fields
export const MonsterDebug: React.FC = () => {
  const { monster, timeUpdateTrigger, isLoadingMonster, lootBoxes, isLoadingLootBoxes } = useMonster();
  
  return (
    <div className="monster-debug p-4 bg-gray-800 text-white rounded-lg overflow-auto max-h-[80vh] my-4">
      <h2 className="text-xl font-bold mb-2">Monster Context Debug</h2>
      
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-blue-300">Context Status</h3>
        <pre className="bg-gray-900 p-2 rounded">
          {JSON.stringify({
            hasMonster: !!monster,
            isLoadingMonster,
            hasLootBoxes: lootBoxes.length > 0,
            isLoadingLootBoxes,
            timeUpdateTrigger
          }, null, 2)}
        </pre>
      </div>
      
      {monster ? (
        <div>
          <h3 className="text-lg font-semibold text-green-300">Monster Object</h3>
          <pre className="bg-gray-900 p-2 rounded overflow-auto">
            {JSON.stringify(monster, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="text-yellow-300">No monster data available</div>
      )}
    </div>
  );
};
