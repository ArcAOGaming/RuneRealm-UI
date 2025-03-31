import React, { useEffect, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getLootBoxes, openLootBox, LootBoxResponse, message } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { AdminSkinChanger } from '../constants/Constants';
import { createDataItemSigner, result } from '../config/aoConnection';
import Confetti from 'react-confetti';
import '../styles/LootBoxUtil.css';

interface LootBoxProps {
  className?: string;
}

// Type to represent a loot box with rarity/level
interface LootBox {
  rarity: number;
  displayName: string;
}

const LootBoxUtil: React.FC<LootBoxProps> = ({ className = '' }) => {
  const { wallet, darkMode, triggerRefresh, refreshTrigger, assetBalances } = useWallet();
  const [lootBoxes, setLootBoxes] = useState<LootBox[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [openResult, setOpenResult] = useState<LootBoxResponse | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [assets, setAssets] = useState<{[key: string]: {name: string, ticker: string, logo?: string}}>({});
  const [isShaking, setIsShaking] = useState(false);
  const [isExploding, setIsExploding] = useState(false);
  const [selectedRarity, setSelectedRarity] = useState<number | null>(null);
  
  const theme = currentTheme(darkMode);
  
  // Map loot box rarity level to display name
  const getRarityName = (rarity: number): string => {
    switch(rarity) {
      case 1: return 'Common';
      case 2: return 'Uncommon';
      case 3: return 'Rare';
      case 4: return 'Epic';
      case 5: return 'Legendary';
      default: return `Level ${rarity}`;
    }
  };
  
  // Load loot boxes when wallet or refresh trigger changes
  useEffect(() => {
    const loadLootBoxes = async () => {
      if (!wallet?.address) return;
      
      setIsLoading(true);
      try {
        const response = await getLootBoxes(wallet.address);
        console.log('Loot box response:', response);
        
        if (response?.result) {
          // Handle the nested array format from the Lua code
          // The response is expected to be an array of arrays
          const boxes: LootBox[] = [];
          
          // Check if response.result is an array of arrays
          if (Array.isArray(response.result) && response.result.length > 0) {
            // Process each loot box entry
            response.result.forEach((box: any) => {
              if (Array.isArray(box)) {
                // Each entry in the array is a separate loot box
                box.forEach((rarityLevel: number) => {
                  boxes.push({
                    rarity: rarityLevel,
                    displayName: getRarityName(rarityLevel)
                  });
                });
              } else if (typeof box === 'number') {
                // Single number represents rarity directly
                boxes.push({
                  rarity: box,
                  displayName: getRarityName(box)
                });
              }
            });
          }
          
          setLootBoxes(boxes);
          console.log('Processed loot boxes:', boxes);
        } else {
          setLootBoxes([]);
        }
      } catch (error) {
        console.error('Error loading loot boxes:', error);
        setLootBoxes([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadLootBoxes();
  }, [wallet?.address, refreshTrigger]);
  
  // Map assets for token name mapping
  useEffect(() => {
    if (!wallet?.address || !assetBalances.length) return;
    
    const assetMap: {[key: string]: {name: string, ticker: string, logo?: string}} = {};
    
    assetBalances.forEach(asset => {
      assetMap[asset.info.processId] = {
        name: asset.info.name,
        ticker: asset.info.ticker,
        logo: asset.info.logo
      };
    });
    
    setAssets(assetMap);
  }, [wallet?.address, assetBalances]);
  
  // Get color class based on rarity
  const getRarityColorClass = (rarity: number): string => {
    switch (rarity) {
      case 1: // Common
        return 'bg-gray-700 text-gray-100 border-gray-500';
      case 2: // Uncommon
        return 'bg-green-700 text-green-100 border-green-500';
      case 3: // Rare
        return 'bg-blue-700 text-blue-100 border-blue-500';
      case 4: // Epic
        return 'bg-purple-700 text-purple-100 border-purple-500';
      case 5: // Legendary
        return 'bg-yellow-700 text-yellow-100 border-yellow-500';
      default:
        return 'bg-gray-700 text-gray-100 border-gray-500';
    }
  };
  
  // Get glow effects based on rarity
  const getRarityGlowClass = (rarity: number): string => {
    switch (rarity) {
      case 1: // Common
        return '';
      case 2: // Uncommon
        return 'shadow-sm shadow-green-400';
      case 3: // Rare
        return 'shadow-md shadow-blue-400';
      case 4: // Epic
        return 'shadow-lg shadow-purple-400 animate-pulse';
      case 5: // Legendary
        return 'shadow-xl shadow-yellow-400 animate-pulse';
      default:
        return '';
    }
  };
  
  // Custom openLootBox function that accepts a rarity parameter
  const openLootBoxWithRarity = async (walletInfo: any, rarity: number, refreshCallback?: () => void): Promise<LootBoxResponse | null> => {
    if (!walletInfo?.address) {
      console.error('[openLootBoxWithRarity] No wallet address provided');
      return null;
    }
  
    try {
      console.log(`[openLootBoxWithRarity] Opening loot box with rarity ${rarity} for user:`, walletInfo.address);
      const signer = createDataItemSigner(window.arweaveWallet);
  
      // Send message with rarity tag
      const messageresult: any = await message({
        process: AdminSkinChanger,
        tags: [
          { name: 'Action', value: 'OpenLootBox' },
          { name: 'From', value: walletInfo.address },
          { name: 'rarity', value: rarity.toString() } // Add the rarity tag as a string
        ],
        signer
      }, refreshCallback);
      
      // Get the result
      const boxResult = await result({
        message: messageresult,
        process: AdminSkinChanger
      }) as { Messages: Array<{ Data: string, Tags?: Array<{ name: string, value: string }> }> };
  
      // Process the result similar to the original function
      if (boxResult?.Messages && boxResult.Messages.length > 0) {
        const lastMessage = boxResult.Messages[boxResult.Messages.length - 1];
        
        if (lastMessage?.Data) {
          try {
            const parsedData = JSON.parse(lastMessage.Data);
            return {
              result: parsedData.result
            };
          } catch (error) {
            console.error('[openLootBoxWithRarity] Error parsing response:', error);
            return null;
          }
        }
      }
      return null;
    } catch (error) {
      console.error('[openLootBoxWithRarity] Error opening loot box:', error);
      return null;
    }
  };

  // Handle opening a loot box
  const handleOpenLootBox = async (rarity: number) => {
    if (!wallet?.address || isOpening || lootBoxes.filter(box => box.rarity === rarity).length === 0) return;
    
    setIsOpening(true);
    setOpenResult(null);
    setSelectedRarity(rarity);
    
    try {
      // Start shaking animation with increasing intensity
      setIsShaking(true);
      
      // Shake for the full animation sequence (around 2 seconds)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Prepare for explosion, stop shaking and start exploding
      setIsShaking(false);
      setIsExploding(true);
      
      // Small pause before confetti
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Explode with confetti!
      setShowConfetti(true);
      
      // Get the results from server, passing the rarity parameter
      const result = await openLootBoxWithRarity(wallet, rarity, triggerRefresh);
      
      if (result) {
        // Store the structured result
        setOpenResult(result);
        
        // Hide confetti after 4 seconds
        setTimeout(() => setShowConfetti(false), 4000);
        
        // Manually update local state to reduce the loot box count
        setLootBoxes(prevBoxes => {
          const updatedBoxes = [...prevBoxes];
          // Find the box with matching rarity and remove one instance
          const boxIndex = updatedBoxes.findIndex(box => box.rarity === rarity);
          if (boxIndex >= 0) {
            // Remove one instance of this box
            updatedBoxes.splice(boxIndex, 1);
          }
          return updatedBoxes;
        });
        
        // Reset UI states after a delay
        setTimeout(() => {
          setSelectedRarity(null);
          setIsExploding(false);
          // Also refresh from server to ensure data consistency
          triggerRefresh();
        }, 2000);
      }
    } catch (error) {
      console.error('Error opening loot box:', error);
      setIsShaking(false);
      setIsExploding(false);
      setSelectedRarity(null);
      setShowConfetti(false);
    } finally {
      setIsOpening(false);
    }
  };
  
  // Helper to get the token name or ID if name not available
  const getTokenName = (tokenId: string): string => {
    if (assets[tokenId]) {
      return assets[tokenId].name || assets[tokenId].ticker || tokenId.substring(0, 8);
    }
    
    // Berry name mappings if not found in assets
    const berryNames: {[key: string]: string} = {
      "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0": "Fire Berry",
      "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0": "Water Berry",
      "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM": "Rock Berry",
      "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA": "Air Berry",
    };
    
    return berryNames[tokenId] || tokenId.substring(0, 8) + "...";
  };
  
  // Helper function to get berry color based on token ID
  const getBerryColor = (tokenId: string): string => {
    const berryColors: {[key: string]: string} = {
      "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0": "bg-red-700 text-red-100 border-red-500",
      "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0": "bg-blue-700 text-blue-100 border-blue-500",
      "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM": "bg-stone-700 text-stone-100 border-stone-500",
      "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA": "bg-sky-700 text-sky-100 border-sky-500",
    };
    
    return berryColors[tokenId] || "bg-gray-700 text-gray-100 border-gray-500";
  };
  
  // Get Berry Emoji
  const getBerryEmoji = (tokenId: string): string => {
    const berryEmojis: {[key: string]: string} = {
      "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0": "🔥",
      "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0": "💧",
      "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM": "🪨",
      "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA": "💨",
    };
    
    return berryEmojis[tokenId] || "🌟";
  };
  
  // Group lootboxes by rarity
  const groupedLootboxes = lootBoxes.reduce<{[key: number]: number}>((acc, box) => {
    acc[box.rarity] = (acc[box.rarity] || 0) + 1;
    return acc;
  }, {});
  
  // Sort rarity levels for consistent display
  const rarityLevels = Object.keys(groupedLootboxes).map(Number).sort((a, b) => a - b);
  
  // Render each rarity section
  const renderRaritySection = (rarity: number) => {
    const count = groupedLootboxes[rarity] || 0;
    const rarityName = getRarityName(rarity);
    const colorClass = getRarityColorClass(rarity);
    const glowClass = getRarityGlowClass(rarity);
    
    const isSelected = selectedRarity === rarity && isOpening;
    
    return (
      <div key={rarity} className="mb-3">
        <h3 className={`text-sm font-bold ${theme.text} mb-1`}>{rarityName}</h3>
        <div className="flex gap-2">
          {count > 0 ? (
            <div 
              className={`loot-box-item relative p-4 rounded-lg border-2 ${colorClass} ${glowClass} flex flex-col items-center justify-center transition-transform hover:scale-105 cursor-pointer w-24 h-24 ${isSelected ? 'scale-110' : ''}`}
              title={`Open ${rarityName} Loot Box`}
              onClick={() => !isOpening && handleOpenLootBox(rarity)}
            >
              <div className={`loot-box-icon text-3xl mb-1 ${isSelected && isShaking ? 'shake-animation' : ''} ${isSelected && isExploding ? 'explode-animation' : ''}`}>
                📦
              </div>
              <span className="font-medium text-xs text-center">{rarityName}</span>
              <div className="absolute top-1 right-1 bg-black bg-opacity-50 rounded-full w-5 h-5 flex items-center justify-center text-xs">
                {count}
              </div>
            </div>
          ) : (
            <div 
              className={`loot-box-item-empty relative p-4 rounded-lg border-2 border-gray-700 bg-gray-800 bg-opacity-50 flex flex-col items-center justify-center w-24 h-24`}
            >
              <div className="loot-box-icon text-3xl mb-1 opacity-30">📦</div>
              <span className="font-medium text-xs text-center opacity-30">{rarityName}</span>
            </div>
          )}
        </div>
      </div>
    );
  };
  
  return (
    <div className={`loot-box-container relative ${theme.container} border ${theme.border} backdrop-blur-md p-4 ${className}`}>
      {showConfetti && (
        <div className="confetti-wrapper">
          <Confetti 
            recycle={false} 
            numberOfPieces={500}
            gravity={0.3}
            initialVelocityY={30}
            initialVelocityX={{min: -15, max: 15}}
            width={window.innerWidth}
            height={window.innerHeight}
            tweenDuration={100}
            colors={['#FFD700', '#FFA500', '#FF4500', '#ff0000', '#00ff00', '#0000ff', '#800080']}
          />
        </div>
      )}
      
      <h3 className={`text-lg font-bold ${theme.text} mb-3`}>Treasure Vault</h3>
      
      {isLoading ? (
        <p className={`${theme.text}`}>Loading treasures...</p>
      ) : lootBoxes.length === 0 ? (
        <p className={`${theme.text} text-sm`}>Your vault is empty. Complete activities to earn treasure!</p>
      ) : (
        <div className="space-y-2">
          <div className="loot-box-sections">
            <div className="flex flex-wrap gap-3 justify-center">
              {rarityLevels.map(renderRaritySection)}
            </div>
          </div>
          
          {/* Rewards section - now at the bottom */}
          {openResult && openResult.result && (
            <div className={`result-container mt-6 p-3 rounded-lg ${theme.container} border ${theme.border}`}>
              <h3 className={`text-sm font-bold ${theme.text} mb-2`}>Rewards:</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {Array.isArray(openResult.result) && openResult.result.map((item, index) => (
                  <div 
                    key={index} 
                    className={`berry-item p-2 rounded-lg border ${getBerryColor(item.token)} flex items-center justify-between text-sm`}
                  >
                    <div className="flex items-center">
                      <span className="text-xl mr-2">
                        {getBerryEmoji(item.token)}
                      </span>
                      <span className="font-medium">{getTokenName(item.token)}</span>
                    </div>
                    <span className="font-bold">x{item.quantity}</span>
                  </div>
                ))}
              </div>
              <p className={`${theme.text} mt-2 text-xs text-center`}>
                Added to inventory!
              </p>
            </div>
          )}
          
          <div className="text-xs text-center text-gray-400 mt-2">
            Click on a loot box to open it
          </div>
        </div>
      )}
    </div>
  );
};

export default LootBoxUtil;
