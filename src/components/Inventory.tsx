import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { formatTokenAmount } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { Gateway } from '../constants/Constants';

interface InventorySection {
  title: string;
  items: string[];
}

const INVENTORY_SECTIONS: InventorySection[] = [
  {
    title: "Value",
    items: ["TRUNK", "NAB"]
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
    pendingInfo,
    refreshAssets 
  } = useWallet();
  const [openSections, setOpenSections] = useState<{ [key: string]: boolean }>({
    main: true,
    "Value": true,
    "Gems": true,
    "Utility": true,
    "Berries": true
  });

  // No need for a duplicate refreshAssets call here, it's already called by the WalletContext
  const [loadingIcons, setLoadingIcons] = useState<{ [key: string]: boolean }>({});
  const theme = currentTheme(darkMode);

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleImageLoad = (processId: string) => {
    setLoadingIcons(prev => ({
      ...prev,
      [processId]: false
    }));
  };

  const handleImageError = (processId: string) => {
    setLoadingIcons(prev => ({
      ...prev,
      [processId]: false
    }));
  };

  const getAssetsBySection = (sectionItems: string[]) => {
    // Get all assets that match the section items, including those with 0 balance
    const matchingAssets = assetBalances.filter(asset => 
      sectionItems.some(item => 
        asset.info.ticker.toLowerCase() === item.toLowerCase() ||
        asset.info.name.toLowerCase() === item.toLowerCase()
      )
    );

    // Create a map of all possible items with their balances (0 if not found)
    const result = sectionItems.map(item => {
      const asset = matchingAssets.find(a => 
        a.info.ticker.toLowerCase() === item.toLowerCase() ||
        a.info.name.toLowerCase() === item.toLowerCase()
      );
      
      return asset || {
        info: {
          processId: item,
          logo: "", // Default logo if needed
          name: item,
          ticker: item,
          denomination: 0
        },
        balance: 0
      };
    });

    return result;
  };

  if (!wallet?.address) return null;

  return (
    <div className={`fixed right-4 top-32 ${theme.container} border ${theme.border} backdrop-blur-md transition-all duration-300 rounded-xl z-40 inventory-container max-w-[280px]`}>
      <div className={`flex items-center justify-between p-3 ${theme.text}`}>
        <div 
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => toggleSection('main')}
        >
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
          <span 
            className="transform transition-transform duration-200 cursor-pointer" 
            style={{
              transform: openSections.main ? 'rotate(90deg)' : 'rotate(0deg)'
            }}
            onClick={() => toggleSection('main')}
          >
            ›
          </span>
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
                <span 
                  className="transform transition-transform duration-200" 
                  style={{
                    transform: openSections[section.title] ? 'rotate(90deg)' : 'rotate(0deg)'
                  }}
                >
                  ›
                </span>
              </button>
              {openSections[section.title] && (
                <div className="space-y-2 pl-2">
                  {getAssetsBySection(section.items).map((asset) => {
                    // Set loading state for this icon if not already set
                    if (loadingIcons[asset.info.processId] === undefined) {
                      setLoadingIcons(prev => ({
                        ...prev,
                        [asset.info.processId]: true
                      }));
                    }

                    return (
                      <div 
                        key={asset.info.processId} 
                        className={`flex justify-between items-center gap-2 ${theme.text}`}
                      >
                        <div className="flex items-center gap-1">
                          <div className="w-6 h-6 relative">
                            {/* Show loading indicator for asset info/image */}
                            {(loadingIcons[asset.info.processId] || pendingInfo.has(asset.info.processId)) && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#F4860A]"></div>
                              </div>
                            )}
                            {asset.info.logo && (
                              <img 
                                src={`${Gateway}${asset.info.logo}`}
                                alt={asset.info.name}
                                className={`w-6 h-6 object-cover rounded-full transition-opacity duration-200 ${
                                  loadingIcons[asset.info.processId] || pendingInfo.has(asset.info.processId) 
                                    ? 'opacity-0' 
                                    : 'opacity-100'
                                }`}
                                onLoad={() => handleImageLoad(asset.info.processId)}
                                onError={() => handleImageError(asset.info.processId)}
                              />
                            )}
                          </div>
                          <span>{asset.info.ticker}:</span>
                        </div>
<span className="font-bold">
  {pendingAssets.has(asset.info.processId) ? (
    <div className="w-8 flex justify-end">
      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#F4860A]"></div>
    </div>
  ) : (
    formatTokenAmount(asset.balance.toString(), asset.info.denomination || 0)
  )}
</span>
                      </div>
                    );
                  })}
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
