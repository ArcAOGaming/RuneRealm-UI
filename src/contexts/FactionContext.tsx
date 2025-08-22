import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from './WalletContext';
import { getFactionOptions, getTotalOfferings, getUserOfferings, OfferingData } from '../utils/aoHelpers';
import { FactionOptions, OfferingStats } from '../utils/interefaces';

// Local storage cache utilities
const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface CachedData<T> {
  data: T;
  timestamp: number;
}

const isCacheValid = (timestamp: number, expirationMs: number = ONE_DAY_MS): boolean => {
  return Date.now() - timestamp < expirationMs;
};

function getCachedData<T>(key: string, expirationMs: number = ONE_DAY_MS): CachedData<T> | null {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    
    const parsedCache = JSON.parse(cached) as CachedData<T>;
    if (!parsedCache || !parsedCache.data || !parsedCache.timestamp) {
      localStorage.removeItem(key);
      return null;
    }

    if (!isCacheValid(parsedCache.timestamp, expirationMs)) {
      localStorage.removeItem(key);
      return null;
    }

    console.log(`[FactionCache] Retrieved data for key ${key}`);
    return parsedCache;
  } catch (error) {
    console.error(`[FactionCache] Error retrieving data for key ${key}:`, error);
    localStorage.removeItem(key);
    return null;
  }
}

function setCachedData<T>(key: string, data: T): void {
  try {
    if (!data) {
      console.warn(`[FactionCache] Attempted to cache null/undefined data for key ${key}`);
      return;
    }

    const cacheData: CachedData<T> = {
      data,
      timestamp: Date.now()
    };

    const serialized = JSON.stringify(cacheData);
    localStorage.setItem(key, serialized);
    console.log(`[FactionCache] Stored data for key ${key}`);
  } catch (error) {
    console.error(`[FactionCache] Error storing data for key ${key}:`, error);
  }
}

// User status interface for faction-related data
interface UserFactionStatus {
  faction: string | null;
  offerings: OfferingData | null;
  lastUpdated: number;
}

// Faction context interface
interface FactionContextType {
  // Faction data
  factions: FactionOptions[];
  offeringStats: OfferingStats | null;
  userFactionStatus: UserFactionStatus | null;
  
  // Loading states
  isLoadingFactions: boolean;
  isLoadingOfferingStats: boolean;
  isLoadingUserStatus: boolean;
  
  // Actions
  loadFactionData: (useCache?: boolean) => Promise<void>;
  loadOfferingStats: (useCache?: boolean) => Promise<void>;
  loadUserFactionStatus: (useCache?: boolean) => Promise<void>;
  refreshAllData: () => Promise<void>;
  hardRefresh: () => Promise<void>;
  
  // Helper functions
  getCurrentFaction: () => FactionOptions | null;
  getUserTotalPoints: () => number;
  getFactionTotalPoints: (faction: FactionOptions) => number;
}

const FactionContext = createContext<FactionContextType | undefined>(undefined);

// Activity points constants (matching the main faction page)
const ACTIVITY_POINTS = {
  OFFERING: 10,
  FEED: 1,
  PLAY: 5,
  MISSION: 15
};

export const FactionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { wallet, walletStatus, refreshTrigger } = useWallet();
  
  // State
  const [factions, setFactions] = useState<FactionOptions[]>([]);
  const [offeringStats, setOfferingStats] = useState<OfferingStats | null>(null);
  const [userFactionStatus, setUserFactionStatus] = useState<UserFactionStatus | null>(null);
  
  // Loading states
  const [isLoadingFactions, setIsLoadingFactions] = useState<boolean>(false);
  const [isLoadingOfferingStats, setIsLoadingOfferingStats] = useState<boolean>(false);
  const [isLoadingUserStatus, setIsLoadingUserStatus] = useState<boolean>(false);
  
  // Refs for preventing duplicate requests
  const loadingFactionsRef = useRef<boolean>(false);
  const loadingOfferingStatsRef = useRef<boolean>(false);
  const loadingUserStatusRef = useRef<boolean>(false);
  const initialLoadRef = useRef<boolean>(true);
  
  // Load faction data with caching
  const loadFactionData = useCallback(async (useCache: boolean = true) => {
    if (loadingFactionsRef.current) {
      console.log('[FactionContext] Faction data load already in progress');
      return;
    }
    
    loadingFactionsRef.current = true;
    setIsLoadingFactions(true);
    
    try {
      const cacheKey = 'faction-data';
      
      // Try cache first if enabled
      if (useCache) {
        const cached = getCachedData<FactionOptions[]>(cacheKey, ONE_DAY_MS);
        if (cached) {
          console.log('[FactionContext] Using cached faction data');
          setFactions(cached.data);
          setIsLoadingFactions(false);
          loadingFactionsRef.current = false;
          return;
        }
      }
      
      console.log('[FactionContext] Fetching fresh faction data');
      const factionData = await getFactionOptions(wallet, false);
      
      if (factionData && factionData.length > 0) {
        setFactions(factionData);
        setCachedData(cacheKey, factionData);
        console.log('[FactionContext] Faction data loaded and cached');
      }
    } catch (error) {
      console.error('[FactionContext] Error loading faction data:', error);
    } finally {
      setIsLoadingFactions(false);
      loadingFactionsRef.current = false;
    }
  }, [wallet]);
  
  // Load offering stats with caching
  const loadOfferingStats = useCallback(async (useCache: boolean = true) => {
    if (loadingOfferingStatsRef.current) {
      console.log('[FactionContext] Offering stats load already in progress');
      return;
    }
    
    loadingOfferingStatsRef.current = true;
    setIsLoadingOfferingStats(true);
    
    try {
      const cacheKey = 'offering-stats';
      
      // Try cache first if enabled
      if (useCache) {
        const cached = getCachedData<OfferingStats>(cacheKey, ONE_DAY_MS);
        if (cached) {
          console.log('[FactionContext] Using cached offering stats');
          setOfferingStats(cached.data);
          setIsLoadingOfferingStats(false);
          loadingOfferingStatsRef.current = false;
          return;
        }
      }
      
      console.log('[FactionContext] Fetching fresh offering stats');
      const stats = await getTotalOfferings();
      
      if (stats) {
        setOfferingStats(stats);
        setCachedData(cacheKey, stats);
        console.log('[FactionContext] Offering stats loaded and cached');
      }
    } catch (error) {
      console.error('[FactionContext] Error loading offering stats:', error);
    } finally {
      setIsLoadingOfferingStats(false);
      loadingOfferingStatsRef.current = false;
    }
  }, []);
  
  // Load user faction status with wallet-specific caching
  const loadUserFactionStatus = useCallback(async (useCache: boolean = true) => {
    if (!wallet?.address || loadingUserStatusRef.current) {
      if (!wallet?.address) {
        setUserFactionStatus(null);
      }
      return;
    }
    
    loadingUserStatusRef.current = true;
    setIsLoadingUserStatus(true);
    
    try {
      const cacheKey = `user-faction-status-${wallet.address}`;
      
      // Try cache first if enabled
      if (useCache) {
        const cached = getCachedData<UserFactionStatus>(cacheKey, ONE_DAY_MS);
        if (cached) {
          console.log('[FactionContext] Using cached user faction status');
          setUserFactionStatus(cached.data);
          setIsLoadingUserStatus(false);
          loadingUserStatusRef.current = false;
          return;
        }
      }
      
      console.log('[FactionContext] Fetching fresh user faction status');
      
      // Get user offerings
      const offerings = await getUserOfferings(wallet.address);
      
      const userStatus: UserFactionStatus = {
        faction: walletStatus?.faction || null,
        offerings: offerings || null,
        lastUpdated: Date.now()
      };
      
      setUserFactionStatus(userStatus);
      setCachedData(cacheKey, userStatus);
      console.log('[FactionContext] User faction status loaded and cached');
    } catch (error) {
      console.error('[FactionContext] Error loading user faction status:', error);
    } finally {
      setIsLoadingUserStatus(false);
      loadingUserStatusRef.current = false;
    }
  }, [wallet?.address, walletStatus?.faction]);
  
  // Refresh all data (respects cache)
  const refreshAllData = useCallback(async () => {
    console.log('[FactionContext] Refreshing all faction data');
    await Promise.all([
      loadFactionData(true),
      loadOfferingStats(true),
      loadUserFactionStatus(true)
    ]);
  }, [loadFactionData, loadOfferingStats, loadUserFactionStatus]);
  
  // Hard refresh (bypasses cache)
  const hardRefresh = useCallback(async () => {
    console.log('[FactionContext] Hard refreshing all faction data (bypassing cache)');
    
    // Clear relevant cache entries
    if (wallet?.address) {
      localStorage.removeItem('faction-data');
      localStorage.removeItem('offering-stats');
      localStorage.removeItem(`user-faction-status-${wallet.address}`);
    }
    
    await Promise.all([
      loadFactionData(false),
      loadOfferingStats(false),
      loadUserFactionStatus(false)
    ]);
  }, [wallet?.address, loadFactionData, loadOfferingStats, loadUserFactionStatus]);
  
  // Helper function to get current faction
  const getCurrentFaction = useCallback((): FactionOptions | null => {
    if (!userFactionStatus?.faction) return null;
    return factions.find(f => f.name === userFactionStatus.faction) || null;
  }, [factions, userFactionStatus?.faction]);
  
  // Helper function to calculate user's total points
  const getUserTotalPoints = useCallback((): number => {
    if (!userFactionStatus?.offerings || !walletStatus?.monster) return 0;
    
    const offeringPoints = userFactionStatus.offerings.IndividualOfferings * 10; // OFFERING points
    const feedPoints = (walletStatus.monster.totalTimesFed || 0) * 1; // FEED points
    const playPoints = (walletStatus.monster.totalTimesPlay || 0) * 5; // PLAY points
    const missionPoints = (walletStatus.monster.totalTimesMission || 0) * 15; // MISSION points
    
    return offeringPoints + feedPoints + playPoints + missionPoints;
  }, [userFactionStatus?.offerings, walletStatus?.monster]);
  
  // Helper function to calculate faction's total points
  const getFactionTotalPoints = useCallback((faction: FactionOptions): number => {
    if (!offeringStats) return 0;
    
    const offeringPoints = (offeringStats[faction.name as keyof OfferingStats] || 0) * 10; // OFFERING points
    const feedPoints = Number(faction.totalTimesFed || 0) * 1; // FEED points
    const playPoints = Number(faction.totalTimesPlay || 0) * 5; // PLAY points
    const missionPoints = Number(faction.totalTimesMission || 0) * 15; // MISSION points
    
    return offeringPoints + feedPoints + playPoints + missionPoints;
  }, [offeringStats]);
  
  // Load data on mount and when wallet changes
  useEffect(() => {
    const loadInitialData = async () => {
      if (initialLoadRef.current) {
        console.log('[FactionContext] Loading initial faction data');
        await refreshAllData();
        initialLoadRef.current = false;
      }
    };
    
    loadInitialData();
  }, [refreshAllData]);
  
  // Update user faction status when wallet status changes
  useEffect(() => {
    if (wallet?.address && walletStatus?.faction !== userFactionStatus?.faction) {
      console.log('[FactionContext] Wallet faction changed, updating user status');
      loadUserFactionStatus(true);
    }
  }, [wallet?.address, walletStatus?.faction, userFactionStatus?.faction, loadUserFactionStatus]);
  
  // Handle refresh trigger from wallet context
  useEffect(() => {
    if (refreshTrigger > 0 && !initialLoadRef.current) {
      console.log('[FactionContext] Refresh trigger received, updating data');
      // Use a small delay to allow other contexts to update first
      setTimeout(() => {
        refreshAllData();
      }, 1000);
    }
  }, [refreshTrigger, refreshAllData]);
  
  const contextValue: FactionContextType = {
    factions,
    offeringStats,
    userFactionStatus,
    isLoadingFactions,
    isLoadingOfferingStats,
    isLoadingUserStatus,
    loadFactionData,
    loadOfferingStats,
    loadUserFactionStatus,
    refreshAllData,
    hardRefresh,
    getCurrentFaction,
    getUserTotalPoints,
    getFactionTotalPoints
  };
  
  return (
    <FactionContext.Provider value={contextValue}>
      {children}
    </FactionContext.Provider>
  );
};

// Hook to use the faction context
export const useFaction = (): FactionContextType => {
  const context = useContext(FactionContext);
  if (context === undefined) {
    throw new Error('useFaction must be used within a FactionProvider');
  }
  return context;
};
