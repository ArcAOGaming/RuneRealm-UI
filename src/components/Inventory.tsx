import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { formatTokenAmount } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { Gateway, SUPPORTED_ASSET_IDS, ASSET_INFO } from '../constants/Constants';

interface InventorySection {
  title: string;
  items: string[];
}

const INVENTORY_SECTIONS: InventorySection[] = [
  {
    title: "Value",
    items: ["TRUNK", "NAB", "RandAOTest"]
  },
  {
    title: "Gems",
    items: ["Ruby", "Emerald", "Topaz"]
  },
  {
    title: "Utility",
    items: ["RUNE", "Scroll"]
  },
  {
    title: "Berries",
    items: ["Air Berries", "Water Berries", "Rock Berries", "Fire Berries"]
  }
];

const Inventory = () => {
  const { 
    wallet, 
    darkMode, 
    assetBalances, 
    isLoadingAssets, 
    pendingAssets,
    refreshAssets 
  } = useWallet();
  const [openSections, setOpenSections] = useState<{ [key: string]: boolean }>({
    main: true,
    "Value": true,
    "Gems": true,
    "Utility": true,
    "Berries": true
  });
  
  const theme = currentTheme(darkMode);

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const findProcessIdByTicker = (ticker: string): string => {
    for (const processId of SUPPORTED_ASSET_IDS) {
      const info = ASSET_INFO[processId];
      if (info && info.ticker.toLowerCase() === ticker.toLowerCase()) {
        return processId;
      }
    }
    const asset = assetBalances.find(a => 
      a.info.ticker.toLowerCase() === ticker.toLowerCase() ||
      a.info.name.toLowerCase() === ticker.toLowerCase()
    );
    return asset ? asset.info.processId : ticker;
  };

  const getAssetsBySection = (sectionItems: string[]) => {
    return sectionItems.map(item => {
      const asset = assetBalances.find(a => 
        a.info.ticker.toLowerCase() === item.toLowerCase() ||
        a.info.name.toLowerCase() === item.toLowerCase()
      );
      
      if (asset) {
        return asset;
      } else {
        const processId = findProcessIdByTicker(item);
        return {
          info: {
            processId: processId,
            logo: "",
            name: item,
            ticker: item,
            denomination: 0
          },
          balance: 0
        };
      }
    });
  };

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
                refreshAssets();
              }} 
              className="text-sm hover:text-[#F4860A] transition-colors"
              title="Refresh assets"
            >
              ↻
            </button>
          )}
        </div>
      </div>
      <div className={`overflow-hidden transition-all duration-300 ${openSections.main ? 'max-h-fit w-full p-3' : 'max-h-0 w-0 p-0'}`}>
        <div className="space-y-3">
          {INVENTORY_SECTIONS.map((section) => (
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
                        <img 
                          src={`${Gateway}${asset.info.logo}`}
                          alt={asset.info.name}
                          className="w-6 h-6 object-cover rounded-full"
                        />
                        <span>{asset.info.ticker}:</span>
                      </div>
                      <span className="font-bold">
                        {isLoadingAssets || pendingAssets.has(asset.info.processId) ? (
                          <div className="w-8 flex justify-end">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#F4860A]"></div>
                          </div>
                        ) : (
                          formatTokenAmount(asset.balance.toString(), asset.info.denomination || 0)
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