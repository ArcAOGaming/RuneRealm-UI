import React, { useState, useCallback, useEffect, useRef } from 'react';
import { MonsterStats } from '../utils/aoHelpers';
import { Gateway } from '../constants/Constants';
import { CARD_ZOOM } from '../constants/CardLayout';
import { currentTheme, Theme } from '../constants/theme';
import { CARD, CardImages, InventoryItem } from '../constants/CardConfig';
import {
  getFibonacciExp,
  loadCardImages,
  loadMoveTypeImages,
  drawSectionTitle,
  drawStatusBar,
  drawInventorySlots,
  drawMoves
} from '../utils/cardRenderHelpers';
import { useWallet } from '../hooks/useWallet';

interface MonsterCardDisplayProps {
  monster: MonsterStats;
  className?: string;
  expanded?: boolean;
  inventoryItems?: InventoryItem[];
  darkMode?: boolean; // Allow passing darkMode directly
}

export const MonsterCardDisplay: React.FC<MonsterCardDisplayProps> = ({ 
  monster, 
  className = '', 
  expanded = false, 
  inventoryItems = [],
  darkMode: propDarkMode 
}) => {
  // Get darkMode from context if not passed as a prop
  const { darkMode: contextDarkMode } = useWallet();
  const darkMode = propDarkMode !== undefined ? propDarkMode : contextDarkMode;
  
  const [isZoomed, setIsZoomed] = useState(false);
  const theme = currentTheme(darkMode || false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cardImage, setCardImage] = useState<string | null>(null);

  // Extract theme colors for consistent use throughout the component
  const extractTextColor = (textClass: string) => {
    return textClass.replace('text-', '').replace('[', '').replace(']', '');
  };

  // Theme colors extracted for direct usage in canvas
  const textColor = extractTextColor(theme.text);
  const containerColor = darkMode 
    ? 'rgba(129, 78, 51, 0.2)' // from theme.container
    : 'rgba(255, 255, 255, 0.5)'; // from theme.container
  const borderColor = darkMode 
    ? 'rgba(244, 134, 10, 0.3)' // from theme.border
    : 'rgba(129, 78, 51, 0.3)'; // from theme.border

  // Event handlers
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsZoomed(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsZoomed(false);
  }, []);

  // Get element-specific images
  const elementType = monster.elementType?.toLowerCase() as keyof typeof CardImages || 'air';

  // Main rendering function
  const renderToCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions - adjust width if expanded
    const cardWidth = expanded ? CARD.DIMENSIONS.HEIGHT : CARD.DIMENSIONS.WIDTH;
    const cardHeight = CARD.DIMENSIONS.HEIGHT;
    
    canvas.width = cardWidth;
    canvas.height = cardHeight;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If expanded, prepare the expanded area with theme-appropriate background
    if (expanded) {
      // Use the card background color from theme
      ctx.fillStyle = theme.cardBg; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    try {
      // Load all necessary images
      const cardImages = await loadCardImages(elementType, monster, expanded, CardImages);
      
      // Set up original card area - either full canvas or left portion if expanded
      const originalCardWidth = CARD.DIMENSIONS.WIDTH;
      
      // Draw base card elements
      await drawBaseCard(ctx, cardImages, originalCardWidth, cardHeight);
      
      // Draw monster level
      drawMonsterLevel(ctx, monster.level, originalCardWidth, canvas.height);
      
      // Draw monster image if available
      if (cardImages.monsterImg) {
        drawMonsterImage(ctx, cardImages.monsterImg, originalCardWidth);
      }

      // Draw stats
      drawMonsterStats(ctx, monster, originalCardWidth, canvas.height);

      // Draw monster name text
      drawMonsterName(ctx, monster.name || 'Unknown Monster', originalCardWidth, canvas.height);

      // If expanded, draw the expanded section
      if (expanded) {
        // Draw the expanded section using the theme
        await drawExpandedSection(ctx, cardImages, monster, originalCardWidth, cardHeight, inventoryItems);
      }

      // Store the final rendered image
      setCardImage(canvas.toDataURL('image/png'));
    } catch (error) {
      console.error('Error rendering card:', error);
    }
  };

  // Draw the base card elements (background, frame, element type, level image)
  const drawBaseCard = async (
    ctx: CanvasRenderingContext2D, 
    cardImages: any, 
    originalCardWidth: number, 
    cardHeight: number
  ) => {
    const { bgImg, frameImg, elementImg, levelImg } = cardImages;
    
    // Draw background
    ctx.drawImage(bgImg, 0, 0, originalCardWidth, cardHeight);
    // Draw frame
    ctx.drawImage(frameImg, 0, 0, originalCardWidth, cardHeight);
    // Draw element type
    ctx.drawImage(elementImg, 0, 0, originalCardWidth, cardHeight);
    // Draw level image
    ctx.drawImage(levelImg, 0, 0, originalCardWidth, cardHeight);
  };

  // Draw the monster level text
  const drawMonsterLevel = (
    ctx: CanvasRenderingContext2D, 
    level: number, 
    originalCardWidth: number, 
    canvasHeight: number
  ) => {
    ctx.font = `${CARD.LEVEL.FONT.WEIGHT} ${Math.floor(canvasHeight * CARD.LEVEL.FONT.SIZE_RATIO)}px ${CARD.LEVEL.FONT.FAMILY}`;
    ctx.fillStyle = CARD.LEVEL.FONT.COLOR; 
    ctx.textAlign = 'center';
    const levelX = originalCardWidth * CARD.LEVEL.POSITION.LEFT_RATIO + CARD.LEVEL.POSITION.OFFSET_X;
    const levelY = canvasHeight * CARD.LEVEL.POSITION.TOP_RATIO + CARD.LEVEL.POSITION.OFFSET_Y;
    ctx.fillText(`Lv.${level}`, levelX, levelY);
  };

  // Draw the monster image
  const drawMonsterImage = (
    ctx: CanvasRenderingContext2D, 
    monsterImg: HTMLImageElement, 
    originalCardWidth: number
  ) => {
    const scale = Math.min(
      CARD.MONSTER.TARGET_SIZE.WIDTH / monsterImg.width,
      CARD.MONSTER.TARGET_SIZE.HEIGHT / monsterImg.height
    );
    const scaledWidth = monsterImg.width * scale;
    const scaledHeight = monsterImg.height * scale;
    
    const monsterX = CARD.MONSTER.POSITION.CENTER ? (originalCardWidth - scaledWidth) / 2 : 0;
    const monsterY = ctx.canvas.height * CARD.MONSTER.POSITION.TOP_RATIO;
    
    ctx.drawImage(monsterImg, monsterX, monsterY, scaledWidth, scaledHeight);
  };

  // Draw the monster stats
  const drawMonsterStats = (
    ctx: CanvasRenderingContext2D, 
    monster: MonsterStats, 
    originalCardWidth: number, 
    canvasHeight: number
  ) => {
    ctx.font = `${CARD.STATS.FONT.WEIGHT} ${Math.floor(canvasHeight * CARD.STATS.FONT.SIZE_RATIO)}px ${CARD.STATS.FONT.FAMILY}`;
    ctx.fillStyle = CARD.STATS.FONT.COLOR;
    ctx.textAlign = 'left';
    
    const statsY = canvasHeight * CARD.STATS.POSITION.TOP_RATIO + CARD.STATS.POSITION.OFFSET_Y;
    const statsX = originalCardWidth * CARD.STATS.POSITION.START_X_RATIO;
    const spacing = originalCardWidth * CARD.STATS.POSITION.SPACING_RATIO;
    
    const stats = [monster.attack, monster.speed, monster.defense, monster.health];
    stats.forEach((stat, index) => {
      const x = statsX + (spacing * index);
      ctx.fillText(stat.toString(), x, statsY);
    });
  };

  // Draw the monster name
  const drawMonsterName = (
    ctx: CanvasRenderingContext2D, 
    name: string, 
    originalCardWidth: number, 
    canvasHeight: number
  ) => {
    ctx.font = `${CARD.NAME.FONT.WEIGHT} ${Math.floor(canvasHeight * CARD.NAME.FONT.SIZE_RATIO)}px ${CARD.NAME.FONT.FAMILY}`;
    ctx.fillStyle = CARD.NAME.FONT.COLOR;
    ctx.textAlign = 'center';
    const nameX = originalCardWidth / 2;
    const nameY = canvasHeight * CARD.NAME.POSITION.TOP_RATIO;
    ctx.fillText(name, nameX, nameY);
  };

  // Draw the expanded section with moves, status, and inventory
  const drawExpandedSection = async (
    ctx: CanvasRenderingContext2D, 
    cardImages: any, 
    monster: MonsterStats, 
    originalCardWidth: number, 
    cardHeight: number,
    inventoryItems: InventoryItem[]
  ) => {
    const { sideImg } = cardImages;
    
    // Calculate positions for expanded section
    const expandedAreaX = originalCardWidth;
    const expandedAreaY = 0;
    const expandedAreaWidth = CARD.EXPANDED.WIDTH;
    const expandedAreaHeight = cardHeight;
    
    // Draw the side image as background with theme-appropriate transparency
    if (sideImg) {
      const offsetX = expandedAreaX - 2; // Background offset
      
      // Apply a theme-appropriate background by first drawing a semi-transparent
      // colored rectangle and then drawing the side image with reduced opacity
      
      // First, fill with theme background color
      ctx.fillStyle = containerColor;
      ctx.fillRect(offsetX, expandedAreaY, expandedAreaWidth, expandedAreaHeight);
      
      // Draw the side image with reduced opacity to blend with theme
      ctx.globalAlpha = 0.85; // Reduced opacity to blend with theme
      ctx.drawImage(sideImg, offsetX, expandedAreaY, expandedAreaWidth, expandedAreaHeight);
      ctx.globalAlpha = 1.0; // Reset opacity
    }
    
    // Draw border for expanded section with theme-appropriate color
    if (CARD.EXPANDED.BACKGROUND) {
      drawExpandedBorder(ctx, expandedAreaX, expandedAreaY, expandedAreaWidth, expandedAreaHeight);
    }
    
    // Draw moves section
    const lastMoveY = await drawMovesSection(ctx, monster, expandedAreaX, expandedAreaY, expandedAreaWidth, originalCardWidth);
    
    // Draw status section (energy, happiness, experience)
    const lastStatusY = drawStatusSection(ctx, monster, expandedAreaX, expandedAreaWidth, originalCardWidth, lastMoveY);
    
    // Draw inventory section
    drawInventorySection(ctx, inventoryItems, lastStatusY, expandedAreaX, expandedAreaWidth, originalCardWidth);
  };

  // Draw border for expanded section with theme color
  const drawExpandedBorder = (
    ctx: CanvasRenderingContext2D, 
    expandedAreaX: number, 
    expandedAreaY: number, 
    expandedAreaWidth: number, 
    expandedAreaHeight: number
  ) => {
    const radius = CARD.EXPANDED.BACKGROUND.BORDER.RADIUS;
    
    // Make the overlay just a bit smaller than full width 
    const overlayWidth = expandedAreaWidth * 1.0 - CARD.EXPANDED.PADDING.OVERLAY_LEFT;
    const overlayX = expandedAreaX + CARD.EXPANDED.PADDING.OVERLAY_LEFT;
    
    // Draw only the border of the rounded rectangle
    ctx.beginPath();
    ctx.moveTo(overlayX + radius, expandedAreaY);
    ctx.lineTo(overlayX + overlayWidth - radius, expandedAreaY);
    ctx.arcTo(overlayX + overlayWidth, expandedAreaY, overlayX + overlayWidth, expandedAreaY + radius, radius);
    ctx.lineTo(overlayX + overlayWidth, expandedAreaHeight - radius);
    ctx.arcTo(overlayX + overlayWidth, expandedAreaHeight, overlayX + overlayWidth - radius, expandedAreaHeight, radius);
    ctx.lineTo(overlayX + radius, expandedAreaHeight);
    ctx.arcTo(overlayX, expandedAreaHeight, overlayX, expandedAreaHeight - radius, radius);
    ctx.lineTo(overlayX, expandedAreaY + radius);
    ctx.arcTo(overlayX, expandedAreaY, overlayX + radius, expandedAreaY, radius);
    ctx.closePath();
  
    // Draw only the border with theme-appropriate color
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = CARD.EXPANDED.BACKGROUND.BORDER.WIDTH;
    ctx.stroke();
  };

  // Draw moves section with theme-appropriate colors
  const drawMovesSection = async (
    ctx: CanvasRenderingContext2D, 
    monster: MonsterStats, 
    expandedAreaX: number, 
    expandedAreaY: number, 
    expandedAreaWidth: number,
    originalCardWidth: number
  ) => {
    // Start drawing with padding from top
    let currentY = expandedAreaY + CARD.EXPANDED.PADDING.TOP;
    
    // Get position values for title and content
    const movesTitleY = currentY;
    // Use fixed position rather than subtraction which resulted in zero
    const titleX = expandedAreaX + CARD.EXPANDED.PADDING.OVERLAY_LEFT;
    const titleWidth = expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT - CARD.EXPANDED.PADDING.OVERLAY_LEFT;
    
    // Draw "Moves" title with underline
    const movesContentY = drawSectionTitle(
      ctx, 
      'Moves', 
      expandedAreaX, 
      expandedAreaWidth, 
      movesTitleY, 
      titleX, 
      titleWidth, 
      {
        ...CARD.EXPANDED.SECTION_TITLE,
        FONT: {
          ...CARD.EXPANDED.SECTION_TITLE.FONT,
          COLOR: theme.cardTitle, // Use theme title color
        },
        UNDERLINE: {
          ...CARD.EXPANDED.SECTION_TITLE.UNDERLINE,
          COLOR: theme.cardAccent, // Use theme accent color
        }
      },
      CARD.EXPANDED.PADDING
    );
    
    // Load move type images for all the monster's moves
    const moveTypeImages = await loadMoveTypeImages(monster, CardImages);
    
    // Draw all the moves with theme-appropriate section styling
    const updatedMoveConfig = {
      ...CARD.EXPANDED.MOVES,
      BACKGROUND: {
        COLOR: containerColor, // Use theme container color
      },
      BORDER: {
        ...CARD.EXPANDED.MOVES.BORDER,
        COLOR: borderColor, // Use theme border color
      },
      FONT: {
        ...CARD.EXPANDED.MOVES.FONT,
        NAME: {
          ...CARD.EXPANDED.MOVES.FONT.NAME,
          COLOR: theme.cardText, // Use theme text color
        },
        STATS: {
          ...CARD.EXPANDED.MOVES.FONT.STATS,
          COLOR: theme.cardText, // Use theme text color
        }
      },
      STATS: {
        ...CARD.EXPANDED.MOVES.STATS,
        LAYOUT: {
          ...CARD.EXPANDED.MOVES.STATS.LAYOUT,
          BACKGROUND: {
            ...CARD.EXPANDED.MOVES.STATS.LAYOUT.BACKGROUND,
            COLOR: containerColor, // Use theme container color
            BORDER_COLOR: borderColor, // Use theme border color
          },
          FONT: {
            ...CARD.EXPANDED.MOVES.STATS.LAYOUT.FONT,
            COLOR: theme.cardText, // Use theme text color
          }
        }
      }
    };
    
    return drawMoves(
      ctx, 
      monster, 
      expandedAreaX, 
      expandedAreaWidth, 
      movesContentY, 
      titleX, 
      titleWidth, 
      CARD.EXPANDED.PADDING,
      updatedMoveConfig,
      moveTypeImages
    );
  };

  // Draw status section with energy, happiness and experience bars using theme colors
  const drawStatusSection = (
    ctx: CanvasRenderingContext2D, 
    monster: MonsterStats, 
    expandedAreaX: number, 
    expandedAreaWidth: number,
    originalCardWidth: number,
    lastMoveY: number
  ) => {
    // Calculate position for Status section using the last Y position of moves
    const statusTitleY = lastMoveY + CARD.EXPANDED.MOVES.SECTION_SPACING;
    // Use fixed position rather than subtraction which resulted in zero
    const titleX = expandedAreaX + CARD.EXPANDED.PADDING.OVERLAY_LEFT;
    const titleWidth = expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT - CARD.EXPANDED.PADDING.OVERLAY_LEFT;
    
    // Draw "Status" title with underline using theme colors
    const statusContentY = drawSectionTitle(
      ctx, 
      'Status', 
      expandedAreaX, 
      expandedAreaWidth, 
      statusTitleY, 
      titleX, 
      titleWidth, 
      {
        ...CARD.EXPANDED.SECTION_TITLE,
        FONT: {
          ...CARD.EXPANDED.SECTION_TITLE.FONT,
          COLOR: theme.cardTitle, // Use theme title color
        },
        UNDERLINE: {
          ...CARD.EXPANDED.SECTION_TITLE.UNDERLINE,
          COLOR: theme.cardAccent, // Use theme accent color
        }
      },
      CARD.EXPANDED.PADDING
    );
    
    // Draw status bars
    let statusY = statusContentY;
    
    // Draw Energy Bar - using theme statusEnergy color
    drawStatusBar(
      ctx, 
      'Energy', 
      monster.energy || 0, // Default to 0 if undefined
      100, 
      theme.statusEnergy, // Use theme energy color
      expandedAreaX, 
      expandedAreaWidth, 
      statusY, 
      CARD.EXPANDED.PADDING, 
      titleWidth,
      undefined,
      theme.cardText // Use theme text color
    );
    statusY += 50;
    
    // Draw Happiness Bar - using theme statusHappiness color
    drawStatusBar(
      ctx, 
      'Happiness', 
      monster.happiness || 0, // Default to 0 if undefined
      100, 
      theme.statusHappiness, // Use theme happiness color
      expandedAreaX, 
      expandedAreaWidth, 
      statusY, 
      CARD.EXPANDED.PADDING, 
      titleWidth,
      undefined,
      theme.cardText // Use theme text color
    );
    statusY += 50;
    
    // Draw Experience Bar - using theme statusExperience color
    const expNeeded = getFibonacciExp(monster.level);
    drawStatusBar(
      ctx, 
      'Experience', 
      monster.exp || 0, // Default to 0 if undefined
      expNeeded, 
      theme.statusExperience, // Use theme experience color
      expandedAreaX, 
      expandedAreaWidth, 
      statusY, 
      CARD.EXPANDED.PADDING, 
      titleWidth,
      `${monster.exp || 0}/${expNeeded}`,
      theme.cardText // Use theme text color
    );
    statusY += 50;
    
    // Return the last Y position for the inventory section
    return statusY + 30;
  };

  // Draw inventory section using theme colors
  const drawInventorySection = (
    ctx: CanvasRenderingContext2D, 
    inventoryItems: InventoryItem[], 
    lastStatusY: number, 
    expandedAreaX: number, 
    expandedAreaWidth: number,
    originalCardWidth: number
  ) => {
    // Calculate position for inventory section
    const inventoryTitleY = lastStatusY + CARD.EXPANDED.INVENTORY.SECTION_SPACING;
    // Use fixed position rather than subtraction which resulted in zero
    const titleX = expandedAreaX + CARD.EXPANDED.PADDING.OVERLAY_LEFT;
    const titleWidth = expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT - CARD.EXPANDED.PADDING.OVERLAY_LEFT;
    
    // Draw "Inventory" title with underline using theme colors
    const inventoryContentY = drawSectionTitle(
      ctx, 
      'Inventory', 
      expandedAreaX, 
      expandedAreaWidth, 
      inventoryTitleY, 
      titleX, 
      titleWidth, 
      {
        ...CARD.EXPANDED.SECTION_TITLE,
        FONT: {
          ...CARD.EXPANDED.SECTION_TITLE.FONT,
          COLOR: theme.cardTitle, // Use theme title color
        },
        UNDERLINE: {
          ...CARD.EXPANDED.SECTION_TITLE.UNDERLINE,
          COLOR: theme.cardAccent, // Use theme accent color
        }
      },
      CARD.EXPANDED.PADDING
    );
    
    // Draw inventory slots
    const inventoryY = inventoryContentY;
    const inventoryX = titleX;
    
    // Update inventory config with theme colors
    const updatedInventoryConfig = {
      ...CARD.EXPANDED.INVENTORY,
      FONT: {
        ...CARD.EXPANDED.INVENTORY.FONT,
        NAME: {
          ...CARD.EXPANDED.INVENTORY.FONT.NAME,
          COLOR: theme.cardText, // Use theme text color
        }
      },
      SLOT: {
        ...CARD.EXPANDED.INVENTORY.SLOT,
        BACKGROUND: {
          ...CARD.EXPANDED.INVENTORY.SLOT.BACKGROUND,
          COLOR: containerColor, // Use theme container color
          BORDER_COLOR: borderColor, // Use theme border color
        },
        EMPTY_TEXT: {
          ...CARD.EXPANDED.INVENTORY.SLOT.EMPTY_TEXT,
          FONT: {
            ...CARD.EXPANDED.INVENTORY.SLOT.EMPTY_TEXT.FONT,
            COLOR: darkMode ? 'rgba(252, 245, 216, 0.5)' : 'rgba(13, 7, 5, 0.5)', // Semi-transparent version of text color
          }
        }
      }
    };
    
    drawInventorySlots(
      ctx, 
      inventoryItems, 
      inventoryY, 
      inventoryX, 
      titleWidth, 
      CARD.EXPANDED.PADDING, 
      expandedAreaX, 
      expandedAreaWidth, 
      updatedInventoryConfig
    );
  };

  // Export card function
  const exportCard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${monster.name || 'monster'}-card.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting card:', error);
    }
  };

  // Render the card with specified scale
  const renderCard = (scale = 1) => (
    <div 
      className={`relative w-full ${expanded ? 'aspect-square' : 'aspect-[2.5/3.5]'} ${className}`}
      style={{
        transform: `scale(${scale})`,
        transition: `transform ${CARD_ZOOM.DURATION}`,
        transformOrigin: 'center center'
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ 
          aspectRatio: expanded ? '1/1' : CARD.DIMENSIONS.ASPECT_RATIO,
          objectFit: 'contain'
        }}
      />
    </div>
  );

  // Run rendering when monster or element type changes
  useEffect(() => {
    renderToCanvas();
  }, [monster, elementType, expanded, inventoryItems, darkMode]);

  // Main component render
  return (
    <>
      <div onClick={handleClick}>
        {renderCard()}
      </div>
      
      {isZoomed && (
        <div 
          className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 cursor-pointer"
          style={{ zIndex: CARD_ZOOM.Z_INDEX }}
          onClick={handleClose}
        >
          <div 
            className="max-w-[500px] w-full p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={cardImage || ''}
              alt={monster.name || 'Monster Card'}
              className="w-full h-full object-contain"
              style={{
                transform: 'scale(1.5)',
                transition: `transform ${CARD_ZOOM.DURATION}`,
                transformOrigin: 'center center'
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};
