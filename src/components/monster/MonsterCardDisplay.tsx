import React, { useState, useEffect, useRef, useContext, useMemo, useCallback } from 'react';
import { InventoryItem } from '../../constants/CardConfig';
import { MonsterStats } from '../../utils/aoHelpers';
import { Gateway } from '../../constants/Constants';
import { CARD_ZOOM } from "../../constants/CardLayout";
import { currentTheme } from "../../constants/theme";
import { CARD, CardImages } from "../../constants/CardConfig";
import {
  getFibonacciExp,
  loadCardImages,
  loadMoveTypeImages,
  drawSectionTitle,
  drawStatusBar,
  drawInventorySlots,
  drawMoves
} from '../../utils/cardRenderHelpers';
import { useWallet } from '../../contexts/WalletContext';
import { useMonster } from '../../contexts/MonsterContext';

interface MonsterCardDisplayProps {
  className?: string;
  expanded?: boolean;
  inventoryItems?: InventoryItem[];
  darkMode?: boolean; // Allow passing darkMode directly
  // Monster can be optional now since we can get it from context
  monster?: MonsterStats;
}

export const MonsterCardDisplay: React.FC<MonsterCardDisplayProps> = ({ 
  monster: propMonster, 
  className = '', 
  expanded = false, 
  inventoryItems = [],
  darkMode: propDarkMode 
}) => {
  // Get monster from context if not passed as a prop
  const { monster: contextMonster, timeUpdateTrigger } = useMonster();
  // Get darkMode from context if not passed as a prop
  const { darkMode: contextDarkMode } = useWallet();
  
  // Use prop values if provided, otherwise fall back to context
  const monster = propMonster || contextMonster;
  const darkMode = propDarkMode !== undefined ? propDarkMode : contextDarkMode;
  
  // Set up a reference to track if we're using context monster
  const isUsingContextMonster = useRef(propMonster === undefined);
  
  const [isZoomed, setIsZoomed] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [previousRenderedCard, setPreviousRenderedCard] = useState<string | null>(null);
  const [cardImage, setCardImage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevMonsterRef = useRef<MonsterStats | null>(null);
  const prevInventoryRef = useRef<InventoryItem[] | null>(null);
  
  // Memoize theme to prevent unnecessary recalculations
  const theme = useMemo(() => currentTheme(darkMode || false), [darkMode]);

  // Extract theme colors for consistent use throughout the component
  const extractTextColor = useCallback((textClass: string) => {
    return textClass.replace('text-', '').replace('[', '').replace(']', '');
  }, []);

  // Memoize theme colors to prevent unnecessary recalculations
  const textColor = useMemo(() => extractTextColor(theme.text), [theme.text, extractTextColor]);
  const containerColor = useMemo(() => darkMode 
    ? 'rgb(129, 78, 51)' // removed transparency 
    : 'rgb(255, 255, 255)', // removed transparency
    [darkMode]);
  const borderColor = useMemo(() => darkMode 
    ? 'rgb(244, 134, 10)' // removed transparency
    : 'rgb(129, 78, 51)', // removed transparency
    [darkMode]);

  // Event handlers
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsZoomed(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsZoomed(false);
  }, []);

  // Memoize element type to prevent unnecessary recalculations
  const elementType = useMemo(() => 
    monster.elementType?.toLowerCase() as keyof typeof CardImages || 'air', 
    [monster.elementType]);

  // Main rendering function with optimizations to prevent flickering
  const renderToCanvas = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsRendering(true);

    try {
      // Set canvas dimensions - adjust width if expanded
      const cardWidth = expanded ? CARD.DIMENSIONS.HEIGHT : CARD.DIMENSIONS.WIDTH;
      const cardHeight = CARD.DIMENSIONS.HEIGHT;
      
      // Only resize the canvas if dimensions changed to avoid complete redraw
      if (canvas.width !== cardWidth || canvas.height !== cardHeight) {
        canvas.width = cardWidth;
        canvas.height = cardHeight;
      }
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // If expanded, prepare the expanded area with theme-appropriate background
      if (expanded) {
        // Use the card background color from theme
        ctx.fillStyle = theme.cardBg; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

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
      const newCardImage = canvas.toDataURL('image/png');
      setPreviousRenderedCard(cardImage);
      setCardImage(newCardImage);
    } catch (error) {
      console.error('Error rendering card:', error);
    } finally {
      setIsRendering(false);
      // Save current monster and inventory for comparison in next render
      // Use type assertion to store additional properties for comparison
      prevMonsterRef.current = Object.assign({}, monster) as (MonsterStats & {
        _darkMode: boolean;
        _expanded: boolean;
      });
      (prevMonsterRef.current as any)._darkMode = darkMode;
      (prevMonsterRef.current as any)._expanded = expanded;
      prevInventoryRef.current = [...inventoryItems];
    }
  }, [monster, elementType, expanded, inventoryItems, darkMode, theme]);

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

  // Custom section title drawing function that aligns underline with the title
  const drawCustomSectionTitle = (
    ctx: CanvasRenderingContext2D,
    title: string,
    expandedAreaX: number,
    expandedAreaWidth: number,
    titleY: number,
    titleX: number,
    titleWidth: number,
    sectionTitleConfig: any,
    padding: {
      RIGHT: number;
      OVERLAY_LEFT: number;
    }
  ) => {
    // Add shadow to the title
    if (sectionTitleConfig.SHADOW) {
      ctx.shadowColor = sectionTitleConfig.SHADOW.COLOR;
      ctx.shadowBlur = sectionTitleConfig.SHADOW.BLUR;
      ctx.shadowOffsetX = sectionTitleConfig.SHADOW.OFFSET_X;
      ctx.shadowOffsetY = sectionTitleConfig.SHADOW.OFFSET_Y;
    }
    
    ctx.font = `${sectionTitleConfig.FONT.WEIGHT} ${sectionTitleConfig.FONT.SIZE}px ${sectionTitleConfig.FONT.FAMILY}`;
    ctx.fillStyle = sectionTitleConfig.FONT.COLOR;
    ctx.textAlign = 'left';
    ctx.fillText(title, titleX, titleY);
    
    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Draw underline below the title
    const underlineY = titleY + sectionTitleConfig.SPACING.BOTTOM;
    
    // Draw a gradient underline if specified
    if (sectionTitleConfig.UNDERLINE.GRADIENT) {
      const gradient = ctx.createLinearGradient(
        titleX, 
        underlineY, 
        titleX + titleWidth, 
        underlineY
      );
      gradient.addColorStop(0, sectionTitleConfig.UNDERLINE.COLOR);
      // gradient.addColorStop(0.5, '#9bc1ff'); // Lighter middle
      gradient.addColorStop(1, sectionTitleConfig.UNDERLINE.COLOR);
      
      ctx.strokeStyle = gradient;
    } else {
      ctx.strokeStyle = sectionTitleConfig.UNDERLINE.COLOR;
    }
    
    ctx.lineWidth = sectionTitleConfig.UNDERLINE.WIDTH;
    
    // Start and end the underline at the title position
    ctx.beginPath();
    ctx.moveTo(titleX, underlineY);
    ctx.lineTo(titleX + titleWidth, underlineY);
    ctx.stroke();
    
    return underlineY + sectionTitleConfig.SPACING.AFTER;
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
    
    // Draw the side image as background without filters
    if (sideImg) {
      // Draw the side image with full opacity at exact position without offset
      ctx.drawImage(sideImg, expandedAreaX, expandedAreaY, expandedAreaWidth, expandedAreaHeight);
    }
    
    // No border box needed anymore
    
    // Draw moves section
    const contentX = expandedAreaX + CARD.EXPANDED.PADDING.OVERLAY_LEFT + 10;
    const contentWidth = expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT - CARD.EXPANDED.PADDING.OVERLAY_LEFT - 20;
    const contentY = CARD.EXPANDED.PADDING.TOP + 10;
    
    // Draw moves section
    const lastMoveY = await drawMovesSection(ctx, monster, expandedAreaX, expandedAreaY, expandedAreaWidth, originalCardWidth, contentX, contentY, contentWidth);
    
    // Draw status section (energy, happiness, experience)
    const lastStatusY = drawStatusSection(ctx, monster, expandedAreaX, expandedAreaWidth, originalCardWidth, lastMoveY, contentX, contentWidth);
    
    // Draw inventory section
    drawInventorySection(ctx, inventoryItems, lastStatusY, expandedAreaX, expandedAreaWidth, originalCardWidth, contentX, contentWidth);
  };

  // Draw moves section with theme-appropriate colors
  const drawMovesSection = async (
    ctx: CanvasRenderingContext2D, 
    monster: MonsterStats, 
    expandedAreaX: number, 
    expandedAreaY: number, 
    expandedAreaWidth: number,
    originalCardWidth: number,
    contentX: number,
    contentY: number,
    contentWidth: number
  ) => {
    // Start drawing with padding from top
    let currentY = contentY;
    
    // Get position values for title and content
    const movesTitleY = currentY;
    const titleX = contentX;
    const titleWidth = contentWidth;
    
  // Draw "Moves" title with underline
  const sectionTitleX = titleX + 10;
  // Make underline slightly smaller than titleWidth
  const underlineWidth = titleWidth * 0.9;

  const movesContentY = drawCustomSectionTitle(
    ctx, 
    'Moves', 
    expandedAreaX, 
    expandedAreaWidth, 
    movesTitleY, 
    sectionTitleX, // Use the shifted position
    underlineWidth, // Use the smaller width for underline
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
    {
      RIGHT: CARD.EXPANDED.PADDING.RIGHT,
      OVERLAY_LEFT: CARD.EXPANDED.PADDING.OVERLAY_LEFT // Use the config values
    }
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
      {
        RIGHT: 0 // Simple padding object with just RIGHT property
      },
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
    lastMoveY: number,
    contentX: number,
    contentWidth: number
  ) => {
    // Calculate position for Status section using the last Y position of moves
    const statusTitleY = lastMoveY + CARD.EXPANDED.MOVES.SECTION_SPACING;
    const titleX = contentX;
    const titleWidth = contentWidth;
    
  // Draw "Status" title with underline using theme colors
  const sectionTitleX = titleX + 10;
  // Make underline slightly smaller than titleWidth
  const underlineWidth = titleWidth * 0.9;
  
  const statusContentY = drawCustomSectionTitle(
    ctx, 
    'Status', 
    expandedAreaX, 
    expandedAreaWidth, 
    statusTitleY, 
    sectionTitleX, // Use the shifted position
    underlineWidth, // Use the smaller width for underline
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
    {
      RIGHT: CARD.EXPANDED.PADDING.RIGHT,
      OVERLAY_LEFT: CARD.EXPANDED.PADDING.OVERLAY_LEFT // Use the config values
    }
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
      titleX, // Use black box x position instead of expandedAreaX
      titleWidth, // Use black box width instead of expandedAreaWidth
      statusY, 
      {
        RIGHT: 0 // Keep only RIGHT property as that's what drawStatusBar expects
      }, 
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
      titleX, // Use black box x position instead of expandedAreaX
      titleWidth, // Use black box width instead of expandedAreaWidth
      statusY, 
      {
        RIGHT: 0 // Keep only RIGHT property as that's what drawStatusBar expects
      }, 
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
      titleX, // Use black box x position instead of expandedAreaX
      titleWidth, // Use black box width instead of expandedAreaWidth
      statusY, 
      {
        RIGHT: 0 // Keep only RIGHT property as that's what drawStatusBar expects
      }, 
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
    originalCardWidth: number,
    contentX: number,
    contentWidth: number
  ) => {
    // Calculate position for inventory section
    const inventoryTitleY = lastStatusY + CARD.EXPANDED.INVENTORY.SECTION_SPACING;
    const titleX = contentX;
    const titleWidth = contentWidth;
    
  // Draw "Inventory" title with underline using theme colors
  const sectionTitleX = titleX + 10;
  // Make underline slightly smaller than titleWidth
  const underlineWidth = titleWidth * 0.9;
  
  const inventoryContentY = drawCustomSectionTitle(
    ctx, 
    'Inventory', 
    expandedAreaX, 
    expandedAreaWidth, 
    inventoryTitleY, 
    sectionTitleX, // Use the shifted position
    underlineWidth, // Use the smaller width for underline
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
    {
      RIGHT: CARD.EXPANDED.PADDING.RIGHT,
      OVERLAY_LEFT: CARD.EXPANDED.PADDING.OVERLAY_LEFT // Use the config values
    }
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
            COLOR: darkMode ? 'rgb(252, 245, 216)' : 'rgb(13, 7, 5)', // Solid colors without transparency
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
      {
        RIGHT: 0 // Keep only RIGHT property as that's what drawInventorySlots expects
      }, 
      titleX, // Use black box x position instead of expandedAreaX
      titleWidth, // Use black box width instead of expandedAreaWidth
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
  const renderCard = useCallback((scale = 1) => (
    <div 
      className={`relative w-full ${expanded ? 'aspect-square' : 'aspect-[2.5/3.5]'} ${className}`}
      style={{
        transform: `scale(${scale})`,
        transition: `transform ${CARD_ZOOM.DURATION}`,
        transformOrigin: 'center center'
      }}
    >
      {/* Show previous card image during render to prevent flickering */}
      {isRendering && previousRenderedCard && (
        <img
          src={previousRenderedCard}
          alt={monster.name || 'Monster Card'}
          className="absolute inset-0 w-full h-full transition-opacity duration-200"
          style={{ 
            aspectRatio: expanded ? '1/1' : CARD.DIMENSIONS.ASPECT_RATIO,
            objectFit: 'contain',
            opacity: 0.7
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        className={`w-full h-full transition-opacity duration-200 ${isRendering ? 'opacity-0' : 'opacity-100'}`}
        style={{ 
          aspectRatio: expanded ? '1/1' : CARD.DIMENSIONS.ASPECT_RATIO,
          objectFit: 'contain'
        }}
      />
    </div>
  ), [className, expanded, isRendering, monster.name, previousRenderedCard]);

  // Compare previous monster and current monster to determine if a full re-render is needed
  const needsFullRerender = useCallback(() => {
    // Always rerender if this is the first render
    if (!prevMonsterRef.current) return true;
    
    // Always rerender if expanded or darkMode changes
    const prev = prevMonsterRef.current as any;
    if (prev._expanded !== expanded || prev._darkMode !== darkMode) return true;
    
    // Check if inventory has changed
    if (inventoryItems.length !== (prevInventoryRef.current?.length || 0)) return true;
    
    // Check if the monster data has changed in ways that affect rendering
    const significantChanges = 
      monster.level !== prev.level ||
      monster.name !== prev.name ||
      monster.elementType !== prev.elementType ||
      monster.attack !== prev.attack ||
      monster.defense !== prev.defense ||
      monster.speed !== prev.speed ||
      monster.health !== prev.health ||
      // Add status checks to trigger re-render when status changes
      monster.status?.type !== prev.status?.type ||
      monster.status?.until_time !== prev.status?.until_time ||
      monster.energy !== prev.energy ||
      monster.happiness !== prev.happiness ||
      monster.exp !== prev.exp;
    
    return significantChanges;
  }, [monster, inventoryItems, expanded, darkMode]);
  
  // Optimized rendering that only re-renders when necessary
  useEffect(() => {
    // If we're already rendering, don't start another render
    if (isRendering) return;
    
    // If we don't need a full re-render, don't do one
    if (prevMonsterRef.current && !needsFullRerender()) return;
    
    // Schedule the render with a small delay to batch multiple prop changes
    const renderTimer = setTimeout(() => {
      renderToCanvas();
    }, 10);
    
    return () => clearTimeout(renderTimer);
  }, [renderToCanvas, isRendering, needsFullRerender]);
  
  // Add a separate effect specifically to handle timeUpdateTrigger changes
  // This will force a re-render when the context monster changes due to activities
  useEffect(() => {
    // Only respond to timeUpdateTrigger if we're using the context monster
    if (isUsingContextMonster.current && timeUpdateTrigger > 0) {
      console.log('[MonsterCardDisplay] Context monster updated, refreshing display');
      renderToCanvas();
    }
  }, [timeUpdateTrigger, renderToCanvas]);

  // Memoize the zoomed view to prevent unnecessary re-renders
  const zoomedView = useMemo(() => {
    if (!isZoomed) return null;
    
    return (
      <div 
        className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 cursor-pointer animate-fadeIn"
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
            className="w-full h-full object-contain animate-scaleIn"
            style={{
              transform: 'scale(1.5)',
              transition: `transform ${CARD_ZOOM.DURATION}, opacity 0.2s ease-in-out`,
              transformOrigin: 'center center'
            }}
          />
        </div>
      </div>
    );
  }, [isZoomed, cardImage, monster.name, handleClose]);

  // Main component render - memoized to prevent unnecessary re-renders
  return (
    <>
      <div onClick={handleClick}>
        {renderCard()}
      </div>
      {zoomedView}
    </>
  );
};
