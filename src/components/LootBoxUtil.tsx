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
  loading?: boolean;
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
  loading = false
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
    if (Array.isArray(responseResult) && responseResult.length > 0) {
      responseResult.forEach((box: any) => {
        if (Array.isArray(box)) {
          box.forEach((rarityLevel: number) => {
            boxes.push({
              rarity: rarityLevel,
              displayName: getRarityName(rarityLevel)
            });
          });
        } else if (typeof box === 'number') {
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
      setIsLoading(false);
    }
  }, [externalLootBoxes]);

  // Load loot boxes when wallet or refresh trigger changes, but only if loadDataIndependently is true
  useEffect(() => {
    if (!loadDataIndependently || externalLootBoxes) return;
    const loadLootBoxes = async () => {
      if (!wallet?.address) return;
      setIsLoading(true);
      try {
        const response = await getLootBoxes(wallet.address);
        if (response?.result) {
          const boxes = processLootBoxData(response.result);
          if (!isOpening) {
            setLootBoxes(boxes);
          }
        } else {
          if (!isOpening) {
            setLootBoxes([]);
          }
        }
      } catch (error) {
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
      case 1: return 'bg-gray-50 text-gray-700 border-gray-300';
      case 2: return 'bg-green-50 text-green-700 border-green-300';
      case 3: return 'bg-blue-50 text-blue-700 border-blue-300';
      case 4: return 'bg-purple-50 text-purple-700 border-purple-300';
      case 5: return 'bg-yellow-50 text-yellow-700 border-yellow-300';
      default: return 'bg-gray-50 text-gray-700 border-gray-300';
    }
  };

  /**
   * Returns CSS classes for glow/shadow effects based on rarity
   * @param rarity - Numerical rarity level
   * @returns Tailwind CSS classes for shadow and animation effects
   */
  const getRarityGlowClass = (rarity: number): string => {
    switch (rarity) {
      case 1: return '';
      case 2: return 'drop-shadow-[0_0_4px_rgba(34,197,94,0.5)]';
      case 3: return 'drop-shadow-[0_0_4px_rgba(59,130,246,0.5)]';
      case 4: return 'drop-shadow-[0_0_6px_rgba(168,85,247,0.5)]';
      case 5: return 'drop-shadow-[0_0_8px_rgba(253,224,71,0.7)]';
      default: return '';
    }
  };

  /**
   * Starts countdown timer for auto-closing rewards display
   * Creates a 5-second countdown with visual progress bar
   */
  const startTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setTimerProgress(100);
    timerRef.current = setInterval(() => {
      setTimerProgress(prev => {
        const newProgress = Math.max(0, prev - 2);
        if (newProgress <= 2) {
          if (!isCollecting) {
            handleCloseWinnings(true);
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
        return newProgress;
      });
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  /**
   * Handle closing the winnings display with animation and refresh
   * @param autoClose - true if called by timer, false if by user
   */
  const handleCloseWinnings = (autoClose = false) => {
    if (isCollecting) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (openResult?.result && Array.isArray(openResult.result)) {
      const berryElements = document.querySelectorAll('.berry-emoji');
      const collectionItems: { content: React.ReactNode, x: number, y: number }[] = [];
      berryElements.forEach((element, index) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const tokenId = openResult.result[index]?.token;
        let content: React.ReactNode;
        if (tokenId && ASSET_INFO[tokenId] && ASSET_INFO[tokenId].logo) {
          content = (
            <img
              src={`https://arweave.net/${ASSET_INFO[tokenId].logo}`}
              alt={ASSET_INFO[tokenId].name || 'Reward'}
              className="inline-block h-6 w-6 object-contain"
            />
          );
        } else {
          const emoji = element.textContent || '🌟';
          content = emoji;
        }
        collectionItems.push({ content, x, y });
      });
      setCollectingItems(collectionItems);
    }
    setIsCollecting(true);
    setShowCloseButton(false);
    setShowConfetti(false);
    setTimeout(() => {
      setSelectedRarity(null);
      setIsExploding(false);
      setIsFadingOut(false);
      setIsCollecting(false);
      setIsOpening(false);
      setOpenResult(null);
      setCollectingItems([]);
      setTimerProgress(100);
      if (triggerRefresh) {
        triggerRefresh();
      }
    }, autoClose ? 1200 : 1000);
  };

  /**
   * Handles the loot box opening process, including animations and API calls
   * @param rarity - Rarity level of the loot box to open
   */
  const handleOpenLootBox = async (rarity: number) => {
    if (!wallet?.address || isOpening || lootBoxes.filter(box => box.rarity === rarity).length === 0) return;
    setIsOpening(true);
    setOpenResult(null);
    setSelectedRarity(rarity);
    setTimerProgress(100);
    try {
      setIsShaking(true);
      const refreshReceivedTokens = (result: LootBoxResponse) => {
        if (result?.result && Array.isArray(result.result)) {
          const receivedTokens: SupportedAssetId[] = [];
          result.result.forEach((item: any) => {
            if (item && typeof item === 'object' && item.token) {
              const tokenId = item.token as SupportedAssetId;
              if (SUPPORTED_ASSET_IDS.includes(tokenId)) {
                receivedTokens.push(tokenId);
              }
            }
          });
          if (receivedTokens.length > 0) {
            receivedTokens.forEach(tokenId => {
              retryToken(tokenId);
            });
          }
        }
      };
      const result = await openLootBoxWithRarity(wallet, rarity);
      setIsShaking(false);
      setIsExploding(true);
      await new Promise(resolve => setTimeout(resolve, 150));
      setShowConfetti(true);
      if (result) {
        setOpenResult(result);
        setLootBoxes(prevBoxes => {
          const updatedBoxes = [...prevBoxes];
          const boxIndex = updatedBoxes.findIndex(box => box.rarity === rarity);
          if (boxIndex >= 0) {
            updatedBoxes.splice(boxIndex, 1);
          }
          return updatedBoxes;
        });
        setTimeout(() => {
          setShowCloseButton(true);
          startTimer();
        }, 500);
      } else {
        setTimeout(() => {
          setShowConfetti(false);
          setSelectedRarity(null);
          setIsExploding(false);
          setIsOpening(false);
          if (triggerRefresh) {
            triggerRefresh();
          }
        }, 2000);
      }
    } catch (error) {
      setIsShaking(false);
      setIsExploding(false);
      setSelectedRarity(null);
      setShowConfetti(false);
      setIsOpening(false);
      if (triggerRefresh) {
        triggerRefresh();
      }
    }
  };

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
  const rarityLevels = [1, 2, 3, 4, 5];

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
            className={`group hover:z-20 loot-box-item relative p-3 rounded-lg border shrink-0 w-full ${colorClass} ${glowClass} flex flex-col items-center justify-center transition-transform hover:scale-105 cursor-pointer w-20 min-h-20 xl:space-y-1 ${isSelected ? 'scale-110' : ''}`}
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
            <div className={`loot-box-icon text-3xl xl:text-4xl ${isSelected && isShaking ? 'shake-animation' : ''} ${isSelected && isExploding ? 'explode-animation' : ''} ${rarity > 3 ? 'animate-pulse' : ''}`}>
              📦
            </div>
            {/* Name */}
            <span className="font-bold text-xs xl:text-sm text-center">{rarityName}</span>
            <div className={`flex justify-center pb-1 text-xs`}>
              {Array.from({ length: rarity }, (_, i) => (
                <span key={i}>★</span>
              ))}
            </div>
            {/* Open Button */}
            <button
              className={`button-loot hidden 2xl:block w-full transition-all duration-200 group-hover:shadow-md hover:bg-none hover:shadow border border-current rounded-lg py-1 px-2 text-xs font-medium ${count === 0 || isOpening ? 'opacity-50 cursor-not-allowed' : ''
                } ${isSelected ? 'animate-pulse bg-white/30' : ''}`}
              disabled={count === 0 || isOpening}
            >
              {isSelected ? 'Opening...' : 'Open'}
            </button>
          </div>
        ) : (
          <div
            className={`group hover:z-20 loot-box-item relative p-3 rounded-lg border shrink-0 w-full hover:scale-100 ${colorClass} flex flex-col items-center justify-center transition-transform cursor-not-allowed w-20 min-h-20 xl:space-y-1`}
            title={`${rarityName} Loot Box (Empty)`}
          >
            <div className="loot-box-icon text-3xl xl:text-4xl opacity-30">📦</div>
            <span className="font-bold text-xs xl:text-sm text-center opacity-30">{rarityName}</span>
            <div className={`flex justify-center pb-1 text-xs opacity-30`}>
              {Array.from({ length: rarity }, (_, i) => (
                <span key={i}>★</span>
              ))}
            </div>
            <button
              className={`button-loot hidden 2xl:block w-full transition-all duration-200 group-hover:shadow-md hover:bg-none hover:shadow border border-current rounded-lg py-1 px-2 text-xs font-medium ${count === 0 || isOpening ? 'opacity-50 cursor-not-allowed' : ''
                } ${isSelected ? 'animate-pulse bg-white/30' : ''}`}
              disabled={count === 0 || isOpening}
            >
              {isSelected ? 'Opening...' : 'Open'}
            </button>
          </div>
        )}
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
      <div className={`loot-box-section rounded-xl backdrop-blur-md ${theme.container} overflow-hidden py-2 ${className} w-full max-w-full`}>
        <div className={`loot-box-container relative b-g`}>
          <h1 className={`text-lg font-bold ${theme.text} mb-1 shrink-0 px-2`}>Treasure Vault</h1>
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
          {(isLoading || loading) ? (
            <p className={`${theme.text} px-2`}>Loading treasures...</p>
          ) : lootBoxes.length === 0 && !openResult ? (
            <p className={`${theme.text} text-sm px-2`}>Your vault is empty. Complete activities to earn treasure!</p>
          ) : (
            <div className="space-y-4 px-2">
              {/* Show either the rewards OR the loot box selection, never both */}
              {openResult && openResult.result ? (
                <div
                  className={`result-container p-2 rounded-lg ${theme.container} border ${theme.border} transition-all duration-1000 max-w-full
                ${isFadingOut ? 'opacity-0' : 'opacity-100'} 
                ${isCollecting ? 'collecting-animation' : ''}`}
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
                      onClick={() => handleCloseWinnings()}
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
                    className={`loot-box-item relative p-3 rounded-lg border-2 ${getRarityColorClass(selectedRarity)} ${getRarityGlowClass(selectedRarity)} flex flex-col items-center justify-center w-28 h-28 scale-105 space-y-1`}
                  >
                    <div className={`loot-box-icon text-3xl xl:text-4xl mb-2 ${isShaking ? 'shake-animation' : ''} ${isExploding ? 'explode-animation' : ''}`}>
                      📦
                    </div>
                    <span className="font-medium text-sm text-center">{getRarityName(selectedRarity)}</span>
                    <div className={`flex justify-center pb-1 text-xs`}>
                      {Array.from({ length: selectedRarity }, (_, i) => (
                        <span key={i}>★</span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Default view: show all available treasures */
                <>
                  <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-3 2xl:grid-cols-2">
                    {rarityLevels.map(renderRaritySection)}
                  </div>
                  <div className="text-xs text-center text-gray-400">
                    Click on a loot box to open it
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default LootBoxUtil;
