import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { checkWalletStatus, WalletStatus, getAssetBalances } from '../utils/aoHelpers';
import type { AssetBalance } from '../utils/interefaces';
import { SUPPORTED_ASSET_IDS, ASSET_INFO } from '../constants/Constants';

interface WalletContextType {
  wallet: any | null;
  walletStatus: WalletStatus | null;
  isCheckingStatus: boolean;
  darkMode: boolean;
  refreshTrigger: number;
  assetBalances: AssetBalance[];
  isLoadingAssets: boolean;
  isLoadingInfo: boolean;
  pendingAssets: Set<string>;
  pendingInfo: Set<string>;
  connectWallet: (force?: boolean) => Promise<void>;
  setDarkMode: (mode: boolean) => void;
  triggerRefresh: () => void;
  refreshAssets: () => Promise<void>;
  addAssetBalance: (asset: AssetBalance) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// Cache info for 1 week (in milliseconds)
const INFO_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;

// Get cached asset info from localStorage
const getCachedAssetInfo = (processId: string): any => {
  try {
    const cached = localStorage.getItem(`asset_info_${processId}`);
    if (!cached) return null;

    const parsedCache = JSON.parse(cached);
    if (!parsedCache || !parsedCache.data || !parsedCache.timestamp) {
      localStorage.removeItem(`asset_info_${processId}`);
      return null;
    }

    // Check if cache is still valid (1 week)
    if (Date.now() - parsedCache.timestamp > INFO_CACHE_DURATION) {
      localStorage.removeItem(`asset_info_${processId}`);
      return null;
    }

    return parsedCache.data;
  } catch (error) {
    console.error(`Error retrieving cached asset info for ${processId}:`, error);
    localStorage.removeItem(`asset_info_${processId}`);
    return null;
  }
};

// Store asset info in localStorage
const cacheAssetInfo = (processId: string, info: any): void => {
  try {
    if (!info) return;

    const cacheData = {
      data: info,
      timestamp: Date.now()
    };

    localStorage.setItem(`asset_info_${processId}`, JSON.stringify(cacheData));
  } catch (error) {
    console.error(`Error caching asset info for ${processId}:`, error);
  }
};

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }): JSX.Element => {
  const [wallet, setWallet] = useState<any | null>(null);
  const [walletStatus, setWalletStatus] = useState<WalletStatus | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(
    localStorage.getItem('darkMode') === 'true'
  );
  const [lastCheck, setLastCheck] = useState<number>(0);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [assetBalances, setAssetBalances] = useState<AssetBalance[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState<boolean>(false);
  const [isLoadingInfo, setIsLoadingInfo] = useState<boolean>(false);
  // Track which assets still need balance loading
  const [pendingAssets, setPendingAssets] = useState<Set<string>>(new Set(SUPPORTED_ASSET_IDS));
  
  // Debug log for pendingAssets
  useEffect(() => {
    console.log(`[WalletContext] pendingAssets updated, count: ${pendingAssets.size}`, 
      Array.from(pendingAssets));
  }, [pendingAssets]);
  // Track which assets still need info loading
  const [pendingInfo, setPendingInfo] = useState<Set<string>>(new Set(SUPPORTED_ASSET_IDS));
  
  // Use a ref to track ongoing asset refresh to prevent duplicate requests
  const isRefreshingRef = useRef(false);
  // Use a ref to track last refresh time
  const lastRefreshTimeRef = useRef(0);
  // Minimum time between refreshes (3 seconds)
  const MIN_REFRESH_INTERVAL = 3000;

  // Function to add a single asset to the balances
  const addAssetBalance = useCallback((asset: AssetBalance) => {
    // Cache the asset info for future use
    cacheAssetInfo(asset.info.processId, asset.info);
    
    setAssetBalances(prev => {
      // First, check if this asset already exists in our balances
      const existing = prev.findIndex(a => a.info.processId === asset.info.processId);
      if (existing >= 0) {
        // If it exists, replace it but preserve the info if the new one doesn't have it
        const newBalances = [...prev];
        newBalances[existing] = {
          ...asset,
          info: {
            ...prev[existing].info,
            ...asset.info
          }
        };
        return newBalances;
      } else {
        // Otherwise, add it to the end
        return [...prev, asset];
      }
    });
    
    // Remove this asset from pending balance requests
    setPendingAssets(prev => {
      const newPending = new Set(prev);
      newPending.delete(asset.info.processId);
      return newPending;
    });
    
    // Remove this asset from pending info requests
    setPendingInfo(prev => {
      const newPending = new Set(prev);
      newPending.delete(asset.info.processId);
      return newPending;
    });
  }, []);

  const triggerRefresh = useCallback(() => {
    console.log('[WalletContext] Refresh triggered from message');
    // Schedule the state update after 5 seconds
    setTimeout(() => {
      console.log('[WalletContext] Updating refresh trigger after 5s delay');
      setRefreshTrigger(prev => {
        console.log('[WalletContext] Incrementing refresh trigger from', prev, 'to', prev + 1);
        checkAndUpdateWalletStatus(true);
        return prev + 1;
      });
    }, 5000);
  }, []);

  // Load cached asset info on initial load
  const loadCachedAssetInfo = useCallback(() => {
    if (!wallet?.address) return;
    
    setIsLoadingInfo(true);
    const pendingInfoSet = new Set(SUPPORTED_ASSET_IDS);
    
    // First check for predefined asset info
    for (const processId of SUPPORTED_ASSET_IDS) {
      if (ASSET_INFO[processId]) {
        // Create asset balance with predefined info and zero balance
        const assetBalance = {
          info: ASSET_INFO[processId],
          balance: 0
        };
        
        // Add this asset to our state
        addAssetBalance(assetBalance);
        
        // Remove from pending info list
        pendingInfoSet.delete(processId);
      } else {
        // Check localStorage for cached info
        const cachedInfo = getCachedAssetInfo(processId);
        if (cachedInfo) {
          // Create asset balance with cached info and zero balance
          const assetBalance = {
            info: cachedInfo,
            balance: 0
          };
          
          // Add this asset to our state
          addAssetBalance(assetBalance);
          
          // Remove from pending info list
          pendingInfoSet.delete(processId);
        }
      }
    }
    
    // Update the pending info state
    setPendingInfo(pendingInfoSet);
    setIsLoadingInfo(pendingInfoSet.size > 0);
  }, [wallet, addAssetBalance]);

  const refreshAssets = useCallback(async () => {
    if (!wallet?.address) return;
    
    const now = Date.now();
    // Prevent duplicate requests and throttle refreshes
    if (isRefreshingRef.current) {
      console.log('[WalletContext] Asset refresh already in progress, skipping');
      return;
    }
    
    // Check if we've refreshed recently and not specifically requested
    if (now - lastRefreshTimeRef.current < MIN_REFRESH_INTERVAL) {
      console.log('[WalletContext] Recent refresh detected, using cached data');
      return;
    }

    try {
      isRefreshingRef.current = true;
      setIsLoadingAssets(true);
      
      // Mark all assets as pending balances
      setPendingAssets(new Set(SUPPORTED_ASSET_IDS));
      
      console.log('[WalletContext] Starting asset refresh');
      // Call getAssetBalances with the addAssetBalance callback
      await getAssetBalances(wallet, addAssetBalance);
      
      // Update last refresh time
      lastRefreshTimeRef.current = Date.now();
    } catch (error) {
      console.error('[WalletContext] Error loading asset balances:', error);
    } finally {
      setIsLoadingAssets(false);
      isRefreshingRef.current = false;
    }
  }, [wallet, addAssetBalance]);

  const checkAndUpdateWalletStatus = async (force: boolean = false) => {
    try {
      // Only check if forced or if it's been more than 30 seconds since last check
      const now = Date.now();
      if (!force && now - lastCheck < 30000) {
        console.log('[WalletContext] Skipping status check - within 30s window');
        return walletStatus?.isUnlocked || false;
      }

      console.log('[WalletContext] Checking wallet status', { force, timeSinceLastCheck: now - lastCheck });
      setIsCheckingStatus(true);
      // @ts-ignore
      const activeAddress = await window.arweaveWallet?.getActiveAddress();
      if (!activeAddress) {
        return false;
      }

      // @ts-ignore
      const walletObj = { address: activeAddress, dispatch: window.arweaveWallet.dispatch };
      setWallet(walletObj);

      // Use our new caching system in checkWalletStatus
      const status = await checkWalletStatus({ address: activeAddress }, false);
      if (!status) {
        console.error('[WalletContext] Failed to get wallet status');
        return false;
      }
      console.log('[WalletContext] Wallet status updated:', status);
      // Only update if we got valid data
      if (status) {
        setWalletStatus(status);
      }
      setLastCheck(now);
      return status.isUnlocked;
    } catch (error) {
      console.error('[WalletContext] Error checking wallet status:', error);
      return false;
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const connectWallet = async (force: boolean = false) => {
    try {
      const isConnected = await checkAndUpdateWalletStatus(force);
      if (!isConnected) {
        console.log('[WalletContext] Connecting wallet');
        // @ts-ignore
        await window.arweaveWallet?.connect([
          'ACCESS_ADDRESS',
          'SIGN_TRANSACTION',
          'DISPATCH',
          'SIGNATURE',
          'ACCESS_PUBLIC_KEY',
          'ACCESS_ALL_ADDRESSES',
          'ACCESS_ARWEAVE_CONFIG'
        ]);
        await checkAndUpdateWalletStatus();
      }
    } catch (error) {
      console.error('[WalletContext] Error connecting wallet:', error);
      throw error;
    }
  };

  // Load cached info when wallet becomes available
  useEffect(() => {
    if (wallet?.address) {
      // First load cached info immediately
      loadCachedAssetInfo();
      // Then refresh balances (which will also update any missing info)
      refreshAssets();
    }
  }, [wallet?.address, refreshTrigger, loadCachedAssetInfo, refreshAssets]);

  useEffect(() => {
    // Check wallet status on mount, force initial check
    checkAndUpdateWalletStatus(true);

    // Set up wallet event listeners
    const handleWalletConnect = () => {
      console.log('[WalletContext] Wallet connected');
      checkAndUpdateWalletStatus(true);
    };

    const handleWalletDisconnect = () => {
      console.log('[WalletContext] Wallet disconnected');
      setWallet(null);
      setWalletStatus(null);
      setAssetBalances([]);
      setPendingAssets(new Set());
    };

    // @ts-ignore
    window.addEventListener('walletConnect', handleWalletConnect);
    // @ts-ignore
    window.addEventListener('walletDisconnect', handleWalletDisconnect);

    return () => {
      // @ts-ignore
      window.removeEventListener('walletConnect', handleWalletConnect);
      // @ts-ignore
      window.removeEventListener('walletDisconnect', handleWalletDisconnect);
    };
  }, []);

  // Save dark mode preference to localStorage
  useEffect(() => {
    localStorage.setItem('darkMode', darkMode.toString());
  }, [darkMode]);

  const value = {
    wallet,
    walletStatus,
    isCheckingStatus,
    darkMode,
    refreshTrigger,
    assetBalances,
    isLoadingAssets,
    isLoadingInfo,
    pendingAssets,
    pendingInfo,
    connectWallet,
    setDarkMode,
    triggerRefresh,
    refreshAssets,
    addAssetBalance
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
