import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useTokens } from '../contexts/TokenContext';
import { formatTokenAmount } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { Gateway, ASSET_INFO, SupportedAssetId } from '../constants/Constants';
import TokenAnimation from './TokenAnimation';

// Maximum number of decimal places to display for token amounts
const MAX_DECIMALS = 3;

interface InventorySection {
  title: string;
  items: string[];
}

const Inventory = () => {
  // Get wallet info from WalletContext
  const { wallet, darkMode } = useWallet();
  
  // Get token info from TokenContext
  const { 
    tokenBalances, 
    refreshAllTokens,
    retryToken,
    isLoading
  } = useTokens();
  
  const theme = currentTheme(darkMode);

  // Initialize openSections state once on component mount
  const [openSections, setOpenSections] = useState<{ [key: string]: boolean}>(() => {
    // Start with main section open and initialize other sections
    const sections: { [key: string]: boolean } = { main: true };
    
    // Map through ASSET_INFO to find all unique sections
    const uniqueSections = new Set<string>();
    Object.values(ASSET_INFO).forEach(info => {
      if (info && info.section) {
        uniqueSections.add(info.section);
      }
    });
    
    // Set all sections to open by default
    uniqueSections.forEach(section => {
      sections[section] = true;
    });
    
    return sections;
  });

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Group assets by section from ASSET_INFO - this is static data
  const inventorySections = useMemo(() => {
    const sectionMap: Record<string, string[]> = {};
    
    // Populate the map from ASSET_INFO
    Object.entries(ASSET_INFO).forEach(([processId, info]) => {
      if (info && info.section) {
        if (!sectionMap[info.section]) {
          sectionMap[info.section] = [];
        }
        sectionMap[info.section].push(info.ticker);
      }
    });
    
    // Convert the map to an array of InventorySection objects
    return Object.entries(sectionMap).map(([title, items]) => ({
      title,
      items
    }));
  }, []); // ASSET_INFO is constant, so no dependencies needed

  // Map ticker names to their processIds
  const tickerToProcessId = useMemo(() => {
    const mapping: Record<string, string> = {};
    
    Object.entries(ASSET_INFO).forEach(([processId, info]) => {
      if (info && info.ticker) {
        mapping[info.ticker.toLowerCase()] = processId;
      }
    });
    
    return mapping;
  }, []);

  // Effect to log token states when sections change - uses already loaded tokens
  useEffect(() => {
    if (!wallet?.address) return;
    
    // Skip if main section is closed
    if (!openSections.main) return;
    
    // Log the current state of tokens but don't refresh them
    // TokenContext already handles the initial loading of tokens
    console.log('[Inventory] Using current state of tokens:', tokenBalances);
  }, [wallet?.address, openSections, tokenBalances]);

  // Function to refresh a single token by its processId
  const refreshSingleToken = useCallback((processId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (processId && wallet?.address) {
      console.log(`[Inventory] Refreshing single token: ${processId}`);
      // Use the retryToken function 
      retryToken(processId as SupportedAssetId);
    }
  }, [wallet?.address, retryToken]);

  // Find asset by ticker, looking first in tokenBalances and then in ASSET_INFO
  const findAssetByTicker = useCallback((ticker: string) => {
    // First try to find in tokenBalances by matching ticker
    for (const assetId of Object.keys(tokenBalances) as SupportedAssetId[]) {
      const token = tokenBalances[assetId];
      if (token && 
        (token.info.ticker.toLowerCase() === ticker.toLowerCase() ||
         token.info.name.toLowerCase() === ticker.toLowerCase())
      ) {
        return token;
      }
    }
    
    // If not found in tokenBalances, look in ASSET_INFO
    for (const [processId, info] of Object.entries(ASSET_INFO)) {
      if (info && info.ticker.toLowerCase() === ticker.toLowerCase()) {
        return {
          info: {
            processId,
            logo: info.logo || "",
            name: info.name,
            ticker: info.ticker,
            denomination: info.denomination || 0,
            section: info.section,
            ...(info.spriteMap && { spriteMap: info.spriteMap })
          },
          balance: 0,
          // Always set state to loading for assets not in tokenBalances
          state: 'loading'
        };
      }
    }
    
    // If still not found, return a default object
    return {
      info: {
        processId: ticker,
        logo: "",
        name: ticker,
        ticker: ticker,
        denomination: 0,
        section: "Unknown"
      },
      balance: 0,
      state: 'loading'
    };
  }, [tokenBalances]);

  // Get assets for a section
  const getAssetsBySection = useCallback((sectionItems: string[]) => {
    return sectionItems.map(item => findAssetByTicker(item));
  }, [findAssetByTicker]);

  // Always render the component structure even if wallet isn't connected yet
  // This helps the UI appear immediately without waiting for assets to load
  const hasWallet = !!wallet?.address;

  return (
    <div className={`fixed right-4 top-32 ${theme.container} border ${theme.border} backdrop-blur-md transition-all duration-300 rounded-xl z-40 inventory-container w-full max-w-60`}>
      <div className={`flex items-center justify-between p-3 ${theme.text}`}>
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleSection('main')}>
          <span className="text-xl">👜</span>
          <h2 className="text-lg font-bold">Inventory</h2>
        </div>
        <div className="flex items-center gap-2">
          {hasWallet ? (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (openSections.main) {
                  refreshAllTokens();
                }
              }} 
              className="text-sm hover:text-[#F4860A] transition-colors"
              title="Refresh all assets"
            >
              ↻
            </button>
          ) : null}
        </div>
      </div>
      {!hasWallet && openSections.main ? (
        <div className="p-3 text-center">
          <p className={`${theme.text} text-sm`}>Connect wallet to view assets</p>
        </div>
      ) : (
        <div className={`overflow-hidden transition-all duration-300 ${openSections.main ? 'max-h-fit w-full p-3' : 'max-h-0 w-0 p-0'}`}>
          <div className="space-y-3">
            {inventorySections.map((section) => (
              <div key={section.title} className="border-b border-[#F4860A]/30 last:border-b-0 pb-3 last:pb-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSection(section.title);
                  }}
                  className={`w-full flex items-center justify-between mb-2 ${theme.text} hover:opacity-80 transition-opacity`}
                >
                  <span className="font-bold">{section.title}</span>
                  <span className="transform transition-transform duration-200" style={{ transform: openSections[section.title] ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
                </button>
                {hasWallet && openSections[section.title] && (
                  <div className="space-y-2 pl-2">
                    {getAssetsBySection(section.items).map((asset) => (
                      <div key={asset.info.processId} className={`flex justify-between items-center gap-2 ${theme.text}`}>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={(e) => refreshSingleToken(asset.info.processId, e)}
                            className="relative group" 
                            title={`Refresh ${asset.info.ticker} balance`}
                          >
                            {('spriteMap' in asset.info && asset.info.spriteMap) ? (
                              <TokenAnimation 
                                spriteMapTxid={asset.info.spriteMap}
                                alt={asset.info.name}
                                className="w-6 h-6 rounded-full"
                              />
                            ) : (
                              <img 
                                src={`${Gateway}${asset.info.logo}`}
                                alt={asset.info.name}
                                className="w-6 h-6 object-cover rounded-full"
                              />
                            )}
                            {asset.state === 'loading' ? (
                              <span className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-full text-white text-xs">
                                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-[#F4860A]"></div>
                              </span>
                            ) : (
                              <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black bg-opacity-50 rounded-full text-white text-xs">
                                ↻
                              </span>
                            )}
                          </button>
                          <span>{asset.info.ticker}:</span>
                        </div>
                        <span className="font-bold">
                          {(() => {
                            const hasTrueBalance = asset.balance > 0;
                            
                            // Determine if we should show loading state
                            // An asset should show loading if:
                            // 1. It's explicitly in loading state OR
                            // 2. It has zero balance and isn't explicitly marked as loaded (might be initializing)
                            const isLoading = 
                              asset.state === 'loading' || 
                              (asset.balance === 0 && asset.state !== 'loaded');
                            
                            if (isLoading) {
                              return (
                                <div className="w-8 flex justify-end">
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#F4860A]"></div>
                                </div>
                              );
                            } else if (asset.state === 'error') {
                              return (
                                <div className="w-8 flex justify-end">
                                  <div className="text-red-500 text-sm">Error</div>
                                </div>
                              );
                            } else {
                              // Format token amount and then limit to MAX_DECIMALS decimal places
                              const formatted = formatTokenAmount(asset.balance.toString(), asset.info.denomination || 0);
                              const parts = formatted.split('.');
                              if (parts.length === 1) {
                                return formatted;
                              } else {
                                return `${parts[0]}.${parts[1].slice(0, MAX_DECIMALS)}`;
                              }
                            }
                          })()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;
