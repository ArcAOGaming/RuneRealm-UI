import React, { useEffect, useState, useRef } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useTokens } from '../contexts/TokenContext';
import { SUPPORTED_ASSET_IDS } from '../constants/Constants';
import { getLootBoxes, openLootBoxWithRarity, LootBoxResponse } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { SupportedAssetId, ASSET_INFO } from '../constants/Constants';
import Confetti from 'react-confetti';
import '../styles/LootBoxUtil.css';

interface LootBoxProps {
  className?: string;
  // Add optional prop to allow parent components to provide lootbox data directly
  externalLootBoxes?: LootBox[];
  // Flag to control whether this component should load data independently
  loadDataIndependently?: boolean;
}

// Type to represent a loot box with rarity/level
interface LootBox {
  rarity: number;
  displayName: string;
}

const LootBoxUtil = ({
  className = '',
  externalLootBoxes,
  loadDataIndependently = true
}: LootBoxProps): JSX.Element => {
  const { wallet, darkMode, triggerRefresh, refreshTrigger } = useWallet();
  const { tokenBalances, retryToken } = useTokens();
  const [lootBoxes, setLootBoxes] = useState<LootBox[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [openResult, setOpenResult] = useState<LootBoxResponse | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [assets, setAssets] = useState<{ [key: string]: { name: string, ticker: string, logo?: string } }>({});
  const [isShaking, setIsShaking] = useState(false);
  const [isExploding, setIsExploding] = useState(false);
  const [selectedRarity, setSelectedRarity] = useState<number | null>(null);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [showCloseButton, setShowCloseButton] = useState(false);
  const [collectingItems, setCollectingItems] = useState<{ content: React.ReactNode, x: number, y: number }[]>([]);
  const [timerProgress, setTimerProgress] = useState<number>(100);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const theme = currentTheme(darkMode);

  /**
   * Maps a numerical rarity level to its human-readable display name
   * @param rarity - Numerical value representing the rarity level (1-5)
   * @returns String representation of the rarity
   */
  const getRarityName = (rarity: number): string => {
    switch (rarity) {
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

    const assetMap: { [key: string]: { name: string, ticker: string, logo?: string } } = {};

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
        return 'bg-gray-50 text-gray-700 border-gray-300';
      case 2: // Uncommon
        return 'bg-green-50 text-green-700 border-green-300';
      case 3: // Rare
        return 'bg-blue-50 text-blue-700 border-blue-300';
      case 4: // Epic
        return 'bg-purple-50 text-purple-700 border-purple-300';
      case 5: // Legendary
        return 'bg-yellow-50 text-yellow-700 border-yellow-300';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-300';
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
        return 'drop-shadow-[0_0_4px_rgba(34,197,94,0.5)]'; // green
      case 3: // Rare
        return 'drop-shadow-[0_0_4px_rgba(59,130,246,0.5)]'; // blue
      case 4: // Epic
        return 'drop-shadow-[0_0_6px_rgba(168,85,247,0.5)]'; // purple
      case 5: // Legendary
        return 'drop-shadow-[0_0_8px_rgba(253,224,71,0.7)]'; // yellow
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

    // Decrease by 2% every 100ms (5 seconds total = 50 steps * 100ms)
    timerRef.current = setInterval(() => {
      setTimerProgress(prev => {
        const newProgress = Math.max(0, prev - 2);

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

    // Clear timer if exists
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Get all reward items from the current result
    if (openResult?.result && Array.isArray(openResult.result)) {
      // Find all berry elements in the DOM
      const berryElements = document.querySelectorAll('.berry-emoji');
      const collectionItems: { content: React.ReactNode, x: number, y: number }[] = [];

      // Extract position and content for each reward
      berryElements.forEach((element, index) => {
        const rect = element.getBoundingClientRect();

        // Calculate center position of the element
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // Get the token ID from the reward result
        const tokenId = openResult.result[index]?.token;
        let content: React.ReactNode;

        // If we have token ID and it exists in ASSET_INFO, use its logo
        if (tokenId && ASSET_INFO[tokenId] && ASSET_INFO[tokenId].logo) {
          content = (
            <img
              src={`https://arweave.net/${ASSET_INFO[tokenId].logo}`}
              alt={ASSET_INFO[tokenId].name || 'Reward'}
              className="inline-block h-6 w-6 object-contain"
            />
          );
        } else {
          // Fallback to emoji if no logo available
          const emoji = element.textContent || '🌟';
          content = emoji;
        }

        // Add this item to the collection
        collectionItems.push({ content, x, y });
      });

      // Update state with collection items
      setCollectingItems(collectionItems);
    }

    // Start collection animation
    setIsCollecting(true);
    setShowCloseButton(false);

    // Hide confetti
    setShowConfetti(false);

    // After collection animation completes (1 second), reset the UI and refresh
    setTimeout(() => {
      console.log('[LootBoxUtil] Resetting UI and refreshing data');
      setSelectedRarity(null);
      setIsExploding(false);
      setIsFadingOut(false);
      setIsCollecting(false);
      setIsOpening(false); // Fix: Ensure isOpening is reset
      setOpenResult(null);
      setCollectingItems([]); // Clear collecting items
      setTimerProgress(100); // Reset timer progress

      // Trigger a refresh to update the loot boxes
      if (triggerRefresh) {
        triggerRefresh();
      }
    }, 1000);
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

  // We've removed getTokenName and getBerryColor functions
  // They have been replaced with simpler implementations

  // Get Berry Emoji or Logo
  const getBerryEmoji = (tokenId: string): React.ReactNode => {
    // Check if we have this asset in ASSET_INFO constants
    if (ASSET_INFO[tokenId]) {
      const asset = ASSET_INFO[tokenId];
      const name = asset.name;

      // If we have a logo, return an image element
      if (asset.logo) {
        return (
          <img
            src={`https://arweave.net/${asset.logo}`}
            alt={name}
            className="inline-block h-6 w-6 object-contain"
            onError={(e) => {
              // If image fails to load, fall back to question mark
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';

              // Use question mark for fallback
              const fallbackEmoji = '❓';

              // Update the parent element with the fallback emoji
              if (target.parentElement) {
                target.parentElement.innerText = fallbackEmoji;
              }
            }}
          />
        );
      }

      // If no logo, use question mark
      return '❓';
    }

    // Handle undefined token case safely
    if (!tokenId) {
      console.warn("LootBoxUtil: Undefined token encountered in getBerryEmoji");
      return "❓";
    }

    // Default fallback
    return "❓";
  };

  // Group lootboxes by rarity
  const groupedLootboxes = lootBoxes.reduce<{ [key: number]: number }>((acc, box) => {
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

    const badgeStyleMap = {
      1: 'bg-gray-500 text-white border border-white',
      2: 'bg-green-500 text-white border border-white',
      3: 'bg-blue-500 text-white border border-white',
      4: 'bg-purple-500 text-white border border-white',
      5: 'bg-yellow-500 text-white border border-white',
    };

    return (
      <div className="flex gap-2 p-1">
        {count > 0 ? (
          <div
            className={`group hover:z-20 loot-box-item relative p-3 rounded-lg border shrink-0 w-full ${colorClass} ${glowClass} flex flex-col items-center justify-center transition-transform hover:scale-105 cursor-pointer w-20 min-h-20 space-y-1 ${isSelected ? 'scale-110' : ''}`}
            title={`Open ${rarityName} Loot Box`}
            onClick={() => !isOpening && handleOpenLootBox(rarity)}
          >
            {/* Badge */}
            <span
              className={`absolute -top-1 -right-[2px] z-10 flex items-center justify-center rounded-full w-5 h-5 font-semibold text-xs ${badgeStyleMap[rarity as 1 | 2 | 3 | 4 | 5]}`}
              style={{
                boxShadow: '0 2px 8px 0 rgba(0,0,0,0.08)',
              }}
            >
              {count}
            </span>
            {/* Icon */}
            <div className={`loot-box-icon text-4xl ${isSelected && isShaking ? 'shake-animation' : ''} ${isSelected && isExploding ? 'explode-animation' : ''} ${rarity > 3 ? 'animate-pulse' : ''}`}>
              📦
            </div>
            {/* Name */}
            <span className="font-bold text-sm text-center">{rarityName}</span>
            <div className={`flex justify-center pb-1 text-xs`}>
              {Array.from({ length: rarity }, (_, i) => (
                <span key={i}>★</span>
              ))}
            </div>
            {/* Open Button */}
            <button
              className={`w-full transition-all duration-200 group-hover:shadow-md hover:bg-none hover:shadow border border-current rounded-lg py-1 px-2 text-xs font-medium ${count === 0 || isOpening ? 'opacity-50 cursor-not-allowed' : ''
                } ${isSelected ? 'animate-pulse bg-white/30' : ''}`}
              disabled={count === 0 || isOpening}
            >
              {isSelected ? 'Opening...' : 'Open'}
            </button>
          </div>
        ) : (
          <div
            className={`loot-box-item-empty relative p-3 rounded-lg border-2 border-gray-700 bg-gray-800 bg-opacity-50 flex flex-col items-center justify-center w-20 min-h-20 space-y-1`}
          >
            <div className="loot-box-icon text-4xl opacity-30">📦</div>
            <span className="font-bold text-sm text-center opacity-30">{rarityName}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`loot-box-section rounded-xl h-fit backdrop-blur-md ${theme.container} p-2 ${className} overflow-hidden w-full max-w-full`}>
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

      <div className={`loot-box-container relative`}>
        <h1 className={`text-lg font-bold ${theme.text} mb-1 shrink-0`}>Treasure Vault</h1>
        {showConfetti && (
          <div className="confetti-wrapper">
            <Confetti
              recycle={false}
              numberOfPieces={500}
              gravity={0.3}
              initialVelocityY={30}
              initialVelocityX={{ min: -15, max: 15 }}
              width={window.innerWidth}
              height={window.innerHeight}
              tweenDuration={100}
              colors={['#FFD700', '#FFA500', '#FF4500', '#ff0000', '#00ff00', '#0000ff', '#800080']}
            />
          </div>
        )}
        {isLoading ? (
          <p className={`${theme.text}`}>Loading treasures...</p>
        ) : lootBoxes.length === 0 && !openResult ? (
          <p className={`${theme.text} text-sm`}>Your vault is empty. Complete activities to earn treasure!</p>
        ) : (
          <div className="space-y-2">
            {/* Show either the rewards OR the loot box selection, never both */}
            {openResult && openResult.result ? (
              <div
                className={`result-container p-2 rounded-lg ${theme.container} border ${theme.border} transition-all duration-1000 
                ${isFadingOut ? 'opacity-0' : 'opacity-100'} 
                ${isCollecting ? 'collecting-animation' : ''}`}
                style={{ width: '100%' }}
              >
                {/* Timer bar */}
                <div className="timer-bar-container">
                  <div
                    className="timer-bar"
                    style={{ width: `${timerProgress}%` }}
                  />
                </div>
                {/* Close button (X) in the top-right corner */}
                {showCloseButton && (
                  <button
                    onClick={handleCloseWinnings}
                    className="close-button"
                    aria-label="Close rewards"
                  >
                    ✕
                  </button>
                )}
                <div className="flex items-center mb-1">
                  <h3 className={`text-xs font-bold ${theme.text}`}>Rewards:</h3>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1">
                  {Array.isArray(openResult.result) && openResult.result.length > 0 ? (
                    openResult.result.map((item, index) => (
                      <div
                        key={index}
                        className={`berry-item p-2 rounded-lg border bg-gray-700 text-gray-100 border-gray-500 flex items-center justify-center text-sm`}
                      >
                        <span className="text-xl mr-1 berry-emoji">
                          {getBerryEmoji(item.token)}
                        </span>
                        <span className="font-bold">x{item.quantity}</span>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-full text-center py-2">
                      <p className={`${theme.text}`}>No rewards received. Try again!</p>
                    </div>
                  )}
                </div>
                <p className={`${theme.text} mt-2 text-xs text-center`}>
                  {Array.isArray(openResult.result) && openResult.result.length > 0 ? 'Added to inventory!' : 'Better luck next time!'}
                </p>
              </div>
            ) : isOpening && selectedRarity !== null ? (
              /* When opening, only show the selected treasure */
              <div className="flex justify-center p-4">
                {/* Only show the single selected box during animation */}
                <div
                  className={`loot-box-item relative p-3 rounded-lg border-2 ${getRarityColorClass(selectedRarity)} ${getRarityGlowClass(selectedRarity)} flex flex-col items-center justify-center w-28 h-28 scale-105`}
                >
                  <div className={`loot-box-icon text-4xl mb-2 ${isShaking ? 'shake-animation' : ''} ${isExploding ? 'explode-animation' : ''}`}>
                    📦
                  </div>
                  <span className="font-medium text-sm text-center">{getRarityName(selectedRarity)}</span>
                </div>
              </div>
            ) : (
              /* Default view: show all available treasures */
              <>
                <div className="grid grid-cols-2 xl:grid-cols-5">
                  {rarityLevels.map(renderRaritySection)}
                </div>
                <div className="text-xs text-center text-gray-400 mt-2">
                  Click on a loot box to open it
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LootBoxUtil;
