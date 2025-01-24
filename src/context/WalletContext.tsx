import React, { createContext, useContext, useState, useEffect } from 'react';
import { checkWalletStatus, WalletStatus } from '../utils/aoHelpers';

interface WalletContextType {
  wallet: any | null;
  walletStatus: WalletStatus | null;
  isCheckingStatus: boolean;
  darkMode: boolean;
  connectWallet: (force?: boolean) => Promise<void>;
  setDarkMode: (mode: boolean) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wallet, setWallet] = useState<any | null>(null);
  const [walletStatus, setWalletStatus] = useState<WalletStatus | null>(() => {
    const cached = localStorage.getItem('walletStatus');
    return cached ? JSON.parse(cached) : null;
  });
  const [isCheckingStatus, setIsCheckingStatus] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(
    localStorage.getItem('darkMode') === 'true'
  );
  const [lastCheck, setLastCheck] = useState<number>(0);

  const checkAndUpdateWalletStatus = async (force: boolean = false) => {
    try {
      // Only check if forced or if it's been more than 30 seconds since last check
      const now = Date.now();
      if (!force && now - lastCheck < 30000) {
        return walletStatus?.isUnlocked || false;
      }

      setIsCheckingStatus(true);
      // @ts-ignore
      const activeAddress = await window.arweaveWallet?.getActiveAddress();
      if (activeAddress) {
        // @ts-ignore
        const walletObj = { address: activeAddress, dispatch: window.arweaveWallet.dispatch };
        setWallet(walletObj);
        const status = await checkWalletStatus({ address: activeAddress });
        console.log('Wallet status updated:', status);
        setWalletStatus(status);
        setLastCheck(now);
        localStorage.setItem('walletStatus', JSON.stringify(status));
        return status.isUnlocked;
      }
      return false;
    } catch (error) {
      console.error('Error checking wallet status:', error);
      return false;
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const connectWallet = async (force: boolean = false) => {
    try {
      const isConnected = await checkAndUpdateWalletStatus(force);
      if (!isConnected) {
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
      console.error('Error connecting wallet:', error);
      throw error;
    }
  };

  useEffect(() => {
    // Check wallet status on mount, force initial check
    checkAndUpdateWalletStatus(true);

    // Set up wallet event listeners
    const handleWalletConnect = () => {
      console.log('Wallet connected');
      checkAndUpdateWalletStatus(true);
    };

    const handleWalletDisconnect = () => {
      console.log('Wallet disconnected');
      setWallet(null);
      setWalletStatus(null);
      localStorage.removeItem('walletStatus');
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
    connectWallet,
    setDarkMode
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
