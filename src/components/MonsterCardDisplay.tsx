import React, { useState, useCallback, useEffect, useRef } from 'react';
import { MonsterStats } from '../utils/aoHelpers';
import { Gateway } from '../constants/Constants';
import { CARD_LAYOUT, CARD_ZOOM } from '../constants/CardLayout';

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
      WEIGHT: '900',
      SIZE_RATIO: 0.045,
      COLOR: 'white'
    },
    POSITION: {
      TOP_RATIO: 0.05,
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
}

export const MonsterCardDisplay: React.FC<MonsterCardDisplayProps> = ({ monster, className = '' }) => {
  const [isZoomed, setIsZoomed] = useState(false);

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

    // Set canvas dimensions
    canvas.width = CARD.DIMENSIONS.WIDTH;
    canvas.height = CARD.DIMENSIONS.HEIGHT;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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

      // Draw background
      ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
      // Draw frame
      ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
      // Draw element type
      ctx.drawImage(elementImg, 0, 0, canvas.width, canvas.height);
      // Draw level image
      ctx.drawImage(levelImg, 0, 0, canvas.width, canvas.height);

      // Draw level text
      ctx.font = `${CARD.LEVEL.FONT.WEIGHT} ${Math.floor(canvas.height * CARD.LEVEL.FONT.SIZE_RATIO)}px ${CARD.LEVEL.FONT.FAMILY}`;
      ctx.fillStyle = CARD.LEVEL.FONT.COLOR;
      ctx.textAlign = 'center';
      const levelX = canvas.width * CARD.LEVEL.POSITION.LEFT_RATIO + CARD.LEVEL.POSITION.OFFSET_X;
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
        
        const monsterX = CARD.MONSTER.POSITION.CENTER ? (canvas.width - scaledWidth) / 2 : 0;
        const monsterY = canvas.height * CARD.MONSTER.POSITION.TOP_RATIO;
        
        ctx.drawImage(monsterImg, monsterX, monsterY, scaledWidth, scaledHeight);
      }

      // Draw stats
      ctx.font = `${CARD.STATS.FONT.WEIGHT} ${Math.floor(canvas.height * CARD.STATS.FONT.SIZE_RATIO)}px ${CARD.STATS.FONT.FAMILY}`;
      ctx.fillStyle = CARD.STATS.FONT.COLOR;
      ctx.textAlign = 'left';
      
      const statsY = canvas.height * CARD.STATS.POSITION.TOP_RATIO + CARD.STATS.POSITION.OFFSET_Y;
      const statsX = canvas.width * CARD.STATS.POSITION.START_X_RATIO;
      const spacing = canvas.width * CARD.STATS.POSITION.SPACING_RATIO;
      
      const stats = [monster.attack, monster.speed, monster.defense, monster.health];
      stats.forEach((stat, index) => {
        const x = statsX + (spacing * index);
        ctx.fillText(stat.toString(), x, statsY);
      });

      // Draw monster name text
      ctx.font = `${CARD.NAME.FONT.WEIGHT} ${Math.floor(canvas.height * CARD.NAME.FONT.SIZE_RATIO)}px ${CARD.NAME.FONT.FAMILY}`;
      ctx.fillStyle = CARD.NAME.FONT.COLOR;
      ctx.textAlign = 'center';
      const nameX = canvas.width / 2;
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
      const cellWidth = canvas.width * 0.4; // Each cell is 40% of card width
      const moveNameOffset = canvas.height * 0.035; // Increased space between name and stats
      const horizontalOffset = canvas.width * 0.1; // 10% offset from edges

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

      // Store the final image
      setCardImage(canvas.toDataURL('image/png'));
    } catch (error) {
      console.error('Error rendering card:', error);
    }
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
      className={`relative w-full aspect-[2.5/3.5] ${className}`}
      style={{
        transform: `scale(${scale})`,
        transition: `transform ${CARD_ZOOM.DURATION}`,
        transformOrigin: 'center center'
      }}
    >
      {/* Export Button - Commented out for now but keep for future use
      <button
        onClick={(e) => {
          e.stopPropagation();
          exportCard();
        }}
        className="absolute top-2 right-2 px-2 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors z-50"
      >
        Export
      </button>
      */}
      <canvas
        ref={canvasRef}
        className={isZoomed ? "hidden" : "w-full h-full"}
        style={{ 
          aspectRatio: CARD.DIMENSIONS.ASPECT_RATIO,
          objectFit: 'contain'
        }}
      />
      {isZoomed && cardImage && (
        <img
          src={cardImage}
          alt={monster.name || 'Monster Card'}
          className="w-full h-full object-contain"
        />
      )}
    </div>
  );

  if (isZoomed) {
    return (
      <div 
        className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 cursor-pointer"
        style={{ zIndex: CARD_ZOOM.Z_INDEX }}
        onClick={handleClose}
      >
        <div 
          className="max-w-[500px] w-full p-4"
          onClick={(e) => e.stopPropagation()}
        >
          {renderCard(1.5)}
        </div>
      </div>
    );
  }

  return (
    <div onClick={handleClick}>
      {renderCard()}
    </div>
  );
};
