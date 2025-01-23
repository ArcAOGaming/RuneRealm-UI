import { useState, useEffect } from 'react';
import { checkWalletStatus, WalletStatus } from '../utils/aoHelpers';

interface UseWalletReturn {
  wallet: any | null;
  walletStatus: WalletStatus | null;
  isCheckingStatus: boolean;
  darkMode: boolean;
  connectWallet: () => Promise<void>;
  setDarkMode: (mode: boolean) => void;
}

export const useWallet = (): UseWalletReturn => {
  const [wallet, setWallet] = useState<any | null>(null);
  const [walletStatus, setWalletStatus] = useState<WalletStatus | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(
    localStorage.getItem('darkMode') === 'true'
  );

  const checkAndUpdateWalletStatus = async () => {
    try {
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

  const connectWallet = async () => {
    try {
      const isConnected = await checkAndUpdateWalletStatus();
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
    // Check wallet status on mount
    checkAndUpdateWalletStatus();

    // Set up wallet event listeners
    const handleWalletConnect = () => {
      console.log('Wallet connected');
      checkAndUpdateWalletStatus();
    };

    const handleWalletDisconnect = () => {
      console.log('Wallet disconnected');
      setWallet(null);
      setWalletStatus(null);
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

  return {
    wallet,
    walletStatus,
    isCheckingStatus,
    darkMode,
    connectWallet,
    setDarkMode
  };
};
