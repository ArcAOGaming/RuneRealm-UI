import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useWallet } from '../hooks/useWallet';
import { formatTokenAmount } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { Gateway, ASSET_INFO } from '../constants/Constants';

// Maximum number of decimal places to display for token amounts
const MAX_DECIMALS = 3;

interface InventorySection {
  title: string;
  items: string[];
}

const Inventory = () => {
  const { 
    wallet, 
    darkMode, 
    assetBalances, 
    isLoadingAssets, 
    pendingAssets,
    refreshAssets,
    querySpecificAssets
  } = useWallet();
  
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

  // Effect to query specific assets based on sections that are open
  useEffect(() => {
    if (!wallet?.address) return;
    
    // Skip fetching if main section is closed
    if (!openSections.main) return;
    
    // Collect all assets that need to be loaded based on open sections
    const assetsToLoad: string[] = [];
    
    inventorySections.forEach(section => {
      if (openSections[section.title]) {
        // For each ticker in this section, find its processId and add to the list
        section.items.forEach(ticker => {
          const processId = tickerToProcessId[ticker.toLowerCase()];
          if (processId) {
            assetsToLoad.push(processId);
          }
        });
      }
    });
    
    // Only proceed if we have assets to load
    if (assetsToLoad.length > 0) {
      console.log(`[Inventory] Loading ${assetsToLoad.length} assets for open sections`);
      querySpecificAssets(assetsToLoad);
    }
  }, [wallet?.address, openSections, inventorySections, tickerToProcessId, querySpecificAssets]);

  // Function to refresh a single token by its processId
  const refreshSingleToken = useCallback((processId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (processId && wallet?.address) {
      console.log(`[Inventory] Refreshing single token: ${processId}`);
      querySpecificAssets([processId]);
    }
  }, [wallet?.address, querySpecificAssets]);

  // Find asset by ticker, looking first in assetBalances and then in ASSET_INFO
  const findAssetByTicker = useCallback((ticker: string) => {
    // First try to find in assetBalances
    const asset = assetBalances.find(a => 
      a.info.ticker.toLowerCase() === ticker.toLowerCase() ||
      a.info.name.toLowerCase() === ticker.toLowerCase()
    );
    
    if (asset) {
      return asset;
    }
    
    // If not found in balances, look in ASSET_INFO
    for (const [processId, info] of Object.entries(ASSET_INFO)) {
      if (info && info.ticker.toLowerCase() === ticker.toLowerCase()) {
        return {
          info: {
            processId,
            logo: info.logo || "",
            name: info.name,
            ticker: info.ticker,
            denomination: info.denomination || 0
          },
          balance: 0
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
        denomination: 0
      },
      balance: 0
    };
  }, [assetBalances]);

  // Get assets for a section
  const getAssetsBySection = useCallback((sectionItems: string[]) => {
    return sectionItems.map(item => findAssetByTicker(item));
  }, [findAssetByTicker]);

  if (!wallet?.address) return null;

  return (
    <div className={`fixed right-4 top-32 ${theme.container} border ${theme.border} backdrop-blur-md transition-all duration-300 rounded-xl z-40 inventory-container max-w-[280px]`}>
      <div className={`flex items-center justify-between p-3 ${theme.text}`}>
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleSection('main')}>
          <span className="text-xl">👜</span>
          <h2 className="text-lg font-bold">Inventory</h2>
        </div>
        <div className="flex items-center gap-2">
          {isLoadingAssets ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#F4860A]"></div>
          ) : (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (openSections.main) {
                  refreshAssets();
                }
              }} 
              className="text-sm hover:text-[#F4860A] transition-colors"
              title="Refresh all assets"
            >
              ↻
            </button>
          )}
        </div>
      </div>
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
              {openSections[section.title] && (
                <div className="space-y-2 pl-2">
                  {getAssetsBySection(section.items).map((asset) => (
                    <div key={asset.info.processId} className={`flex justify-between items-center gap-2 ${theme.text}`}>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={(e) => refreshSingleToken(asset.info.processId, e)}
                          className="relative group" 
                          title={`Refresh ${asset.info.ticker} balance`}
                        >
                          <img 
                            src={`${Gateway}${asset.info.logo}`}
                            alt={asset.info.name}
                            className="w-6 h-6 object-cover rounded-full"
                          />
                          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black bg-opacity-50 rounded-full text-white text-xs">
                            ↻
                          </span>
                        </button>
                        <span>{asset.info.ticker}:</span>
                      </div>
                      <span className="font-bold">
                        {pendingAssets.has(asset.info.processId) ? (
                          <div className="w-8 flex justify-end">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#F4860A]"></div>
                          </div>
                        ) : (
                          (() => {
                            // Format token amount and then limit to MAX_DECIMALS decimal places
                            const formatted = formatTokenAmount(asset.balance.toString(), asset.info.denomination || 0);
                            const parts = formatted.split('.');
                            if (parts.length === 1) {
                              return formatted;
                            } else {
                              return `${parts[0]}.${parts[1].slice(0, MAX_DECIMALS)}`;
                            }
                          })()
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Inventory;
