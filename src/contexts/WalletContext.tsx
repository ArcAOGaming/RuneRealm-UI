import React from 'react';
import { useWallet } from '../hooks/useWallet';

const WalletContext = React.createContext<ReturnType<typeof useWallet> | null>(null);

export const useWalletContext = () => {
  const context = React.useContext(WalletContext);
  if (!context) {
    throw new Error('useWalletContext must be used within a WalletProvider');
  }
  return context;
};

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const wallet = useWallet();
  return (
    <WalletContext.Provider value={wallet}>
      {children}
    </WalletContext.Provider>
  );
};
