import React, { useEffect, useState, useRef } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useTokens } from '../contexts/TokenContext';
import { SUPPORTED_ASSET_IDS } from '../constants/Constants';
import { getLootBoxes, openLootBoxWithRarity, LootBoxResponse } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { SupportedAssetId, ASSET_INFO, Gateway } from '../constants/Constants';
import Confetti from 'react-confetti';
import { Package2, Diamond, Star, Crown, Sparkles, Zap, Gift, X } from 'lucide-react';
import '../styles/LootBoxUtil.css';

interface LootBoxProps {
  className?: string;
  // Add optional prop to allow parent components to provide lootbox data directly
  externalLootBoxes?: LootBox[];
  // Flag to control whether this component should load data independently
  loadDataIndependently?: boolean;
  // Theme for consistent styling
  theme?: any;
}

// Type to represent a loot box with rarity/level
interface LootBox {
  rarity: number;
  displayName: string;
}

const LootBoxUtil = ({ 
  className = '', 
  externalLootBoxes, 
  loadDataIndependently = true,
  theme
}: LootBoxProps): JSX.Element => {
  const { wallet, darkMode, triggerRefresh, refreshTrigger } = useWallet();
  const { tokenBalances, retryToken } = useTokens();
  const [lootBoxes, setLootBoxes] = useState<LootBox[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [openResult, setOpenResult] = useState<LootBoxResponse | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [assets, setAssets] = useState<{[key: string]: {name: string, ticker: string, logo?: string}}>({});
  const [isShaking, setIsShaking] = useState(false);
  const [isExploding, setIsExploding] = useState(false);
  const [selectedRarity, setSelectedRarity] = useState<number | null>(null);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [showCloseButton, setShowCloseButton] = useState(false);
  const [collectingItems, setCollectingItems] = useState<{content: React.ReactNode, x: number, y: number}[]>([]);
  const [timerProgress, setTimerProgress] = useState<number>(100);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  const currentThemeData = currentTheme(darkMode);
  const themeToUse = theme || currentThemeData;
  
  /**
   * Maps a numerical rarity level to its human-readable display name
   * @param rarity - Numerical value representing the rarity level (1-5)
   * @returns String representation of the rarity
   */
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
  
  /**
   * Processes raw lootbox data from API response into structured LootBox objects
   */
  const processLootBoxData = (responseResult: any): LootBox[] => {
    const boxes: LootBox[] = [];
    
    // Check if response.result is an array of arrays
    if (Array.isArray(responseResult) && responseResult.length > 0) {
      // Process each loot box entry
      responseResult.forEach((box: any) => {
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
    
    return boxes;
  };

  // Set lootboxes when external data is provided
  useEffect(() => {
    if (externalLootBoxes) {
      setLootBoxes(externalLootBoxes);
      setIsLoading(false); // Ensure loading state is turned off
    }
  }, [externalLootBoxes]);
  
  // Load loot boxes when wallet or refresh trigger changes, but only if loadDataIndependently is true
  useEffect(() => {
    // Skip loading if component is configured to not load independently or if external data is provided
    if (!loadDataIndependently || externalLootBoxes) return;
    
    const loadLootBoxes = async () => {
      if (!wallet?.address) return;
      
      setIsLoading(true);
      try {
        console.log('[LootBoxUtil] Loading lootbox data independently');
        const response = await getLootBoxes(wallet.address);
        
        if (response?.result) {
          const boxes = processLootBoxData(response.result);
          console.log('[LootBoxUtil] Processed loot boxes:', boxes);
          
          // If we're not currently opening a box, update the boxes state
          if (!isOpening) {
            setLootBoxes(boxes);
          } else {
            console.log('[LootBoxUtil] Not updating loot boxes during opening animation');
          }
        } else {
          console.warn('[LootBoxUtil] No loot box data in response');
          // Only set empty boxes if we're not in the middle of opening a box
          if (!isOpening) {
            setLootBoxes([]);
          }
        }
      } catch (error) {
        console.error('[LootBoxUtil] Error loading loot boxes:', error);
        // Only update if not currently opening
        if (!isOpening) {
          setLootBoxes([]);
        }
      } finally {
        setIsLoading(false);
      }
    };
    
    loadLootBoxes();
  }, [wallet?.address, refreshTrigger, loadDataIndependently, externalLootBoxes, isOpening]);
  
  // Map assets for token name mapping
  useEffect(() => {
    if (!wallet?.address || !tokenBalances) return;
    
    const assetMap: {[key: string]: {name: string, ticker: string, logo?: string}} = {};
    
    // Convert tokenBalances object to asset map
    Object.keys(tokenBalances).forEach((processId) => {
      const asset = tokenBalances[processId as SupportedAssetId];
      if (asset) {
        assetMap[processId] = {
          name: asset.info.name,
          ticker: asset.info.ticker,
          logo: asset.info.logo
        };
      }
    });
    
    setAssets(assetMap);
  }, [wallet?.address, tokenBalances]);
  
  /**
   * Returns CSS classes for styling loot box based on its rarity
   * @param rarity - Numerical rarity level
   * @returns Tailwind CSS classes for background, text, and border colors
   */
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
  
  /**
   * Returns CSS classes for glow/shadow effects based on rarity
   * @param rarity - Numerical rarity level
   * @returns Tailwind CSS classes for shadow and animation effects
   */
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
  


  /**
   * Starts countdown timer for auto-closing rewards display
   * Creates a 5-second countdown with visual progress bar
   */
  const startTimer = () => {
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    // Reset timer to 100%
    setTimerProgress(100);
    
    // Decrease by ~3.33% every 100ms (3 seconds total = 30 steps * 100ms)
    timerRef.current = setInterval(() => {
      setTimerProgress(prev => {
        const newProgress = Math.max(0, prev - 3.33);
        
        // When timer reaches zero, close the rewards
        if (newProgress === 0) {
          handleCloseWinnings();
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
        
        return newProgress;
      });
    }, 100);
  };
  
  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);
  
  // Handle closing the winnings display with animation
  const handleCloseWinnings = () => {
    // Don't allow closing multiple times
    if (isCollecting) return;
    
    console.log('[LootBoxUtil] Starting collection animation');
    setIsCollecting(true);
    
    // Stop the timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
         // Create floating animated items for each reward - positioned from reward cards
     if (openResult && Array.isArray(openResult.result)) {
       // Create items with staggered delays
       const itemsToAnimate = [];
       
       for (let i = 0; i < openResult.result.length; i++) {
         const item = openResult.result[i];
         
         // Create multiple berries for items with quantity > 1
         const quantity = Math.min(item.quantity, 5); // Max 5 berries per item for performance
         
         for (let q = 0; q < quantity; q++) {
           // Get the reward card element position as starting point
           const rewardCard = document.querySelector(`[data-reward-index="${i}"]`);
           let startX = window.innerWidth - 200; // Start from rewards popup area
           let startY = 100;
           
           if (rewardCard) {
             const rect = rewardCard.getBoundingClientRect();
             startX = rect.left + rect.width / 2 + (Math.random() - 0.5) * 20; // Add slight randomness
             startY = rect.top + rect.height / 2 + (Math.random() - 0.5) * 20;
           }
           
           // Create the animated content - berry/token representation
           const tokenIcon = getTokenIcon(item.token, tokenBalances);
           const content = (
             <div className="flex items-center justify-center w-6 h-6 bg-gradient-to-r from-green-400 to-emerald-500 text-white rounded-full text-xs font-bold shadow-lg border-2 border-white">
               <div className="w-3 h-3 flex items-center justify-center">
                 {tokenIcon}
               </div>
             </div>
           );
           
           itemsToAnimate.push({
             content,
             x: startX,
             y: startY,
             delay: (i * 3 + q) * 100 // Stagger each berry by 100ms
           });
         }
       }
       
       // Start animations with delays
       itemsToAnimate.forEach((item, index) => {
         setTimeout(() => {
           setCollectingItems(prev => [...prev, {
             content: item.content,
             x: item.x,
             y: item.y
           }]);
         }, item.delay);
               });
        
        // Log the berries animation start
        console.log('[LootBoxUtil] Berries flying to inventory!', itemsToAnimate.length, 'berries total');
     }

    setShowCloseButton(false);
    
    // Hide confetti
    setShowConfetti(false);
    
    // After collection animation completes, reset the UI and refresh
    setTimeout(() => {
      console.log('[LootBoxUtil] Resetting UI and refreshing data');
      setSelectedRarity(null);
      setIsExploding(false);
      setIsFadingOut(false);
      setIsCollecting(false);
      setIsOpening(false); // Fix: Ensure isOpening is reset
      setOpenResult(null);
      setTimerProgress(100); // Reset timer progress
      
      // Trigger a refresh to update the loot boxes
      if (triggerRefresh) {
        triggerRefresh();
      }
    }, 1000);
    
    // Clear collecting items after all animations are done (1.5 seconds to account for staggered delays)
    setTimeout(() => {
      setCollectingItems([]);
      console.log('[LootBoxUtil] All berries have reached the inventory!');
    }, 1500);
  };

  /**
   * Handles the loot box opening process, including animations and API calls
   * @param rarity - Rarity level of the loot box to open
   */
  const handleOpenLootBox = async (rarity: number) => {
    // Check if we can open a box - added extra check for lootBoxes
    if (!wallet?.address || isOpening || lootBoxes.filter(box => box.rarity === rarity).length === 0) return;
    
    // Reset states to ensure clean start
    setIsOpening(true);
    setOpenResult(null);
    setSelectedRarity(rarity);
    setTimerProgress(100); // Reset timer to full
    
    try {
      // Start shaking animation with increasing intensity
      setIsShaking(true);
      
      // Get the results from server, passing the rarity parameter
      console.log('[LootBoxUtil] Sending request to open loot box with rarity:', rarity);
      
      // Custom refresh callback to only refresh the tokens we received
      const refreshReceivedTokens = (result: LootBoxResponse) => {
        // Only refresh tokens that were received from the loot box
        if (result?.result && Array.isArray(result.result)) {
          const receivedTokens: SupportedAssetId[] = [];
          
          // Extract token IDs from the result
          result.result.forEach((item: any) => {
            if (item && typeof item === 'object' && item.token) {
              // Check if this token is a supported asset ID
              const tokenId = item.token as SupportedAssetId;
              if (SUPPORTED_ASSET_IDS.includes(tokenId)) {
                receivedTokens.push(tokenId);
              }
            }
          });
          
          // If we have tokens to refresh, do it individually instead of refreshing all
          if (receivedTokens.length > 0) {
            console.log('[LootBoxUtil] Refreshing only received tokens:', receivedTokens);
            receivedTokens.forEach(tokenId => {
              retryToken(tokenId);
            });
          } else {
            console.log('[LootBoxUtil] No valid tokens to refresh');
          }
        } else {
          console.warn('[LootBoxUtil] Invalid result format for token refresh');
        }
      };
      
      // Pass rarity but do NOT pass global triggerRefresh as we want to use our custom refresh logic
      const result = await openLootBoxWithRarity(wallet, rarity);
      
      console.log('[LootBoxUtil] Received loot box result:', result);
      
      if (result && result.result) {
        console.log('[LootBoxUtil] Loot received:', JSON.stringify(result.result));
        // Apply our custom token refresh for only the received tokens
        refreshReceivedTokens(result);
      } else {
        console.warn('[LootBoxUtil] No loot data in result');
      }
      
      // Once we have the result from chain, stop shaking and start the explosion
      setIsShaking(false);
      setIsExploding(true);
      
      // Small pause before confetti
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Show confetti with the result
      setShowConfetti(true);
      
      // Hide confetti after 3 seconds
      setTimeout(() => {
        setShowConfetti(false);
      }, 3000);
      
      if (result) {
        // Store the structured result
        setOpenResult(result);
        
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
        
        // Show close button after a short delay to allow user to see what they won first
        setTimeout(() => {
          setShowCloseButton(true);
          
          // Start the timer when showing results
          startTimer();
        }, 500);
        
        // No need for the automatic 5-second timeout anymore as we're using the timer bar
        // The return cleanup is also not needed as we handle cleanup in the useEffect
      } else {
        // If no result, reset everything after 2 seconds
        setTimeout(() => {
          setShowConfetti(false);
          setSelectedRarity(null);
          setIsExploding(false);
          setIsOpening(false);
          // Trigger global refresh here since we got no valid result
          if (triggerRefresh) {
            triggerRefresh();
          }
        }, 2000);
      }
    } catch (error) {
      console.error('[LootBoxUtil] Error opening loot box:', error);
      setIsShaking(false);
      setIsExploding(false);
      setSelectedRarity(null);
      setShowConfetti(false);
      setIsOpening(false);
      // Trigger global refresh on error to ensure UI is in sync
      if (triggerRefresh) {
        triggerRefresh();
      }
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

  // Get token logo or fallback to emoji
  const getTokenIcon = (tokenId: string, tokenBalances: any) => {
    const tokenInfo = tokenBalances[tokenId as SupportedAssetId];
    
    if (tokenInfo?.info?.logo) {
      return (
        <img 
          src={`${Gateway}${tokenInfo.info.logo}`}
          alt={tokenInfo.info.name || 'Token'}
          className="w-8 h-8 rounded-full"
        />
      );
    }
    
    // Fallback to emoji
    const berryEmojis: {[key: string]: string} = {
      "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0": "🔥",
      "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0": "💧",
      "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM": "🪨",
      "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA": "💨",
    };
    
    return <div className="text-3xl">{berryEmojis[tokenId] || "🌟"}</div>;
  };

  // Get reward gradient based on token type
  const getRewardGradient = (tokenId: string): string => {
    const gradients: {[key: string]: string} = {
      "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0": "from-red-500 to-red-700", // Fire Berry
      "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0": "from-blue-500 to-blue-700", // Water Berry  
      "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM": "from-gray-600 to-gray-800", // Rock Berry
      "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA": "from-sky-500 to-blue-600", // Air Berry
    };
    
    return gradients[tokenId] || "from-purple-500 to-indigo-600";
  };

  // Rarity configurations matching the beautiful design
  const rarityConfigs = {
    1: {
      name: 'Common',
      icon: Package2,
      gradient: 'from-emerald-400 to-green-500',
      bgGradient: 'from-emerald-50 to-green-50',
      borderColor: 'border-emerald-200',
      shadowColor: 'shadow-emerald-200/50',
      glowColor: 'group-hover:shadow-emerald-400/30',
      textColor: 'text-emerald-700',
      badgeColor: 'bg-emerald-500',
      stars: 1
    },
    2: {
      name: 'Uncommon',
      icon: Diamond,
      gradient: 'from-blue-400 to-cyan-500',
      bgGradient: 'from-blue-50 to-cyan-50',
      borderColor: 'border-blue-200',
      shadowColor: 'shadow-blue-200/50',
      glowColor: 'group-hover:shadow-blue-400/30',
      textColor: 'text-blue-700',
      badgeColor: 'bg-blue-500',
      stars: 2
    },
    3: {
      name: 'Rare',
      icon: Sparkles,
      gradient: 'from-purple-400 to-indigo-500',
      bgGradient: 'from-purple-50 to-indigo-50',
      borderColor: 'border-purple-200',
      shadowColor: 'shadow-purple-200/50',
      glowColor: 'group-hover:shadow-purple-400/30',
      textColor: 'text-purple-700',
      badgeColor: 'bg-purple-500',
      stars: 3
    },
    4: {
      name: 'Epic',
      icon: Crown,
      gradient: 'from-violet-400 to-purple-600',
      bgGradient: 'from-violet-50 to-purple-50',
      borderColor: 'border-violet-200',
      shadowColor: 'shadow-violet-200/50',
      glowColor: 'group-hover:shadow-violet-400/30',
      textColor: 'text-violet-700',
      badgeColor: 'bg-violet-500',
      stars: 4
    },
    5: {
      name: 'Legendary',
      icon: Star,
      gradient: 'from-amber-400 to-orange-500',
      bgGradient: 'from-amber-50 to-orange-50',
      borderColor: 'border-amber-200',
      shadowColor: 'shadow-amber-200/50',
      glowColor: 'group-hover:shadow-amber-400/30',
      textColor: 'text-amber-700',
      badgeColor: 'bg-amber-500',
      stars: 5
    }
  };
  
  // Group lootboxes by rarity
  const groupedLootboxes = lootBoxes.reduce<{[key: number]: number}>((acc, box) => {
    acc[box.rarity] = (acc[box.rarity] || 0) + 1;
    return acc;
  }, {});
  
  // Sort rarity levels for consistent display
  const rarityLevels = Object.keys(groupedLootboxes).map(Number).sort((a, b) => a - b);
  
  // Detect if we're in compact mode and minimized mode
  const isCompact = className?.includes('compact-mode');
  const isMinimized = className?.includes('minimized');

  const renderLootBoxes = () => {
    return (
      <div className={`treasure-vault-container relative ${themeToUse.container} ${isMinimized ? 'p-2 rounded-lg' : isCompact ? 'p-3 rounded-xl' : 'p-6 rounded-3xl'} ${className} h-full overflow-hidden`}>
        {showConfetti && (
          <div className="confetti-wrapper fixed inset-0 z-50 pointer-events-none">
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
        
        <div className={`${isCompact ? 'flex flex-col h-full' : 'max-w-4xl mx-auto'} h-full`}>
          {/* Header */}
          <div className={`flex items-center gap-2 ${isMinimized ? 'mb-1' : isCompact ? 'mb-2' : 'mb-8'} flex-shrink-0`}>
            <div className="relative">
              <div className={`${isMinimized ? 'p-1.5' : isCompact ? 'p-1.5' : 'p-3'} bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg shadow-lg`}>
                <Diamond className={`${isMinimized ? 'w-4 h-4' : isCompact ? 'w-4 h-4' : 'w-8 h-8'} text-white`} />
              </div>
              {!isCompact && <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full animate-pulse" />}
            </div>
            <div>
              <h1 className={`${isMinimized ? 'text-lg' : isCompact ? 'text-lg' : 'text-4xl'} font-bold ${themeToUse.text}`}>
                Treasure Vault
              </h1>
              {!isCompact && <p className={`${themeToUse.text} opacity-70 mt-1`}>Discover amazing rewards in your collection</p>}
            </div>
          </div>
          
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-slate-600">Loading treasures...</p>
            </div>
          ) : lootBoxes.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-600 text-lg">Your vault is empty. Complete activities to earn treasure!</p>
            </div>
          ) : (
            <>
              {/* Treasure Boxes Grid */}
                             <div className={`grid grid-cols-1 md:grid-cols-2 ${isMinimized ? 'lg:grid-cols-3 gap-1 flex-1 p-2' : isCompact ? 'lg:grid-cols-3 gap-2 flex-1 p-2' : 'lg:grid-cols-3 gap-6 mb-8 p-6'}`}>
                {[1, 2, 3, 4, 5].map(rarity => {
                  const config = rarityConfigs[rarity];
                  const count = groupedLootboxes[rarity] || 0;
                  const IconComponent = config.icon;
                  const isSelected = selectedRarity === rarity && isOpening;
                  
                  return (
                    <div
                      key={rarity}
                      className={`group relative bg-gradient-to-br ${config.bgGradient} ${config.borderColor} ${isMinimized ? 'border' : 'border-2'} hover:border-opacity-60 transition-all duration-300 cursor-pointer hover:scale-[1.02] ${config.shadowColor} hover:shadow-xl ${config.glowColor} ${isMinimized ? 'rounded-lg' : 'rounded-xl'} ${
                        count === 0 ? 'opacity-50 cursor-not-allowed' : ''
                      } ${isSelected ? 'scale-[1.05] ring-4 ring-blue-400/50 shadow-2xl' : ''}`}
                      onClick={() => count > 0 && !isOpening && handleOpenLootBox(rarity)}
                    >
                      {/* Count Badge - Only show when count > 0 */}
                      {count > 0 && (
                        <div className="absolute -top-1 -right-1 z-30">
                          <div className={`${config.badgeColor} text-white font-bold ${isMinimized ? 'text-xs px-2 py-1 min-w-[24px] h-6' : isCompact ? 'text-xs px-2.5 py-1 min-w-[28px] h-7' : 'text-sm px-3 py-1.5 min-w-[32px] h-8'} rounded-full shadow-2xl border-2 border-white flex items-center justify-center`}>
                            {count}
                          </div>
                        </div>
                      )}

                      <div className={`${isMinimized ? 'p-2' : isCompact ? 'p-3' : 'p-6'} text-center relative overflow-hidden`}>
                        {/* Background Decoration */}
                        <div className="absolute inset-0 opacity-5">
                          <div className={`absolute top-2 right-2 ${isMinimized ? 'w-6 h-6' : isCompact ? 'w-8 h-8' : 'w-16 h-16'} rounded-full bg-current`} />
                          <div className={`absolute bottom-2 left-2 ${isMinimized ? 'w-4 h-4' : isCompact ? 'w-6 h-6' : 'w-12 h-12'} rounded-full bg-current`} />
                        </div>

                        {/* Icon Container with Enhanced Animations */}
                        <div className={`relative ${isMinimized ? 'mb-1' : isCompact ? 'mb-2' : 'mb-4'}`}>
                          <div
                            className={`${isMinimized ? 'w-10 h-10' : isCompact ? 'w-12 h-12' : 'w-20 h-20'} mx-auto rounded-xl bg-gradient-to-r ${config.gradient} ${isMinimized ? 'p-2' : isCompact ? 'p-2' : 'p-4'} shadow-lg group-hover:shadow-xl transition-all duration-300 group-hover:scale-110 ${
                              isSelected && isShaking ? 'animate-bounce' : ''
                            } ${isSelected && isExploding ? 'animate-ping scale-125' : ''}`}
                          >
                            <IconComponent className="w-full h-full text-white" />
                          </div>

                          {/* Enhanced Sparkle Effects */}
                          <div className={`absolute -top-1 -right-1 transition-opacity duration-300 ${
                            isSelected || !count ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}>
                            <Zap className={`${isMinimized ? 'w-3 h-3' : isCompact ? 'w-3 h-3' : 'w-4 h-4'} text-yellow-400 animate-pulse`} />
                          </div>
                          <div className={`absolute -bottom-1 -left-1 transition-opacity duration-300 delay-100 ${
                            isSelected || !count ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}>
                            <Sparkles className={`${isMinimized ? 'w-3 h-3' : isCompact ? 'w-3 h-3' : 'w-4 h-4'} text-yellow-400 animate-pulse`} />
                          </div>
                        </div>

                        {/* Title */}
                        <h3 className={`${isMinimized ? 'text-sm' : isCompact ? 'text-sm' : 'text-xl'} font-bold ${config.textColor} ${isMinimized ? 'mb-0.5' : isCompact ? 'mb-1' : 'mb-2'}`}>{config.name}</h3>

                        {/* Rarity Indicator */}
                        <div className={`flex justify-center ${isMinimized ? 'mb-1' : isCompact ? 'mb-2' : 'mb-4'}`}>
                          {Array.from({ length: config.stars }, (_, i) => (
                            <Star key={i} className={`${isMinimized ? 'w-2 h-2' : isCompact ? 'w-2 h-2' : 'w-4 h-4'} ${config.textColor} fill-current`} />
                          ))}
                        </div>

                        {/* Open Button */}
                        <button
                          className={`w-full ${config.borderColor} ${config.textColor} hover:bg-white/50 transition-all duration-200 group-hover:shadow-md border border-current rounded-lg ${isMinimized ? 'py-1 px-2 text-xs' : isCompact ? 'py-1 px-2 text-xs' : 'py-2 px-4'} font-medium ${
                            count === 0 || isOpening ? 'opacity-50 cursor-not-allowed' : ''
                          } ${isSelected ? 'animate-pulse bg-white/30' : ''}`}
                          disabled={count === 0 || isOpening}
                        >
                          {isSelected ? 'Opening...' : 'Open Box'}
                        </button>

                        {/* Hover Glow Effect */}
                        <div
                          className={`absolute inset-0 bg-gradient-to-r ${config.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300 rounded-lg`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Instructions - Hide in minimized mode */}
              {!isMinimized && (
                <div className={`text-center ${isCompact ? 'mt-2' : 'mb-4'} flex-shrink-0`}>
                  <div className={`inline-flex items-center gap-2 bg-white/60 backdrop-blur-sm rounded-full ${isCompact ? 'px-3 py-1.5' : 'px-6 py-3'} shadow-lg`}>
                    <Package2 className={`${isCompact ? 'w-3 h-3' : 'w-5 h-5'} text-slate-600 dark:text-slate-400`} />
                    <p className={`text-slate-600 dark:text-slate-400 font-medium ${isCompact ? 'text-xs' : 'text-sm'}`}>
                      Click on a treasure box to open it and discover amazing rewards!
                    </p>
                  </div>
                </div>
              )}

              {/* Simple Inventory-Style Rewards Display */}
              {openResult && openResult.result && (
                <div className="fixed top-4 right-4 z-40 max-w-sm w-auto">
                  <div className={`bg-white rounded-2xl shadow-xl border-2 border-gray-200 overflow-hidden transition-all duration-300 ${isFadingOut ? 'opacity-0 scale-95 translate-x-8' : 'opacity-100 scale-100 translate-x-0'} animate-in slide-in-from-right-4`}>
                    {/* Progress Bar */}
                    <div className="h-2 bg-gray-200">
                      <div 
                        className="h-full bg-gradient-to-r from-red-400 via-orange-400 to-yellow-400 transition-all duration-100"
                        style={{ width: `${timerProgress}%` }}
                      />
                    </div>

                    {/* Header */}
                    <div className="p-4 pb-2">
                      <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-gray-800">Rewards:</h2>
                        <button
                          onClick={() => {
                            setIsFadingOut(true);
                            setTimeout(() => {
                              setIsFadingOut(false);
                              setOpenResult(null);
                              setIsExploding(false);
                              setSelectedRarity(null);
                            }, 300);
                          }}
                          className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-200"
                        >
                          <X className="w-5 h-5 text-gray-500" />
                        </button>
                      </div>
                    </div>

                    {/* Compact Rewards Grid */}
                    <div className="px-4 pb-2">
                      <div className="flex gap-2 overflow-x-auto">
                        {Array.isArray(openResult.result) && openResult.result.length > 0 ? (
                          openResult.result.map((item, index) => (
                            <div
                              key={index}
                              data-reward-index={index}
                              className="flex-shrink-0 bg-gray-700 rounded-xl p-3 min-w-[80px] text-center animate-in fade-in-50"
                              style={{ animationDelay: `${index * 100}ms` }}
                            >
                              <div className="flex flex-col items-center gap-1">
                                <div className="w-8 h-8 flex items-center justify-center">
                                  {getTokenIcon(item.token, tokenBalances)}
                                </div>
                                <div className="text-white font-bold text-sm">x{item.quantity}</div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-4 text-gray-600">
                            No rewards received
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="px-4 pb-4">
                      <div className="text-center text-sm font-medium text-gray-600 bg-gray-50 rounded-lg py-2">
                        Added to inventory!
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };
  
  return (
    <>
      {/* Floating collecting items that animate to wallet */}
      {collectingItems.map((item, index) => (
        <div 
          key={`collecting-${index}`}
          className="collecting-item"
          style={{ 
            fontSize: '2rem',
            left: `${item.x}px`,
            top: `${item.y}px`,
            transform: 'none', // Override the default transform in CSS
            zIndex: 99999 // Reinforce highest z-index
          }}
        >
          {item.content}
        </div>
      ))}
      
      {renderLootBoxes()}
    </>
  );
};

export default LootBoxUtil;
