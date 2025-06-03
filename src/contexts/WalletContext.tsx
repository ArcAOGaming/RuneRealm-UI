import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { checkWalletStatus, WalletStatus } from '../utils/aoHelpers';



interface WalletContextType {
  wallet: any | null;
  walletStatus: WalletStatus | null;
  isCheckingStatus: boolean;
  darkMode: boolean;
  refreshTrigger: number;
  connectWallet: (force?: boolean) => Promise<void>;
  setDarkMode: (mode: boolean) => void;
  triggerRefresh: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);



export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }): JSX.Element => {
  const [wallet, setWallet] = useState<any | null>(null);
  const [walletStatus, setWalletStatus] = useState<WalletStatus | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(
    localStorage.getItem('darkMode') === 'true'
  );
  const [lastCheck, setLastCheck] = useState<number>(0);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  // Add a ref to track if status check is in progress to prevent duplicate requests
  const isStatusCheckInProgressRef = useRef<boolean>(false);
  // Add a ref to track if initial check is complete
  const initialCheckCompletedRef = useRef<boolean>(false);
  


  const triggerRefresh = useCallback(() => {
    console.log('[WalletContext] Refresh triggered from message');
    // Only schedule refresh if we're not already checking status
    if (isStatusCheckInProgressRef.current) {
      console.log('[WalletContext] Status check already in progress, skipping duplicate refresh');
      return;
    }
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




  const checkAndUpdateWalletStatus = async (force: boolean = false) => {
    try {
      // Prevent concurrent status checks to avoid duplicate admin skin changer queries
      if (isStatusCheckInProgressRef.current) {
        console.log('[WalletContext] Status check already in progress, skipping duplicate check');
        return walletStatus?.isUnlocked || false;
      }
      
      // Only check if forced or if it's been more than 30 seconds since last check
      const now = Date.now();
      if (!force && now - lastCheck < 30000) {
        console.log('[WalletContext] Skipping status check - within 30s window');
        return walletStatus?.isUnlocked || false;
      }

      console.log('[WalletContext] Checking wallet status', { 
        force, 
        timeSinceLastCheck: now - lastCheck,
        initialCheckCompleted: initialCheckCompletedRef.current
      });
      
      // Set the in-progress flag to prevent duplicate checks
      isStatusCheckInProgressRef.current = true;
      setIsCheckingStatus(true);
      
      // @ts-ignore
      const activeAddress = await window.arweaveWallet?.getActiveAddress();
      if (!activeAddress) {
        return false;
      }

      // @ts-ignore
      const walletObj = { address: activeAddress, dispatch: window.arweaveWallet.dispatch };
      setWallet(walletObj);

      // Use our caching system in checkWalletStatus, enabling cache after initial check
      // This is crucial - we want to use cache for the second call in StrictMode
      const useCache = initialCheckCompletedRef.current;
      const status = await checkWalletStatus({ address: activeAddress }, useCache);
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
      // Mark that we've completed the initial check
      initialCheckCompletedRef.current = true;
      
      return status.isUnlocked;
    } catch (error) {
      console.error('[WalletContext] Error checking wallet status:', error);
      return false;
    } finally {
      setIsCheckingStatus(false);
      // Reset the in-progress flag
      isStatusCheckInProgressRef.current = false;
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



  useEffect(() => {
    // Check wallet status on mount, force initial check
    // We'll use setTimeout to slightly delay this to prevent race conditions
    // with React strict mode's double rendering
    const timer = setTimeout(() => {
      console.log('[WalletContext] Performing initial wallet status check');
      checkAndUpdateWalletStatus(true);
    }, 50);

    // Set up wallet event listeners
    const handleWalletConnect = () => {
      console.log('[WalletContext] Wallet connected');
      checkAndUpdateWalletStatus(true);
    };

    const handleWalletDisconnect = () => {
      console.log('[WalletContext] Wallet disconnected');
      setWallet(null);
      setWalletStatus(null);
    };

    // @ts-ignore
    window.addEventListener('walletConnect', handleWalletConnect);
    // @ts-ignore
    window.addEventListener('walletDisconnect', handleWalletDisconnect);

    return () => {
      clearTimeout(timer);
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
    connectWallet,
    setDarkMode,
    triggerRefresh: () => setRefreshTrigger(prev => prev + 1)
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
