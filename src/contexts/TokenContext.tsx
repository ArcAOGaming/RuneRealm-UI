import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { SUPPORTED_ASSET_IDS, ASSET_INFO, SupportedAssetId } from '../constants/Constants';
import type { AssetBalance } from '../utils/interefaces';
import { useWallet } from './WalletContext';
import { createTokenClient } from '../utils/aoHelpers';

// Define loading states for tokens
export type TokenLoadingState = 'loading' | 'loaded' | 'error';

// Interface for our context
interface TokenContextType {
  tokenBalances: Record<SupportedAssetId, AssetBalance>;
  refreshAllTokens: () => void;
  retryToken: (assetId: SupportedAssetId) => void;
  isLoading: boolean;
}

// Create the context
const TokenContext = createContext<TokenContextType | undefined>(undefined);

// Provider component
export const TokenProvider: React.FC<{ children: React.ReactNode }> = ({ children }): JSX.Element => {
  const [tokenBalances, setTokenBalances] = useState<Record<SupportedAssetId, AssetBalance>>({} as Record<SupportedAssetId, AssetBalance>);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  // Track in-flight balance requests to prevent duplicates
  const pendingRequestsRef = useRef<Record<string, Promise<any>>>({});
  
  // Get wallet from context
  const { wallet } = useWallet();
  const walletRef = useRef(wallet);
  
  // Update ref when wallet changes
  useEffect(() => {
    walletRef.current = wallet;
    
    // When wallet changes, refresh all token balances
    if (wallet) {
      fetchAllTokenBalances();
    }
  }, [wallet]);

  // Initialize state with loading status for all tokens
  useEffect(() => {
    const initialBalances: Record<SupportedAssetId, AssetBalance> = {} as Record<SupportedAssetId, AssetBalance>;
    
    SUPPORTED_ASSET_IDS.forEach((assetId) => {
      const assetInfo = ASSET_INFO[assetId];
      if (assetInfo) {
        initialBalances[assetId] = {
          info: assetInfo,
          balance: 0,
          state: wallet ? 'loading' : 'error'
        };
      }
    });
    
    setTokenBalances(initialBalances);
    
    // After initializing, fetch all token balances if wallet is available
    if (wallet) {
      fetchAllTokenBalances();
    }
  }, [wallet]);
  
  // Function to fetch a single token balance
  const fetchTokenBalance = useCallback(async (assetId: SupportedAssetId) => {
    const currentWallet = walletRef.current;
    
    // If no wallet is connected, set error state and return
    if (!currentWallet) {
      setTokenBalances(prev => ({
        ...prev,
        [assetId]: {
          ...prev[assetId],
          state: 'error'
        }
      }));
      return { assetId, success: false, error: 'No wallet connected' };
    }
    // Skip if there's already a request in progress for this token
    if (pendingRequestsRef.current[assetId]) {
      //console.log(`[TokenContext] Skipping duplicate request for ${ASSET_INFO[assetId]?.ticker || assetId} - already in progress`);
      try {
        // Wait for the existing request to complete
        await pendingRequestsRef.current[assetId];
        return;
      } catch (error) {
        //console.error(`[TokenContext] Error waiting for pending request:`, error);
        return;
      }
    }
    
    // Update the token state to loading
    setTokenBalances(prev => ({
      ...prev,
      [assetId]: {
        ...prev[assetId],
        state: 'loading'
      }
    }));
    
    // Create a promise for this request
    const requestPromise = (async () => {
      try {
        const currentWallet = walletRef.current;
        if (!currentWallet) {
          throw new Error('Wallet not connected');
        }
        
        // Create the token client using the helper function
        const tokenClient = createTokenClient(assetId, currentWallet);
        
        //console.log(`[TokenContext] Fetching balance for ${ASSET_INFO[assetId]?.ticker || assetId}...`);
        
        // Fetch the balance
        const balanceResult = await tokenClient.balance();
        const balance = parseInt(balanceResult?.toString() || '0', 10) || 0;
        
        //console.log(`[TokenContext] Balance for ${ASSET_INFO[assetId]?.ticker || assetId}: ${balance}`);
        
        // Update the token in state with its new balance
        setTokenBalances(prev => ({
          ...prev,
          [assetId]: {
            ...prev[assetId],
            balance,
            state: 'loaded'
          }
        }));
        
        return { assetId, balance, success: true };
      } catch (error) {
        //console.error(`[TokenContext] Error fetching balance for ${ASSET_INFO[assetId]?.ticker || assetId}:`, error);
        
        // Mark this token as error
        setTokenBalances(prev => ({
          ...prev,
          [assetId]: {
            ...prev[assetId],
            state: 'error'
          }
        }));
        
        return { assetId, success: false, error };
      } finally {
        // Remove this request from pending requests when done
        delete pendingRequestsRef.current[assetId];
      }
    })();
    
    // Store the promise
    pendingRequestsRef.current[assetId] = requestPromise;
    
    return requestPromise;
  }, []);
  
  // Function to fetch all token balances
  const fetchAllTokenBalances = useCallback(async () => {
    //console.log(`[TokenContext] Fetching all token balances...`);
    setIsLoading(true);
    
    try {
      // Fetch all tokens in parallel
      const promises = SUPPORTED_ASSET_IDS.map(assetId => {
        if (ASSET_INFO[assetId]) {
          return fetchTokenBalance(assetId);
        }
        return Promise.resolve();
      });
      
      // Wait for all requests to complete
      await Promise.all(promises);
    } catch (error) {
      //console.error(`[TokenContext] Error fetching all token balances:`, error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchTokenBalance]);
  
  // Function to retry fetching a specific token
  const retryToken = useCallback((assetId: SupportedAssetId) => {
    //console.log(`[TokenContext] Retrying token fetch for ${ASSET_INFO[assetId]?.ticker || assetId}`);
    fetchTokenBalance(assetId);
  }, [fetchTokenBalance]);
  
  // Function to refresh all tokens
  const refreshAllTokens = useCallback(() => {
    //console.log(`[TokenContext] Refreshing all tokens`);
    fetchAllTokenBalances();
  }, [fetchAllTokenBalances]);
  
  return (
    <TokenContext.Provider value={{
      tokenBalances,
      refreshAllTokens,
      retryToken,
      isLoading
    }}>
      {children}
    </TokenContext.Provider>
  );
};

// Hook to use the token context
export const useTokens = (): TokenContextType => {
  const context = useContext(TokenContext);
  if (!context) {
    throw new Error('useTokens must be used within a TokenProvider');
  }
  return context;
};
