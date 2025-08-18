import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useWallet } from './WalletContext';
import { getBattleManagerInfo, getActiveBattle, returnFromBattle, enterBattle, ActiveBattle } from '../utils/aoHelpers';

interface BattleManagerInfo {
  wins: number;
  losses: number;
  battlesRemaining: number;
  ranking?: number;
  rating?: number;
}

interface BattleContextType {
  // State
  battleManagerInfo: BattleManagerInfo;
  activeBattle: ActiveBattle | null;
  isLoading: boolean;
  isUpdating: boolean;
  battleHistory: any[]; // Define proper type based on your battle history structure
  
  // Actions
  refreshBattleInfo: () => Promise<{ battleInfo: BattleManagerInfo | null; active: ActiveBattle | null }>;
  startBotBattle: () => Promise<boolean>;
  startRankedBattle: (type: 'open' | 'targeted', challengeAddress?: string) => Promise<boolean>;
  refreshActiveBattle: () => Promise<ActiveBattle | null>;
  returnFromBattle: () => Promise<boolean>;
  updateBattleState: (updates: Partial<ActiveBattle>) => void;
  loadBattleInfo: () => Promise<BattleManagerInfo | null>;
}

const BattleContext = createContext<BattleContextType | undefined>(undefined);

export const BattleProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { wallet } = useWallet();
  const [battleManagerInfo, setBattleManagerInfo] = useState<BattleManagerInfo>({
    wins: 0,
    losses: 0,
    battlesRemaining: 0,
    ranking: 0,
    rating: 1000,
  });
  
  const [activeBattle, setActiveBattle] = useState<ActiveBattle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [battleHistory, setBattleHistory] = useState<any[]>([]);

  // Load battle manager info
  const loadBattleInfo = useCallback(async () => {
    if (!wallet?.address) return null;
    try {
      const info = await getBattleManagerInfo(wallet.address);
      return info;
    } catch (error) {
      console.error('Error loading battle info:', error);
      return null;
    }
  }, [wallet?.address]);

  // Load active battle
  const loadActiveBattle = useCallback(async (): Promise<ActiveBattle | null> => {
    if (!wallet?.address) return null;
    try {
      const battles = await getActiveBattle(wallet.address);
      const battle = Array.isArray(battles) && battles.length > 0 ? battles[0] : null;
      setActiveBattle(battle);
      return battle;
    } catch (error) {
      console.error('Error loading active battle:', error);
      return null;
    }
  }, [wallet?.address]);

  // Initial load
  useEffect(() => {
    let isMounted = true;
    
    const initialize = async () => {
      if (!wallet?.address) return;
      
      try {
        setIsLoading(true);
        const [battleInfo, active] = await Promise.all([
          loadBattleInfo(),
          loadActiveBattle()
        ]);
        
        if (!isMounted) return;
        
        // Only update state if we have new data
        if (battleInfo) {
          setBattleManagerInfo(prev => ({
            ...prev,
            ...battleInfo
          }));
        }
      } catch (error) {
        console.error('Error initializing battle data:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    
    initialize();
    
    // Set up polling for battle updates
    const interval = setInterval(async () => {
      if (wallet?.address && activeBattle) {
        try {
          const updatedBattle = await loadActiveBattle();
          if (!isMounted || !updatedBattle) return;
          
          // Only update if battle state has changed
          if (JSON.stringify(updatedBattle) !== JSON.stringify(activeBattle)) {
            setActiveBattle(updatedBattle);
          }
        } catch (error) {
          console.error('Error polling battle updates:', error);
        }
      }
    }, 10000); // Increased polling interval to 10 seconds
    
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [wallet?.address, loadBattleInfo, loadActiveBattle]);

  // Refresh battle info
  const refreshBattleInfo = useCallback(async () => {
    if (!wallet?.address) return;
    
    try {
      setIsLoading(true);
      const [battleInfo, active] = await Promise.all([
        loadBattleInfo(),
        loadActiveBattle()
      ]);
      
      if (battleInfo) {
        setBattleManagerInfo(prev => ({
          ...prev,
          ...battleInfo
        }));
      }
      
      return { battleInfo, active };
    } catch (error) {
      console.error('Error refreshing battle data:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [wallet?.address, loadBattleInfo, loadActiveBattle]);

  // Start a bot battle
  const startBotBattle = useCallback(async () => {
    if (!wallet?.address) return;
    try {
      setIsUpdating(true);
      const response = await enterBattle(wallet);
      if (response.status === 'success' && response.data) {
        await loadActiveBattle();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error starting bot battle:', error);
      return false;
    } finally {
      setIsUpdating(false);
    }
  }, [wallet, loadActiveBattle]);

  // Start a ranked battle
  const startRankedBattle = useCallback(async (type: 'open' | 'targeted' = 'open', challengeAddress?: string) => {
    if (!wallet?.address) return false;
    try {
      setIsUpdating(true);
      let response;
      
      if (type === 'open') {
        response = await enterBattle(wallet, { challenge: 'OPEN' });
      } else {
        if (!challengeAddress) {
          throw new Error('Challenge address is required for targeted battles');
        }
        response = await enterBattle(wallet, { challenge: challengeAddress });
      }

      if (response.status === 'success' && response.data) {
        await loadActiveBattle();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error starting ranked battle:', error);
      return false;
    } finally {
      setIsUpdating(false);
    }
  }, [wallet, loadActiveBattle]);

  // Refresh active battle
  const refreshActiveBattle = useCallback(async () => {
    return loadActiveBattle();
  }, [loadActiveBattle]);

  // Return from battle
  const handleReturnFromBattle = useCallback(async () => {
    if (!wallet?.address) return false;
    try {
      setIsUpdating(true);
      await returnFromBattle(wallet);
      setActiveBattle(null);
      await loadBattleInfo();
      return true;
    } catch (error) {
      console.error('Error returning from battle:', error);
      return false;
    } finally {
      setIsUpdating(false);
    }
  }, [wallet, loadBattleInfo]);

  // Update battle state
  const updateBattleState = useCallback((updates: Partial<ActiveBattle>) => {
    setActiveBattle(prev => ({
      ...prev!,
      ...updates,
    }));
  }, []);

  const contextValue: BattleContextType = {
    battleManagerInfo,
    activeBattle: activeBattle || null,
    isLoading,
    isUpdating,
    battleHistory,
    refreshBattleInfo,
    startBotBattle,
    startRankedBattle,
    refreshActiveBattle: loadActiveBattle,
    returnFromBattle: handleReturnFromBattle,
    updateBattleState,
    loadBattleInfo,
  };

  return (
    <BattleContext.Provider value={contextValue}>
      {children}
    </BattleContext.Provider>
  );
};

export const useBattle = (): BattleContextType => {
  const context = useContext(BattleContext);
  if (context === undefined) {
    throw new Error('useBattle must be used within a BattleProvider');
  }
  return context;
};
