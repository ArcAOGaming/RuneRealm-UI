import { MonsterStats } from './aoHelpers';
import { InventoryItem } from '../constants/CardConfig';
import { Gateway } from '../constants/Constants';

// Helper function to shade a color (positive percent brightens, negative percent darkens)
export const shadeColor = (color: string, percent: number): string => {
  let R = parseInt(color.substring(1, 3), 16);
  let G = parseInt(color.substring(3, 5), 16);
  let B = parseInt(color.substring(5, 7), 16);

  R = Math.min(255, Math.max(0, R + (R * percent) / 100));
  G = Math.min(255, Math.max(0, G + (G * percent) / 100));
  B = Math.min(255, Math.max(0, B + (B * percent) / 100));

  const RR = Math.round(R).toString(16).padStart(2, '0');
  const GG = Math.round(G).toString(16).padStart(2, '0');
  const BB = Math.round(B).toString(16).padStart(2, '0');

  return `#${RR}${GG}${BB}`;
};

// Helper function to get color for move type
export const getTypeColor = (type: string): string => {
  const colors: Record<string, string> = {
    fire: '#FF4136',
    water: '#0074D9',
    air: '#7FDBFF',
    rock: '#B27D4B',
    normal: '#AAAAAA'
  };
  return colors[type.toLowerCase()] || colors.normal;
};

// Helper function to calculate Fibonacci sequence for experience needed
export const getFibonacciExp = (level: number): number => {
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
export const formatTimeRemaining = (untilTime: number): string => {
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
export const calculateProgress = (since: number, until: number): number => {
  const now = Date.now();
  const total = until - since;
  const elapsed = now - since;
  
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
};

// Load image helper
export const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.src = src;
  });
};

// Draw status bar helper
export const drawStatusBar = (
  ctx: CanvasRenderingContext2D,
  label: string, 
  current: number, 
  max: number, 
  color: string, 
  expandedAreaX: number,
  expandedAreaWidth: number,
  y: number,
  padding: {
    RIGHT: number;
  },
  titleWidth: number,
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
  ctx.fillText(text, expandedAreaX + expandedAreaWidth - padding.RIGHT, y);
  
  // Draw background bar with rounded corners (contained within overlay width)
  const barHeight = 15;
  const barY = y + 10;
  const barWidth = titleWidth - padding.RIGHT - 20;
  const radius = 4; // Rounded corners for the status bars
  
  // Create a background gradient
  const bgGradient = ctx.createLinearGradient(
    expandedAreaX, 
    barY, 
    expandedAreaX, 
    barY + barHeight
  );
  bgGradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
  bgGradient.addColorStop(1, 'rgba(240, 240, 240, 0.5)');
  ctx.fillStyle = bgGradient;
  
  // Draw rounded background bar
  ctx.beginPath();
  ctx.moveTo(expandedAreaX + radius, barY);
  ctx.lineTo(expandedAreaX + barWidth - radius, barY);
  ctx.arcTo(expandedAreaX + barWidth, barY, expandedAreaX + barWidth, barY + radius, radius);
  ctx.lineTo(expandedAreaX + barWidth, barY + barHeight - radius);
  ctx.arcTo(expandedAreaX + barWidth, barY + barHeight, expandedAreaX + barWidth - radius, barY + barHeight, radius);
  ctx.lineTo(expandedAreaX + radius, barY + barHeight);
  ctx.arcTo(expandedAreaX, barY + barHeight, expandedAreaX, barY + barHeight - radius, radius);
  ctx.lineTo(expandedAreaX, barY + radius);
  ctx.arcTo(expandedAreaX, barY, expandedAreaX + radius, barY, radius);
  ctx.closePath();
  ctx.fill();
  
  // Draw progress bar with gradient
  // Cap the visual progress at 100% while preserving the actual value for display
  const progressPercentage = Math.min(1, current / max);
  const progressWidth = progressPercentage * barWidth;
  
  // Only draw progress if there's actual progress
  if (progressWidth > 0) {
    // Create a progress gradient
    const progressGradient = ctx.createLinearGradient(
      expandedAreaX, 
      barY, 
      expandedAreaX, 
      barY + barHeight
    );
    progressGradient.addColorStop(0, color);
    progressGradient.addColorStop(1, shadeColor(color, -20)); // Darker shade at bottom
    ctx.fillStyle = progressGradient;
    
    // Draw rounded progress bar (only round the right side)
    ctx.beginPath();
    if (progressWidth >= barWidth - radius) {
      // If progress is near complete, use full rounded corners
      ctx.moveTo(expandedAreaX + radius, barY);
      ctx.lineTo(expandedAreaX + progressWidth - radius, barY);
      ctx.arcTo(expandedAreaX + progressWidth, barY, expandedAreaX + progressWidth, barY + radius, radius);
      ctx.lineTo(expandedAreaX + progressWidth, barY + barHeight - radius);
      ctx.arcTo(expandedAreaX + progressWidth, barY + barHeight, expandedAreaX + progressWidth - radius, barY + barHeight, radius);
    } else {
      // If progress is not complete, just clip at progress width
      ctx.moveTo(expandedAreaX, barY);
      ctx.lineTo(expandedAreaX + progressWidth, barY);
      ctx.lineTo(expandedAreaX + progressWidth, barY + barHeight);
    }
    ctx.lineTo(expandedAreaX + radius, barY + barHeight);
    ctx.arcTo(expandedAreaX, barY + barHeight, expandedAreaX, barY + barHeight - radius, radius);
    ctx.lineTo(expandedAreaX, barY + radius);
    ctx.arcTo(expandedAreaX, barY, expandedAreaX + radius, barY, radius);
    ctx.closePath();
    ctx.fill();
    
    // Add shine effect to progress bar
    ctx.beginPath();
    ctx.moveTo(expandedAreaX, barY);
    ctx.lineTo(expandedAreaX + progressWidth, barY);
    ctx.lineTo(expandedAreaX + progressWidth, barY + barHeight/3);
    ctx.lineTo(expandedAreaX, barY + barHeight/3);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fill();
  }
  
  // Draw border around bar
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(expandedAreaX + radius, barY);
  ctx.lineTo(expandedAreaX + barWidth - radius, barY);
  ctx.arcTo(expandedAreaX + barWidth, barY, expandedAreaX + barWidth, barY + radius, radius);
  ctx.lineTo(expandedAreaX + barWidth, barY + barHeight - radius);
  ctx.arcTo(expandedAreaX + barWidth, barY + barHeight, expandedAreaX + barWidth - radius, barY + barHeight, radius);
  ctx.lineTo(expandedAreaX + radius, barY + barHeight);
  ctx.arcTo(expandedAreaX, barY + barHeight, expandedAreaX, barY + barHeight - radius, radius);
  ctx.lineTo(expandedAreaX, barY + radius);
  ctx.arcTo(expandedAreaX, barY, expandedAreaX + radius, barY, radius);
  ctx.closePath();
  ctx.stroke();
};

// Draw section title and underline helper
export const drawSectionTitle = (
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
  ctx.fillText(title, expandedAreaX + padding.OVERLAY_LEFT, titleY);
  
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
      expandedAreaX, 
      underlineY, 
      expandedAreaX + expandedAreaWidth - padding.RIGHT, 
      underlineY
    );
    gradient.addColorStop(0, sectionTitleConfig.UNDERLINE.COLOR);
    gradient.addColorStop(0.5, '#9bc1ff'); // Lighter middle
    gradient.addColorStop(1, sectionTitleConfig.UNDERLINE.COLOR);
    
    ctx.strokeStyle = gradient;
  } else {
    ctx.strokeStyle = sectionTitleConfig.UNDERLINE.COLOR;
  }
  
  ctx.lineWidth = sectionTitleConfig.UNDERLINE.WIDTH;
  // Use the full width for content to match the full width overlay
  
  ctx.beginPath();
  ctx.moveTo(expandedAreaX, underlineY);
  ctx.lineTo(titleX + titleWidth - padding.RIGHT, underlineY);
  ctx.stroke();
  
  return underlineY + sectionTitleConfig.SPACING.AFTER;
};

// Draw inventory slots helper
export const drawInventorySlots = (
  ctx: CanvasRenderingContext2D,
  inventoryItems: InventoryItem[],
  inventoryY: number,
  inventoryX: number,
  titleWidth: number,
  padding: {
    RIGHT: number;
  },
  expandedAreaX: number,
  expandedAreaWidth: number,
  inventoryConfig: any
) => {
  const slotWidth = Math.floor((titleWidth - padding.RIGHT - (inventoryConfig.ITEM_SPACING * 2)) / 3);
  const inventoryHeight = inventoryConfig.ITEM_HEIGHT;
  
  // Draw each inventory slot
  for (let i = 0; i < 3; i++) {
    const slotX = inventoryX + (i * (slotWidth + inventoryConfig.ITEM_SPACING));
    const slotY = inventoryY;
    const item = inventoryItems[i];
    
    // Add shadow to the inventory slots
    ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    
    // Draw slot background with rounded corners
    ctx.fillStyle = inventoryConfig.SLOT.BACKGROUND.COLOR;
    const radius = 5; // Rounded corners for inventory slots
    
    ctx.beginPath();
    ctx.moveTo(slotX + radius, slotY);
    ctx.lineTo(slotX + slotWidth - radius, slotY);
    ctx.arcTo(slotX + slotWidth, slotY, slotX + slotWidth, slotY + radius, radius);
    ctx.lineTo(slotX + slotWidth, slotY + inventoryHeight - radius);
    ctx.arcTo(slotX + slotWidth, slotY + inventoryHeight, slotX + slotWidth - radius, slotY + inventoryHeight, radius);
    ctx.lineTo(slotX + radius, slotY + inventoryHeight);
    ctx.arcTo(slotX, slotY + inventoryHeight, slotX, slotY + inventoryHeight - radius, radius);
    ctx.lineTo(slotX, slotY + radius);
    ctx.arcTo(slotX, slotY, slotX + radius, slotY, radius);
    ctx.closePath();
    ctx.fill();
    
    // Draw slot border
    ctx.strokeStyle = inventoryConfig.SLOT.BACKGROUND.BORDER_COLOR;
    ctx.lineWidth = inventoryConfig.SLOT.BACKGROUND.BORDER_WIDTH;
    ctx.stroke();
    
    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    if (item) {
      // Draw item name if available
      ctx.font = `${inventoryConfig.FONT.NAME.WEIGHT} ${inventoryConfig.FONT.NAME.SIZE}px ${inventoryConfig.FONT.NAME.FAMILY}`;
      ctx.fillStyle = inventoryConfig.FONT.NAME.COLOR;
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
        
        // Draw a glowing rarity indicator
        ctx.shadowColor = rarityColor;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(slotX + slotWidth - 10, slotY + 10, 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }
    } else {
      // Draw empty text if no item
      ctx.font = `${inventoryConfig.SLOT.EMPTY_TEXT.FONT.WEIGHT} ${inventoryConfig.SLOT.EMPTY_TEXT.FONT.SIZE}px ${inventoryConfig.SLOT.EMPTY_TEXT.FONT.FAMILY}`;
      ctx.fillStyle = inventoryConfig.SLOT.EMPTY_TEXT.FONT.COLOR;
      ctx.textAlign = 'center';
      ctx.fillText(inventoryConfig.SLOT.EMPTY_TEXT.LABEL, slotX + slotWidth/2, slotY + inventoryHeight/2 + 5);
    }
  }
};

// Draw move section helper
export const drawMoves = (
  ctx: CanvasRenderingContext2D,
  monster: MonsterStats,
  expandedAreaX: number,
  expandedAreaWidth: number,
  movesContentY: number,
  titleX: number,
  titleWidth: number,
  padding: {
    RIGHT: number;
  },
  moveConfig: any,
  moveTypeImages: Record<string, HTMLImageElement>
) => {
  const moveHeight = moveConfig.HEIGHT;
  const moveSpacing = moveConfig.SPACING;
  
  // Draw each move in a vertical list
  const moveEntries = Object.entries(monster.moves || {});
  moveEntries.forEach(([name, moveData], index) => {
    const moveY = movesContentY + (index * (moveHeight + moveSpacing)) + moveConfig.FIRST_MOVE_OFFSET;
    
    // Apply shadow if specified
    if (moveConfig.SHADOW) {
      ctx.shadowColor = moveConfig.SHADOW.COLOR;
      ctx.shadowBlur = moveConfig.SHADOW.BLUR;
      ctx.shadowOffsetX = moveConfig.SHADOW.OFFSET_X;
      ctx.shadowOffsetY = moveConfig.SHADOW.OFFSET_Y;
    }
    
    // Draw move background with rounded corners if specified
    ctx.fillStyle = moveConfig.BACKGROUND.COLOR;
    
    if (moveConfig.BORDER.RADIUS > 0) {
      // Draw rounded rectangle
      const radius = moveConfig.BORDER.RADIUS;
      const moveBoxX = titleX;
      const moveBoxWidth = titleWidth - padding.RIGHT;
      
      ctx.beginPath();
      ctx.moveTo(moveBoxX + radius, moveY);
      ctx.lineTo(moveBoxX + moveBoxWidth - radius, moveY);
      ctx.arcTo(moveBoxX + moveBoxWidth, moveY, moveBoxX + moveBoxWidth, moveY + radius, radius);
      ctx.lineTo(moveBoxX + moveBoxWidth, moveY + moveHeight - radius);
      ctx.arcTo(moveBoxX + moveBoxWidth, moveY + moveHeight, moveBoxX + moveBoxWidth - radius, moveY + moveHeight, radius);
      ctx.lineTo(moveBoxX + radius, moveY + moveHeight);
      ctx.arcTo(moveBoxX, moveY + moveHeight, moveBoxX, moveY + moveHeight - radius, radius);
      ctx.lineTo(moveBoxX, moveY + radius);
      ctx.arcTo(moveBoxX, moveY, moveBoxX + radius, moveY, radius);
      ctx.closePath();
      
      ctx.fill();
      
      // Draw move border
      ctx.strokeStyle = moveConfig.BORDER.COLOR;
      ctx.lineWidth = moveConfig.BORDER.WIDTH;
      ctx.stroke();
    } else {
      // Draw regular rectangle (matching the overlay width)
      ctx.fillRect(titleX, moveY, titleWidth - padding.RIGHT, moveHeight);
      
      // Draw move border
      ctx.strokeStyle = moveConfig.BORDER.COLOR;
      ctx.lineWidth = moveConfig.BORDER.WIDTH;
      ctx.strokeRect(titleX, moveY, titleWidth - padding.RIGHT, moveHeight);
    }
    
    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Draw move name (within the narrower container)
    ctx.font = `${moveConfig.FONT.NAME.WEIGHT} ${moveConfig.FONT.NAME.SIZE}px ${moveConfig.FONT.NAME.FAMILY}`;
    ctx.fillStyle = moveConfig.FONT.NAME.COLOR;
    ctx.textAlign = 'left';
    ctx.fillText(name, titleX + moveConfig.FONT.NAME.OFFSET_X, moveY + moveConfig.FONT.NAME.OFFSET_Y);
    
    // Draw move type image or fallback to colored badge
    const moveType = moveData.type?.toLowerCase() || 'normal';
    if (moveTypeImages[moveType]) {
      // Draw pre-loaded image - adjust dimensions to prevent stretching
      // Calculate proper aspect ratio for the element type image
      const img = moveTypeImages[moveType];
      const aspectRatio = img.width / img.height;
      const targetHeight = moveConfig.ELEMENT_IMAGE.HEIGHT;
      const targetWidth = targetHeight * aspectRatio;
      
      // Position the image
      const imgY = moveY + (moveHeight - targetHeight) / 2 + moveConfig.ELEMENT_IMAGE.OFFSET_Y; 
      const imgX = expandedAreaX + expandedAreaWidth - targetWidth - moveConfig.ELEMENT_IMAGE.OFFSET_X; 
      
      ctx.drawImage(img, imgX, imgY, targetWidth, targetHeight);
    } else {
      // Fallback to colored badge if element type image not available
      ctx.fillStyle = getTypeColor(moveType);
      ctx.fillRect(
        expandedAreaX + expandedAreaWidth - moveConfig.ELEMENT_IMAGE.FALLBACK.WIDTH - moveConfig.ELEMENT_IMAGE.OFFSET_X, 
        moveY + moveConfig.ELEMENT_IMAGE.FALLBACK.OFFSET_Y, 
        moveConfig.ELEMENT_IMAGE.FALLBACK.WIDTH, 
        moveConfig.ELEMENT_IMAGE.FALLBACK.HEIGHT
      );
      
      ctx.font = `${moveConfig.ELEMENT_IMAGE.FALLBACK.FONT.WEIGHT} ${moveConfig.ELEMENT_IMAGE.FALLBACK.FONT.SIZE}px ${moveConfig.ELEMENT_IMAGE.FALLBACK.FONT.FAMILY}`;
      ctx.fillStyle = moveConfig.ELEMENT_IMAGE.FALLBACK.FONT.COLOR;
      ctx.textAlign = 'center';
      ctx.fillText(
        moveType.toUpperCase(), 
        expandedAreaX + expandedAreaWidth - moveConfig.ELEMENT_IMAGE.FALLBACK.TEXT_OFFSET_X - moveConfig.ELEMENT_IMAGE.OFFSET_X, 
        moveY + moveConfig.ELEMENT_IMAGE.FALLBACK.TEXT_OFFSET_Y
      );
    }
    
    // Draw move stats
    ctx.font = `${moveConfig.FONT.STATS.WEIGHT} ${moveConfig.FONT.STATS.SIZE}px ${moveConfig.FONT.STATS.FAMILY}`;
    ctx.fillStyle = moveConfig.FONT.STATS.COLOR;
    ctx.textAlign = 'left';
    
    // Define all stats that should be displayed
    const statIcons = moveConfig.STATS.ICONS;
    
    // Get the grid configuration
    const grid = moveConfig.STATS.LAYOUT.GRID;
    const background = moveConfig.STATS.LAYOUT.BACKGROUND;
    const statFont = moveConfig.STATS.LAYOUT.FONT;
    
    // Draw all stats in a grid layout
    let statIndex = 0;
    for (let row = 0; row < grid.ROWS; row++) {
      for (let col = 0; col < grid.COLS; col++) {
        const statName = Object.keys(statIcons)[statIndex];
        const icon = statIcons[statName as keyof typeof statIcons];
        
        // Calculate the position for this stat (aligned with narrower move box)
        const statX = titleX + grid.START_X + col * (grid.WIDTH + grid.X_GAP);
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
  
  // Return the Y position after the last move
  return movesContentY + (moveEntries.length * (moveHeight + moveSpacing)) + moveConfig.FIRST_MOVE_OFFSET;
};

// Load images for card
export const loadCardImages = async (elementType: string, monster: MonsterStats, expanded: boolean, CardImages: any) => {
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

  // Add side image if expanded
  if (expanded) {
    imagePromises.push(loadImage(`${Gateway}${CardImages[elementType].side}`));
  }

  // Add monster image if available
  if (monster.image) {
    imagePromises.push(loadImage(`${Gateway}${monster.image}`));
  }

  // Load all images in parallel
  const images = await Promise.all(imagePromises);
  
  const result: {
    bgImg: HTMLImageElement;
    frameImg: HTMLImageElement;
    elementImg: HTMLImageElement;
    levelImg: HTMLImageElement;
    sideImg?: HTMLImageElement;
    monsterImg?: HTMLImageElement;
  } = {
    bgImg: images[0],
    frameImg: images[1],
    elementImg: images[2],
    levelImg: images[3],
  };
  
  if (expanded && monster.image) {
    result.sideImg = images[4];
    result.monsterImg = images[5];
  } else if (expanded) {
    result.sideImg = images[4];
  } else if (monster.image) {
    result.monsterImg = images[4];
  }
  
  return result;
};

// Load move type images
export const loadMoveTypeImages = async (monster: MonsterStats, CardImages: any) => {
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
  
  return moveTypeImages;
};
