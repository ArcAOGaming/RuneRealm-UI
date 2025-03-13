import React, { useState, useCallback, useEffect, useRef } from 'react';
import { MonsterStats } from '../utils/aoHelpers';
import { Gateway } from '../constants/Constants';
import { CARD_LAYOUT, CARD_ZOOM } from '../constants/CardLayout';
import { currentTheme } from '../constants/theme';

// Card dimensions and layout
const CARD = {
  DIMENSIONS: {
    WIDTH: 648,
    HEIGHT: 1065,
    ASPECT_RATIO: '648/1065'
  },
  MONSTER: {
    TARGET_SIZE: {
      WIDTH: 500,
      HEIGHT: 750
    },
    POSITION: {
      TOP_RATIO: 0.04,
      CENTER: true
    }
  },
  LEVEL: {
    FONT: {
      FAMILY: 'Arial, sans-serif',
      WEIGHT: '1000',
      SIZE_RATIO: 0.025,
      COLOR: 'white'
    },
    POSITION: {
      LEFT_RATIO: 0.073,
      TOP_RATIO: 0.05,
      OFFSET_X: 10,
      OFFSET_Y: 10
    }
  },
  STATS: {
    FONT: {
      FAMILY: 'Courier New, monospace',
      WEIGHT: '600',
      SIZE_RATIO: 0.035,
      COLOR: 'white'
    },
    POSITION: {
      START_X_RATIO: 0.26,
      TOP_RATIO: 0.55,
      OFFSET_Y: 50,
      SPACING_RATIO: 0.20
    }
  },
  NAME: {
    FONT: {
      FAMILY: 'Arial, sans-serif',
      WEIGHT: '1000',
      SIZE_RATIO: 0.06,
      COLOR: 'white'
    },
    POSITION: {
      TOP_RATIO: 0.09,
      CENTER: true
    }
  },
  MOVES: {
    FONT: {
      NAME: {
        FAMILY: 'Arial, sans-serif',
        WEIGHT: '800',
        SIZE_RATIO: 0.035,
        COLOR: 'white'
      },
      STATS: {
        FAMILY: 'Arial, sans-serif',
        WEIGHT: '600',
        SIZE_RATIO: 0.035,
        COLOR: 'white'
      }
    },
    POSITION: {
      BOTTOM_RATIO: 0.25, // Start from bottom 25%
      GRID: {
        ROWS: 2,
        COLS: 2,
        GAP_RATIO: 0.04
      }
    },
    EMOJIS: {
      attack: '⚔️',
      speed: '⚡',
      defense: '🛡️',
      health: '❤️'
    }
  },
  // Configuration for the expanded side section
  EXPANDED: {
    // Spacing and layout for the expanded area
    PADDING: {
      LEFT: 20,    // Left padding from original card width
      RIGHT: 20,   // Right padding from card width
      TOP: 50      // Top padding for the expanded area
    },
    WIDTH: 420,    // Width of the expanded section
    // Section titles configuration
    SECTION_TITLE: {
      FONT: {
        FAMILY: 'Arial, sans-serif',
        WEIGHT: 'bold',
        SIZE: 36,
        COLOR: 'black'
      },
      SPACING: {
        BOTTOM: 10,     // Space below the title text before the underline
        AFTER: 20       // Space after the underline before section content
      },
      UNDERLINE: {
        COLOR: '#ccc',
        WIDTH: 2
      }
    },
    // Configuration for move boxes
    MOVES: {
      HEIGHT: 100,           // Height of each move box
      SPACING: 15,           // Vertical space between move boxes
      SECTION_SPACING: 40,   // Space between different sections
      TITLE_OFFSET: 10,      // Space above the title
      FIRST_MOVE_OFFSET: 30, // Space after title before first move
      BACKGROUND: {
        COLOR: 'rgba(240, 240, 240, 0.8)'
      },
      BORDER: {
        COLOR: '#ddd',
        WIDTH: 1
      },
      // Font settings for move names and stats
      FONT: {
        NAME: {
          FAMILY: 'Arial, sans-serif',
          WEIGHT: 'bold',
          SIZE: 28,
          COLOR: 'black',
          OFFSET_X: 15,      // Left padding for move name
          OFFSET_Y: 30       // Top padding for move name from moveY
        },
        STATS: {
          FAMILY: 'Arial, sans-serif',
          WEIGHT: 'normal',
          SIZE: 22,
          COLOR: 'black',
          OFFSET_X: 12,      // Left padding for stats
          OFFSET_Y: 60,      // Vertical position of stats from moveY
          SPACING: 10        // Horizontal spacing between stats
        },
        RARITY: {
          FAMILY: 'Arial, sans-serif',
          WEIGHT: 'normal',
          SIZE: 35,
          COLOR: 'gold',
          OFFSET_X: 30,      // Right padding for rarity stars
          OFFSET_Y: 70       // Vertical position of rarity from moveY
        }
      },
      // Configuration for element type images
      ELEMENT_IMAGE: {
        HEIGHT: 400,         // Height of element type image
        OFFSET_X: 20,        // Right padding from card edge
        OFFSET_Y: 150,       // Additional vertical offset for positioning
        FALLBACK: {          // Fallback badge when image is not available
          WIDTH: 80,
          HEIGHT: 25,
          OFFSET_X: 120,     // Right padding from card edge
          OFFSET_Y: 10,      // Top padding from moveY
          FONT: {
            FAMILY: 'Arial, sans-serif',
            WEIGHT: 'bold',
            SIZE: 16,
            COLOR: 'white'
          },
          TEXT_OFFSET_X: 80, // Center position of text
          TEXT_OFFSET_Y: 27  // Vertical position of text from moveY
        }
      },
      // Stat icons and display configuration
      STATS: {
        ICONS: {
          count: 'X',
          speed: '⚡',
          health: '❤️',
          defense: '🛡️',
          attack: '⚔️',
          damage: '💥'
        },
        LAYOUT: {
          GRID: {
            ROWS: 2,
            COLS: 3,
            WIDTH: 85,         // Increased cell width
            HEIGHT: 30,        // Increased cell height
            START_Y: 40,       // Moved up from 55 to 40
            START_X: 15,       // Starting X position from expandedAreaX
            X_GAP: 0,          // Removed gap between cells horizontally
            Y_GAP: 0,          // Removed gap between cells vertically
            INNER_PADDING: 3   // Added minimal inner padding
          },
          BACKGROUND: {
            COLOR: 'rgba(240, 240, 240, 0.9)',
            BORDER_COLOR: 'rgba(180, 180, 180, 0.9)',
            BORDER_WIDTH: 1,
            RADIUS: 0          // Removed rounded corners since cells are touching
          },
          FONT: {
            FAMILY: 'Arial, sans-serif',
            WEIGHT: 'bold',
            SIZE: 20,
            COLOR: 'black'
          }
        }
      }
    },
    // Inventory section configuration
    INVENTORY: {
      TITLE_OFFSET: 10,      // Space above the title
      SECTION_SPACING: 20,   // Space between different sections
      ITEM_HEIGHT: 70,       // Height of each item slot
      ITEM_WIDTH: 70,        // Width of each item slot
      ITEM_SPACING: 20,      // Horizontal spacing between item slots
      ITEM_START_Y: 30,      // Vertical spacing after the title
      FONT: {
        NAME: {
          FAMILY: 'Arial, sans-serif',
          WEIGHT: 'bold',
          SIZE: 18,
          COLOR: 'black'
        }
      },
      SLOT: {
        BACKGROUND: {
          COLOR: 'rgba(230, 230, 230, 0.9)',
          BORDER_COLOR: 'rgba(180, 180, 180, 0.9)',
          BORDER_WIDTH: 2
        },
        EMPTY_TEXT: {
          LABEL: "Empty",
          FONT: {
            FAMILY: 'Arial, sans-serif',
            WEIGHT: 'normal',
            SIZE: 14,
            COLOR: '#888'
          }
        }
      }
    }
  }
} as const;

const CardImages = {
  air:{
    backgrounds: "S9ME1vtSmYqS8v5ygzX5CMpvYYVZ-nsV1kselavUDeM",
    cardframe: "AsRyajmJKrIFvmc6k3H-GKYveWb1TDvgIPg7HVH1B9k",
    elementtypes: "FwbLZYa0r0twYUvkP8su81L7yMhvs4EPkulUEm1X52U",
    level: "Bnvgn5yi9_6iRsRlKD9rhQvH5i0XhXvEeDTKu3LhJOI"
  },
  rock:{
    backgrounds: "arPti-7FScNGuPAzcaypGYv_aKk6v5Xk2TBbSeTq9Vc",
    cardframe: "m1GudORk0Q_46kkF0Z_SYvP9EVz3r9EvDMckn7XmwgA",
    elementtypes: "b2pyHeYmaHkE4pzCqIGoqVzjrkXSA71pVruHY9wbv10",
    level: "whQ3nCw8fNrO3gPCSlBOTOlQ2WmLBZH3FeSogwtXmFg"
  },
  fire:{
    backgrounds: "_c3YdO2buD9WYhjst7XiaNRu5CsJ2_dZtSGISB_naQs",
    cardframe: "leecHc-g-zitMPrrMuO_P22ovyFc9OjW3u_F2rFkmSM",
    elementtypes: "1TMMbDFfPFuU60wNZVMN8mlI1c9J-7XPg7T_14SP480",
    level: "qlKFPHcG5xCWkrcFNeHGdKVv4qGS4NyTPOT-CYkmVsY"
  },
  water:{
    backgrounds: "cHmLdp4ozWmhMfnjhGe5noaMB7Jl9ieSg2cGnkovb7Y",
    cardframe: "ts_msM47WJdKVkDphg3TwKgwi_r0Cx6N10qxa8cHhbo",
    elementtypes: "MvwTMcUOAClFOUrQG_BONbuVLCUuzzu2ep_0KXo03lA",
    level: "k8qbJykA3KTUrLQ_O2TraH_LkJWlbGwOwYZs-E-bIjU"
  },
  heal:{
    backgrounds: "cHmLdp4ozWmhMfnjhGe5noaMB7Jl9ieSg2cGnkovb7Y",
    cardframe: "ts_msM47WJdKVkDphg3TwKgwi_r0Cx6N10qxa8cHhbo",
    elementtypes: "FwbLZYa0r0twYUvkP8su81L7yMhvs4EPkulUEm1X52U",
    level: "k8qbJykA3KTUrLQ_O2TraH_LkJWlbGwOwYZs-E-bIjU"
  },
  boost:{
    backgrounds: "cHmLdp4ozWmhMfnjhGe5noaMB7Jl9ieSg2cGnkovb7Y",
    cardframe: "ts_msM47WJdKVkDphg3TwKgwi_r0Cx6N10qxa8cHhbo",
    elementtypes: "MvwTMcUOAClFOUrQG_BONbuVLCUuzzu2ep_0KXo03lA",
    level: "k8qbJykA3KTUrLQ_O2TraH_LkJWlbGwOwYZs-E-bIjU"
  },
  normal:{
    backgrounds: "cHmLdp4ozWmhMfnjhGe5noaMB7Jl9ieSg2cGnkovb7Y",
    cardframe: "ts_msM47WJdKVkDphg3TwKgwi_r0Cx6N10qxa8cHhbo",
    elementtypes: "MvwTMcUOAClFOUrQG_BONbuVLCUuzzu2ep_0KXo03lA",
    level: "k8qbJykA3KTUrLQ_O2TraH_LkJWlbGwOwYZs-E-bIjU"
  },
}

interface MonsterCardDisplayProps {
  monster: MonsterStats;
  className?: string;
  expanded?: boolean;
  inventoryItems?: InventoryItem[]; // Array of inventory items to display in the slots
}

interface InventoryItem {
  id: string;
  name: string;
  imageUrl?: string;
  rarity?: string; // common, uncommon, rare, epic, legendary
  description?: string;
}

export const MonsterCardDisplay: React.FC<MonsterCardDisplayProps> = ({ monster, className = '', expanded = false, inventoryItems = [] }) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const theme = currentTheme(false); // Default to light theme for card expanded section

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsZoomed(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsZoomed(false);
  }, []);

  // Get element-specific images
  const elementType = monster.elementType?.toLowerCase() as keyof typeof CARD_LAYOUT.ELEMENT_IMAGES || 'air';
  const elementImages = CARD_LAYOUT.ELEMENT_IMAGES[elementType];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cardImage, setCardImage] = useState<string | null>(null);

  const renderToCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions - adjust width if expanded
    const cardWidth = expanded ? CARD.DIMENSIONS.HEIGHT : CARD.DIMENSIONS.WIDTH; // Make width equal to height (1065) when expanded
    const cardHeight = CARD.DIMENSIONS.HEIGHT;
    
    canvas.width = cardWidth;
    canvas.height = cardHeight;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If expanded, fill the entire canvas with white first
    if (expanded) {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Load and draw images in order
    const loadImage = (src: string): Promise<HTMLImageElement> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.src = src;
      });
    };

    try {
      // Prepare all image loading promises
      const imagePromises = [
        // Background
        loadImage(`${Gateway}${CardImages[elementType].backgrounds}`),
        // Frame
        loadImage(`${Gateway}${CardImages[elementType].cardframe}`),
        // Element Type
        loadImage(`${Gateway}${CardImages[elementType].elementtypes}`),
        // Level Image
        loadImage(`${Gateway}${CardImages[elementType].level}`),
      ];

      // Add monster image if available
      if (monster.image) {
        imagePromises.push(loadImage(`${Gateway}${monster.image}`));
      }

      // Load all images in parallel
      const [
        bgImg,
        frameImg,
        elementImg,
        levelImg,
        monsterImg
      ] = await Promise.all(imagePromises);

      // Set up original card area - either full canvas or left portion if expanded
      const originalCardWidth = CARD.DIMENSIONS.WIDTH;
      
      // Draw background
      ctx.drawImage(bgImg, 0, 0, originalCardWidth, cardHeight);
      // Draw frame
      ctx.drawImage(frameImg, 0, 0, originalCardWidth, cardHeight);
      // Draw element type
      ctx.drawImage(elementImg, 0, 0, originalCardWidth, cardHeight);
      // Draw level image
      ctx.drawImage(levelImg, 0, 0, originalCardWidth, cardHeight);

      // Draw level text
      ctx.font = `${CARD.LEVEL.FONT.WEIGHT} ${Math.floor(canvas.height * CARD.LEVEL.FONT.SIZE_RATIO)}px ${CARD.LEVEL.FONT.FAMILY}`;
      ctx.fillStyle = CARD.LEVEL.FONT.COLOR;
      ctx.textAlign = 'center';
      const levelX = originalCardWidth * CARD.LEVEL.POSITION.LEFT_RATIO + CARD.LEVEL.POSITION.OFFSET_X;
      const levelY = canvas.height * CARD.LEVEL.POSITION.TOP_RATIO + CARD.LEVEL.POSITION.OFFSET_Y;
      ctx.fillText(`Lv.${monster.level}`, levelX, levelY);

      // Draw monster image if available
      if (monsterImg) {
        const scale = Math.min(
          CARD.MONSTER.TARGET_SIZE.WIDTH / monsterImg.width,
          CARD.MONSTER.TARGET_SIZE.HEIGHT / monsterImg.height
        );
        const scaledWidth = monsterImg.width * scale;
        const scaledHeight = monsterImg.height * scale;
        
        const monsterX = CARD.MONSTER.POSITION.CENTER ? (originalCardWidth - scaledWidth) / 2 : 0;
        const monsterY = canvas.height * CARD.MONSTER.POSITION.TOP_RATIO;
        
        ctx.drawImage(monsterImg, monsterX, monsterY, scaledWidth, scaledHeight);
      }

      // Draw stats
      ctx.font = `${CARD.STATS.FONT.WEIGHT} ${Math.floor(canvas.height * CARD.STATS.FONT.SIZE_RATIO)}px ${CARD.STATS.FONT.FAMILY}`;
      ctx.fillStyle = CARD.STATS.FONT.COLOR;
      ctx.textAlign = 'left';
      
      const statsY = canvas.height * CARD.STATS.POSITION.TOP_RATIO + CARD.STATS.POSITION.OFFSET_Y;
      const statsX = originalCardWidth * CARD.STATS.POSITION.START_X_RATIO;
      const spacing = originalCardWidth * CARD.STATS.POSITION.SPACING_RATIO;
      
      const stats = [monster.attack, monster.speed, monster.defense, monster.health];
      stats.forEach((stat, index) => {
        const x = statsX + (spacing * index);
        ctx.fillText(stat.toString(), x, statsY);
      });

      // Draw monster name text
      ctx.font = `${CARD.NAME.FONT.WEIGHT} ${Math.floor(canvas.height * CARD.NAME.FONT.SIZE_RATIO)}px ${CARD.NAME.FONT.FAMILY}`;
      ctx.fillStyle = CARD.NAME.FONT.COLOR;
      ctx.textAlign = 'center';
      const nameX = originalCardWidth / 2;
      const nameY = canvas.height * CARD.NAME.POSITION.TOP_RATIO;
      ctx.fillText(monster.name || 'Unknown Monster', nameX, nameY);

      // If expanded, draw moves in the expanded white space
      if (expanded) {
        // Draw the card details in the expanded section
        const expandedAreaX = originalCardWidth + 10; // 10px gap between card and expanded area
        const expandedAreaY = 0;
        const expandedAreaWidth = CARD.EXPANDED.WIDTH;
        const expandedAreaHeight = canvas.height;
        
        // Constants for positioning moves
        const moveHeight = CARD.EXPANDED.MOVES.HEIGHT; // Height of each move box
        const moveSpacing = CARD.EXPANDED.MOVES.SPACING; // Vertical space between move boxes
        const sectionSpacing = CARD.EXPANDED.MOVES.SECTION_SPACING; // Space between sections

        // 1. Start Drawing the Moves section
        // Add some extra spacing before the first section title
        let currentY = expandedAreaY + CARD.EXPANDED.PADDING.TOP;
        
        // Draw "Moves" title
        const movesTitleY = currentY;
        ctx.font = `${CARD.EXPANDED.SECTION_TITLE.FONT.WEIGHT} ${CARD.EXPANDED.SECTION_TITLE.FONT.SIZE}px ${CARD.EXPANDED.SECTION_TITLE.FONT.FAMILY}`;
        ctx.fillStyle = CARD.EXPANDED.SECTION_TITLE.FONT.COLOR;
        ctx.textAlign = 'left';
        ctx.fillText('Moves', expandedAreaX, movesTitleY);
        
        // Draw underline below the title
        const movesUnderlineY = movesTitleY + CARD.EXPANDED.SECTION_TITLE.SPACING.BOTTOM;
        ctx.beginPath();
        ctx.moveTo(expandedAreaX, movesUnderlineY);
        ctx.lineTo(expandedAreaX + expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT, movesUnderlineY);
        ctx.strokeStyle = CARD.EXPANDED.SECTION_TITLE.UNDERLINE.COLOR;
        ctx.lineWidth = CARD.EXPANDED.SECTION_TITLE.UNDERLINE.WIDTH;
        ctx.stroke();
        
        // Calculate starting Y position for moves content
        const movesContentY = movesUnderlineY + CARD.EXPANDED.SECTION_TITLE.SPACING.AFTER;
        
        let moveY = movesContentY;
        
        // Load move type images in advance to ensure they're ready when needed
        // Create a map of valid move types to their corresponding images
        const moveTypeImages: Record<string, HTMLImageElement> = {};
        const validMoveTypes = Object.keys(CardImages);
        
        // Create an array of move types that need to be loaded
        const moveTypes = Object.values(monster.moves || {})
          .map(move => move.type?.toLowerCase() || 'normal')
          .filter(type => validMoveTypes.includes(type));
        
        // Load images for all valid move types found in the monster's moves
        await Promise.all(moveTypes.map(async (type) => {
          try {
            if (CardImages[type as keyof typeof CardImages]) {
              const img = await loadImage(`${Gateway}${CardImages[type as keyof typeof CardImages].elementtypes}`);
              moveTypeImages[type] = img;
            }
          } catch (err) {
            console.error(`Failed to load image for type: ${type}`, err);
          }
        }));
        
        // Draw each move in a vertical list
        const moveEntries = Object.entries(monster.moves || {});
        moveEntries.forEach(([name, moveData], index) => {
          moveY = movesContentY + (index * (moveHeight + moveSpacing)) + CARD.EXPANDED.MOVES.FIRST_MOVE_OFFSET;
          
          // Draw move background
          ctx.fillStyle = CARD.EXPANDED.MOVES.BACKGROUND.COLOR;
          ctx.fillRect(expandedAreaX, moveY, expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT, moveHeight);
          
          // Draw move border
          ctx.strokeStyle = CARD.EXPANDED.MOVES.BORDER.COLOR;
          ctx.lineWidth = CARD.EXPANDED.MOVES.BORDER.WIDTH;
          ctx.strokeRect(expandedAreaX, moveY, expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT, moveHeight);
          
          // Draw move name
          ctx.font = `${CARD.EXPANDED.MOVES.FONT.NAME.WEIGHT} ${CARD.EXPANDED.MOVES.FONT.NAME.SIZE}px ${CARD.EXPANDED.MOVES.FONT.NAME.FAMILY}`;
          ctx.fillStyle = CARD.EXPANDED.MOVES.FONT.NAME.COLOR;
          ctx.textAlign = 'left';
          ctx.fillText(name, expandedAreaX + CARD.EXPANDED.MOVES.FONT.NAME.OFFSET_X, moveY + CARD.EXPANDED.MOVES.FONT.NAME.OFFSET_Y);
          
          // Draw move type image or fallback to colored badge
          const moveType = moveData.type?.toLowerCase() || 'normal';
          if (moveTypeImages[moveType]) {
            // Draw pre-loaded image - adjust dimensions to prevent stretching
            // Calculate proper aspect ratio for the element type image
            const img = moveTypeImages[moveType];
            const aspectRatio = img.width / img.height;
            const targetHeight = CARD.EXPANDED.MOVES.ELEMENT_IMAGE.HEIGHT; // 10x larger than previous 40
            const targetWidth = targetHeight * aspectRatio;
            
            // Position the image - moved down and slightly to the right
            // Add vertical offset to move down
            const imgY = moveY + (moveHeight - targetHeight) / 2 + CARD.EXPANDED.MOVES.ELEMENT_IMAGE.OFFSET_Y; 
            // Position the image more to the right
            const imgX = expandedAreaX + expandedAreaWidth - targetWidth - CARD.EXPANDED.MOVES.ELEMENT_IMAGE.OFFSET_X; 
            
            ctx.drawImage(img, imgX, imgY, targetWidth, targetHeight);
          } else {
            // Fallback to colored badge if element type image not available
            ctx.fillStyle = getTypeColor(moveType);
            ctx.fillRect(expandedAreaX + expandedAreaWidth - CARD.EXPANDED.MOVES.ELEMENT_IMAGE.FALLBACK.WIDTH - CARD.EXPANDED.MOVES.ELEMENT_IMAGE.OFFSET_X, moveY + CARD.EXPANDED.MOVES.ELEMENT_IMAGE.FALLBACK.OFFSET_Y, CARD.EXPANDED.MOVES.ELEMENT_IMAGE.FALLBACK.WIDTH, CARD.EXPANDED.MOVES.ELEMENT_IMAGE.FALLBACK.HEIGHT);
            
            ctx.font = `${CARD.EXPANDED.MOVES.ELEMENT_IMAGE.FALLBACK.FONT.WEIGHT} ${CARD.EXPANDED.MOVES.ELEMENT_IMAGE.FALLBACK.FONT.SIZE}px ${CARD.EXPANDED.MOVES.ELEMENT_IMAGE.FALLBACK.FONT.FAMILY}`;
            ctx.fillStyle = CARD.EXPANDED.MOVES.ELEMENT_IMAGE.FALLBACK.FONT.COLOR;
            ctx.textAlign = 'center';
            ctx.fillText(moveType.toUpperCase(), expandedAreaX + expandedAreaWidth - CARD.EXPANDED.MOVES.ELEMENT_IMAGE.FALLBACK.TEXT_OFFSET_X - CARD.EXPANDED.MOVES.ELEMENT_IMAGE.OFFSET_X, moveY + CARD.EXPANDED.MOVES.ELEMENT_IMAGE.FALLBACK.TEXT_OFFSET_Y);
          }
          
          // Draw move stats
          ctx.font = `${CARD.EXPANDED.MOVES.FONT.STATS.WEIGHT} ${CARD.EXPANDED.MOVES.FONT.STATS.SIZE}px ${CARD.EXPANDED.MOVES.FONT.STATS.FAMILY}`;
          ctx.fillStyle = CARD.EXPANDED.MOVES.FONT.STATS.COLOR;
          ctx.textAlign = 'left';
          
          // Define all stats that should be displayed
          const statIcons = CARD.EXPANDED.MOVES.STATS.ICONS;
          
          // Get the grid configuration
          const grid = CARD.EXPANDED.MOVES.STATS.LAYOUT.GRID;
          const background = CARD.EXPANDED.MOVES.STATS.LAYOUT.BACKGROUND;
          const statFont = CARD.EXPANDED.MOVES.STATS.LAYOUT.FONT;
          
          // Draw all stats in a grid layout
          let statIndex = 0;
          for (let row = 0; row < grid.ROWS; row++) {
            for (let col = 0; col < grid.COLS; col++) {
              const statName = Object.keys(statIcons)[statIndex];
              const icon = statIcons[statName as keyof typeof statIcons];
              
              // Calculate the position for this stat
              const statX = expandedAreaX + grid.START_X + col * (grid.WIDTH + grid.X_GAP);
              const statY = moveY + grid.START_Y + row * (grid.HEIGHT + grid.Y_GAP);
              
              // Get the stat value, defaulting to 0 if not present
              const value = moveData[statName as keyof typeof moveData] || 0;
              
              // Draw stat box background as a simple rectangle
              ctx.fillStyle = background.COLOR;
              ctx.fillRect(statX, statY, grid.WIDTH, grid.HEIGHT);
              
              // Draw stat box border
              ctx.strokeStyle = background.BORDER_COLOR;
              ctx.lineWidth = background.BORDER_WIDTH;
              ctx.strokeRect(statX, statY, grid.WIDTH, grid.HEIGHT);
              
              // Draw stat icon and value
              ctx.font = `${statFont.WEIGHT} ${statFont.SIZE}px ${statFont.FAMILY}`;
              ctx.fillStyle = statFont.COLOR;
              ctx.textAlign = 'left';
              
              // Format the stat value with + sign if positive
              const formattedValue = Number(value) > 0 ? `+${value}` : `${value}`;
              ctx.fillText(`${icon} ${formattedValue}`, statX + grid.INNER_PADDING, statY + grid.HEIGHT - grid.INNER_PADDING);
              
              statIndex++;
              if (statIndex >= Object.keys(statIcons).length) break;
            }
            if (statIndex >= Object.keys(statIcons).length) break;
          }
          
          // Draw rarity stars if available
          if ((moveData as any).rarity) {
            ctx.font = `bold 35px Arial, sans-serif`;
            ctx.fillStyle = 'gold';
            ctx.textAlign = 'right';
            ctx.fillText('★'.repeat((moveData as any).rarity), expandedAreaX + expandedAreaWidth - 30, moveY + 70);
          }
        });
        
        // Calculate ending Y position of the moves section
        const lastMoveY = movesContentY + (moveEntries.length * (moveHeight + moveSpacing)) + CARD.EXPANDED.MOVES.FIRST_MOVE_OFFSET;
        
        // 3. Draw "Status" section (for energy, happiness, experience bars)
        const statusTitleY = lastMoveY + sectionSpacing;
        ctx.font = `${CARD.EXPANDED.SECTION_TITLE.FONT.WEIGHT} ${CARD.EXPANDED.SECTION_TITLE.FONT.SIZE}px ${CARD.EXPANDED.SECTION_TITLE.FONT.FAMILY}`;
        ctx.fillStyle = CARD.EXPANDED.SECTION_TITLE.FONT.COLOR;
        ctx.textAlign = 'left';
        ctx.fillText('Status', expandedAreaX, statusTitleY);
        
        // Draw underline below the title
        const statusUnderlineY = statusTitleY + CARD.EXPANDED.SECTION_TITLE.SPACING.BOTTOM;
        ctx.beginPath();
        ctx.moveTo(expandedAreaX, statusUnderlineY);
        ctx.lineTo(expandedAreaX + expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT, statusUnderlineY);
        ctx.strokeStyle = CARD.EXPANDED.SECTION_TITLE.UNDERLINE.COLOR;
        ctx.lineWidth = CARD.EXPANDED.SECTION_TITLE.UNDERLINE.WIDTH;
        ctx.stroke();
        
        // Calculate starting Y position for status content
        const statusContentY = statusUnderlineY + CARD.EXPANDED.SECTION_TITLE.SPACING.AFTER;
        
        // Status bars
        let statusY = statusContentY;
        
        // Draw Energy Bar
        const drawStatusBar = (
          label: string, 
          current: number, 
          max: number, 
          color: string, 
          y: number, 
          valueText?: string
        ) => {
          // Draw label
          ctx.font = 'bold 18px Arial, sans-serif';
          ctx.fillStyle = 'black';
          ctx.textAlign = 'left';
          ctx.fillText(label, expandedAreaX, y);
          
          // Draw value text
          const text = valueText || `${current}/${max}`;
          ctx.textAlign = 'right';
          ctx.fillText(text, expandedAreaX + expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT, y);
          
          // Draw background bar
          ctx.fillStyle = 'rgba(230, 230, 230, 1)';
          ctx.fillRect(expandedAreaX, y + 10, expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT - 20, 30 / 2);
          
          // Draw progress bar
          ctx.fillStyle = color;
          const progressWidth = (current / max) * (expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT - 20);
          ctx.fillRect(expandedAreaX, y + 10, progressWidth, 30 / 2);
          
          // Draw border around bar
          ctx.strokeStyle = '#aaa';
          ctx.lineWidth = 1;
          ctx.strokeRect(expandedAreaX, y + 10, expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT - 20, 30 / 2);
        };
        
        drawStatusBar('Energy', monster.energy, 100, '#F59E0B', statusY); // Yellow
        statusY += 50;
        
        // Draw Happiness Bar
        drawStatusBar('Happiness', monster.happiness, 100, '#EC4899', statusY); // Pink
        statusY += 50;
        
        // Draw Experience Bar
        const expNeeded = getFibonacciExp(monster.level);
        drawStatusBar('Experience', monster.exp, expNeeded, '#3B82F6', statusY, `${monster.exp}/${expNeeded}`); // Blue
        statusY += 50;
        
        // Calculate starting Y position for inventory title
        const lastStatusY = statusY + 50; // Account for the last status bar
        const inventoryTitleY = lastStatusY + 60; // 60px gap between sections (same as between moves and status)
        
        // Draw "Inventory" title
        ctx.font = `${CARD.EXPANDED.SECTION_TITLE.FONT.WEIGHT} ${CARD.EXPANDED.SECTION_TITLE.FONT.SIZE}px ${CARD.EXPANDED.SECTION_TITLE.FONT.FAMILY}`;
        ctx.fillStyle = CARD.EXPANDED.SECTION_TITLE.FONT.COLOR;
        ctx.textAlign = 'left';
        ctx.fillText('Inventory', expandedAreaX, inventoryTitleY);
        
        // Draw a line under the title
        const inventoryUnderlineY = inventoryTitleY + CARD.EXPANDED.SECTION_TITLE.SPACING.BOTTOM;
        ctx.beginPath();
        ctx.moveTo(expandedAreaX, inventoryUnderlineY);
        ctx.lineTo(expandedAreaX + expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT, inventoryUnderlineY);
        ctx.strokeStyle = CARD.EXPANDED.SECTION_TITLE.UNDERLINE.COLOR;
        ctx.lineWidth = CARD.EXPANDED.SECTION_TITLE.UNDERLINE.WIDTH;
        ctx.stroke();
        
        // Calculate starting Y position for inventory content
        const inventoryContentY = inventoryUnderlineY + CARD.EXPANDED.SECTION_TITLE.SPACING.AFTER;
        
        // Draw inventory slots
        const inventoryY = inventoryContentY;
        const inventoryX = expandedAreaX;
        const slotWidth = Math.floor((expandedAreaWidth - CARD.EXPANDED.PADDING.RIGHT - (CARD.EXPANDED.INVENTORY.ITEM_SPACING * 2)) / 3);
        const inventoryHeight = CARD.EXPANDED.INVENTORY.ITEM_HEIGHT;
        
        // Get inventory items from props
        const items = inventoryItems;
        
        // Draw each inventory slot
        for (let i = 0; i < 3; i++) {
          const slotX = inventoryX + (i * (slotWidth + CARD.EXPANDED.INVENTORY.ITEM_SPACING));
          const slotY = inventoryY;
          const item = items[i];
          
          // Draw slot background
          ctx.fillStyle = CARD.EXPANDED.INVENTORY.SLOT.BACKGROUND.COLOR;
          ctx.fillRect(slotX, slotY, slotWidth, inventoryHeight);
          
          // Draw slot border
          ctx.strokeStyle = CARD.EXPANDED.INVENTORY.SLOT.BACKGROUND.BORDER_COLOR;
          ctx.lineWidth = CARD.EXPANDED.INVENTORY.SLOT.BACKGROUND.BORDER_WIDTH;
          ctx.strokeRect(slotX, slotY, slotWidth, inventoryHeight);
          
          if (item) {
            // Draw item name if available
            ctx.font = `${CARD.EXPANDED.INVENTORY.FONT.NAME.WEIGHT} ${CARD.EXPANDED.INVENTORY.FONT.NAME.SIZE}px ${CARD.EXPANDED.INVENTORY.FONT.NAME.FAMILY}`;
            ctx.fillStyle = CARD.EXPANDED.INVENTORY.FONT.NAME.COLOR;
            ctx.textAlign = 'center';
            
            // Truncate item name if too long
            let displayName = item.name;
            if (ctx.measureText(displayName).width > slotWidth - 10) {
              // Truncate and add ellipsis
              while (ctx.measureText(displayName + '...').width > slotWidth - 10 && displayName.length > 0) {
                displayName = displayName.slice(0, -1);
              }
              displayName += '...';
            }
            
            ctx.fillText(displayName, slotX + slotWidth/2, slotY + inventoryHeight/2 + 5);
            
            // If item has an image, draw it
            // This would require loading the image - implementing a placeholder here
            if (item.rarity) {
              // Add a small colored dot indicating rarity at top right of slot
              const rarityColors: {[key: string]: string} = {
                common: '#aaaaaa',
                uncommon: '#00cc00',
                rare: '#0066ff',
                epic: '#cc00ff',
                legendary: '#ffaa00'
              };
              
              const rarityColor = rarityColors[item.rarity.toLowerCase()] || rarityColors.common;
              ctx.fillStyle = rarityColor;
              ctx.beginPath();
              ctx.arc(slotX + slotWidth - 10, slotY + 10, 5, 0, Math.PI * 2);
              ctx.fill();
            }
          } else {
            // Draw empty text if no item
            ctx.font = `${CARD.EXPANDED.INVENTORY.SLOT.EMPTY_TEXT.FONT.WEIGHT} ${CARD.EXPANDED.INVENTORY.SLOT.EMPTY_TEXT.FONT.SIZE}px ${CARD.EXPANDED.INVENTORY.SLOT.EMPTY_TEXT.FONT.FAMILY}`;
            ctx.fillStyle = CARD.EXPANDED.INVENTORY.SLOT.EMPTY_TEXT.FONT.COLOR;
            ctx.textAlign = 'center';
            ctx.fillText(CARD.EXPANDED.INVENTORY.SLOT.EMPTY_TEXT.LABEL, slotX + slotWidth/2, slotY + inventoryHeight/2 + 5);
          }
        }
      }

      // Store the final image
      setCardImage(canvas.toDataURL('image/png'));
    } catch (error) {
      console.error('Error rendering card:', error);
    }
  };

  // Helper function to get color for move type
  const getTypeColor = (type: string): string => {
    const colors: Record<string, string> = {
      fire: '#FF4136',
      water: '#0074D9',
      air: '#7FDBFF',
      rock: '#B27D4B',
      normal: '#AAAAAA'
    };
    return colors[type.toLowerCase()] || colors.normal;
  };

  useEffect(() => {
    renderToCanvas();
  }, [monster, elementType]);

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

// Helper function to calculate Fibonacci sequence for experience needed
const getFibonacciExp = (level: number): number => {
  if (level <= 0) return 0;
  if (level === 1) return 5;
  if (level === 2) return 10;
  
  let a = 5, b = 10;
  for (let i = 3; i <= level; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
};

// Helper function to format remaining time
const formatTimeRemaining = (untilTime: number): string => {
  const now = Date.now();
  let remainingTime = Math.max(0, untilTime - now);
  
  const hours = Math.floor(remainingTime / (1000 * 60 * 60));
  remainingTime %= (1000 * 60 * 60);
  
  const minutes = Math.floor(remainingTime / (1000 * 60));
  remainingTime %= (1000 * 60);
  
  const seconds = Math.floor(remainingTime / 1000);
  
  return `${hours}h ${minutes}m ${seconds}s`;
};

// Helper function to calculate progress percentage
const calculateProgress = (since: number, until: number): number => {
  const now = Date.now();
  const total = until - since;
  const elapsed = now - since;
  
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
};