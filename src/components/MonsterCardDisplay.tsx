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
      TOP_RATIO: 0.02,
      CENTER: true
    }
  },
  LEVEL: {
    FONT: {
      FAMILY: 'Arial, sans-serif',
      WEIGHT: '900',
      SIZE_RATIO: 0.03,
      COLOR: 'white'
    },
    POSITION: {
      LEFT_RATIO: 0.075,
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
}

interface MonsterCardDisplayProps {
  monster: MonsterStats;
  className?: string;
  expanded?: boolean;
}

export const MonsterCardDisplay: React.FC<MonsterCardDisplayProps> = ({ monster, className = '', expanded = false }) => {
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

      // Draw moves in 2x2 grid
      // Convert moves object to array to show all moves
      const moves = Object.entries(monster.moves || {}).map(([name, moveData]) => ({
        name,
        stats: {
          attack: moveData.attack,
          speed: moveData.speed,
          defense: moveData.defense,
          health: moveData.health
        }
      }));

      // Draw moves in 2x2 grid
      const moveStartY = canvas.height * 0.78; // Start at 78% from top
      const gridHeight = canvas.height * 0.18; // Grid takes up 18% of card height
      const cellHeight = gridHeight / 2; // Each cell is half of grid height
      const cellWidth = originalCardWidth * 0.4; // Each cell is 40% of card width
      const moveNameOffset = canvas.height * 0.035; // Increased space between name and stats
      const horizontalOffset = originalCardWidth * 0.1; // 10% offset from edges

      moves.forEach((move, index) => {
        const row = Math.floor(index / 2); // 0 for first row, 1 for second row
        const col = index % 2; // 0 for left column, 1 for right column
        
        // Center moves with adjusted spacing
        const x = horizontalOffset + (col * cellWidth) + (cellWidth / 2);
        const y = moveStartY + (row * cellHeight); // Top of cell + row offset

        // Draw move name
        ctx.font = `${CARD.MOVES.FONT.NAME.WEIGHT} ${Math.floor(canvas.height * CARD.MOVES.FONT.NAME.SIZE_RATIO)}px ${CARD.MOVES.FONT.NAME.FAMILY}`;
        ctx.fillStyle = CARD.MOVES.FONT.NAME.COLOR;
        ctx.textAlign = 'center';
        ctx.fillText(move.name, x, y);

        // Draw move stats with emojis
        ctx.font = `${CARD.MOVES.FONT.STATS.WEIGHT} ${Math.floor(canvas.height * CARD.MOVES.FONT.STATS.SIZE_RATIO)}px ${CARD.MOVES.FONT.STATS.FAMILY}`;
        ctx.fillStyle = CARD.MOVES.FONT.STATS.COLOR;
        
        const statEntries = Object.entries(move.stats).filter(([_, value]) => value && value > 0);
        const statsText = statEntries.map(([stat, value]) => `${CARD.MOVES.EMOJIS[stat as keyof typeof CARD.MOVES.EMOJIS]}${value}`).join(' ');
        
        ctx.fillText(statsText, x, y + moveNameOffset);
      });
      
      // If expanded, draw moves in the expanded white space
      if (expanded) {
        const expandedAreaX = originalCardWidth + 20; // Add some padding
        const expandedAreaY = 50; // Start a bit down from the top
        const moveHeight = 100; // Height for each move
        const moveSpacing = 15; // Space between moves
        const sectionSpacing = 40; // Space between sections
        
        // Draw "Moves" title
        ctx.font = `bold 36px Arial, sans-serif`;
        ctx.fillStyle = 'black';
        ctx.textAlign = 'left';
        ctx.fillText('Moves', expandedAreaX, expandedAreaY - 10);
        
        // Draw a line under the title
        ctx.beginPath();
        ctx.moveTo(expandedAreaX, expandedAreaY);
        ctx.lineTo(cardWidth - 20, expandedAreaY);
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Draw each move in a vertical list
        const moveEntries = Object.entries(monster.moves || {});
        moveEntries.forEach(([name, moveData], index) => {
          const moveY = expandedAreaY + (index * (moveHeight + moveSpacing)) + 30;
          
          // Draw move background
          ctx.fillStyle = 'rgba(240, 240, 240, 0.8)';
          ctx.fillRect(expandedAreaX, moveY, cardWidth - expandedAreaX - 20, moveHeight);
          
          // Draw move border
          ctx.strokeStyle = '#ddd';
          ctx.lineWidth = 1;
          ctx.strokeRect(expandedAreaX, moveY, cardWidth - expandedAreaX - 20, moveHeight);
          
          // Draw move name
          ctx.font = 'bold 24px Arial, sans-serif';
          ctx.fillStyle = 'black';
          ctx.textAlign = 'left';
          ctx.fillText(name, expandedAreaX + 15, moveY + 30);
          
          // Draw move type badge
          const moveType = moveData.type || 'normal';
          ctx.fillStyle = getTypeColor(moveType);
          ctx.fillRect(cardWidth - 120, moveY + 10, 80, 25);
          
          ctx.font = 'bold 16px Arial, sans-serif';
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.fillText(moveType.toUpperCase(), cardWidth - 80, moveY + 27);
          
          // Draw move stats
          ctx.font = '18px Arial, sans-serif';
          ctx.fillStyle = 'black';
          ctx.textAlign = 'left';
          
          const statIcons = {
            attack: '⚔️',
            speed: '⚡',
            defense: '🛡️',
            health: '❤️'
          };
          
          let statX = expandedAreaX + 15;
          const statY = moveY + 70;
          
          // Draw each stat that has a value
          Object.entries(statIcons).forEach(([stat, icon]) => {
            const value = moveData[stat as keyof typeof moveData];
            if (value && Number(value) !== 0) {
              const statText = `${icon} ${Number(value) > 0 ? '+' : ''}${value}`;
              ctx.fillText(statText, statX, statY);
              statX += ctx.measureText(statText).width + 20; // Add spacing between stats
            }
          });
          
          // Draw rarity stars if available
          if ((moveData as any).rarity) {
            const stars = '★'.repeat((moveData as any).rarity);
            ctx.font = '18px Arial, sans-serif';
            ctx.fillStyle = 'gold';
            ctx.textAlign = 'right';
            ctx.fillText(stars, cardWidth - 30, moveY + 70);
          }
        });
        
        // Calculate starting Y position for status bars - after the moves section
        const lastMoveY = expandedAreaY + (moveEntries.length * (moveHeight + moveSpacing)) + 30;
        let statusY = lastMoveY + sectionSpacing;
        
        // Draw "Status" title
        ctx.font = `bold 36px Arial, sans-serif`;
        ctx.fillStyle = 'black';
        ctx.textAlign = 'left';
        ctx.fillText('Status', expandedAreaX, statusY - 10);
        
        // Draw a line under the title
        ctx.beginPath();
        ctx.moveTo(expandedAreaX, statusY);
        ctx.lineTo(cardWidth - 20, statusY);
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        statusY += 30; // Move down for the first status bar
        const barWidth = cardWidth - expandedAreaX - 20;
        const barHeight = 30;
        const barSpacing = 50; // Space between status bars
        
        // Helper function to draw a status bar
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
          ctx.fillText(text, expandedAreaX + barWidth, y);
          
          // Draw background bar
          ctx.fillStyle = 'rgba(230, 230, 230, 1)';
          ctx.fillRect(expandedAreaX, y + 10, barWidth, barHeight / 2);
          
          // Draw progress bar
          ctx.fillStyle = color;
          const progressWidth = (current / max) * barWidth;
          ctx.fillRect(expandedAreaX, y + 10, progressWidth, barHeight / 2);
          
          // Draw border around bar
          ctx.strokeStyle = '#aaa';
          ctx.lineWidth = 1;
          ctx.strokeRect(expandedAreaX, y + 10, barWidth, barHeight / 2);
        };
        
        // Draw Energy Bar
        drawStatusBar('Energy', monster.energy, 100, '#F59E0B', statusY); // Yellow
        statusY += barSpacing;
        
        // Draw Happiness Bar
        drawStatusBar('Happiness', monster.happiness, 100, '#EC4899', statusY); // Pink
        statusY += barSpacing;
        
        // Draw Experience Bar
        const expNeeded = getFibonacciExp(monster.level);
        drawStatusBar('Experience', monster.exp, expNeeded, '#3B82F6', statusY, `${monster.exp}/${expNeeded}`); // Blue
        statusY += barSpacing;
        
        // Draw Status info if not at home
        if (monster.status.type !== 'Home') {
          ctx.font = 'bold 18px Arial, sans-serif';
          ctx.fillStyle = 'black';
          ctx.textAlign = 'left';
          ctx.fillText(`Status: ${monster.status.type}`, expandedAreaX, statusY);
          
          if (monster.status.until_time) {
            const timeRemaining = formatTimeRemaining(monster.status.until_time);
            ctx.textAlign = 'right';
            ctx.fillText(`Time remaining: ${timeRemaining}`, expandedAreaX + barWidth, statusY);
            
            // Draw progress bar
            statusY += 20;
            ctx.fillStyle = 'rgba(230, 230, 230, 1)';
            ctx.fillRect(expandedAreaX, statusY, barWidth, barHeight / 2);
            
            const progress = calculateProgress(monster.status.since, monster.status.until_time);
            ctx.fillStyle = '#60A5FA'; // Light blue
            const progressWidth = (progress / 100) * barWidth;
            ctx.fillRect(expandedAreaX, statusY, progressWidth, barHeight / 2);
            
            ctx.strokeStyle = '#aaa';
            ctx.lineWidth = 1;
            ctx.strokeRect(expandedAreaX, statusY, barWidth, barHeight / 2);
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