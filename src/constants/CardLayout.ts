// Card layout constants for precise positioning and styling
export const CARD_LAYOUT = {
  // Layer order from background to foreground
  LAYERS: {
    BACKGROUND: '1-backgrounds',
    FRAME: '2-cards-frame',
    ELEMENT: '3-elements-type',
    LEVEL: '4-levels',
    MONSTER: 'monster-image',
    MOVES: '5-moves',
    NAME: '6-monsters-name',
    STATS: 'stats-overlay'
  },

  // Element type mappings
  ELEMENT_IMAGES: {
    air: {
      background: 'Background Air.png',
      frame: 'Frame Air.png',
      type: 'Air Type.png',
      level: 'Lvl Air.png'
    },
    water: {
      background: 'Background Water.png',
      frame: 'Frame Water.png',
      type: 'Water Type.png',
      level: 'Lvl Water.png'
    },
    fire: {
      background: 'Background Fire.png',
      frame: 'Frame Fire.png',
      type: 'Fire Type.png',
      level: 'Lvl Fire.png'
    },
    earth: {
      background: 'Background Earth.png',
      frame: 'Frame Earth.png',
      type: 'Earth Type.png',
      level: 'Lvl Earth.png'
    },
    dark: {
      background: 'Background Air.png', // Fallback to air for now
      frame: 'Frame Air.png',
      type: 'Dark Type.png',
      level: 'Lvl Air.png'
    },
    light: {
      background: 'Background Air.png', // Fallback to air for now
      frame: 'Frame Air.png',
      type: 'Light Type.png',
      level: 'Lvl Air.png'
    }
  },

  // Positioning for various elements (in percentages)
  POSITIONS: {
    LEVEL: {
      TOP: '5%',  // Moved up
      LEFT: '8%',
      WIDTH: '15%'
    },
    MONSTER: {
      TOP: '20%',
      LEFT: '15%',
      WIDTH: '70%'
    },
    STATS: {
      TOP: '55%',  // Moved up
      LEFT: '15%', // Moved right
      WIDTH: '70%',
      SPACING: '4%' // Reduced spacing between stats
    }
  },

  // Font styles
  FONTS: {
    LEVEL: {
      FAMILY: 'Arial, sans-serif',
      SIZE: '1rem',
      WEIGHT: '700',
      COLOR: 'white'
    },
    STATS: {
      FAMILY: 'Courier New, monospace',
      SIZE: '1rem',
      WEIGHT: '600',
      COLOR: 'white'
    }
  },

  // Initial images (for moves and name, to be made dynamic later)
  INITIAL_IMAGES: {
    MOVES: {
      regular: 'Battle Cry.png',
      signature: 'Breeze.png'
    },
    NAME: 'Air.png'
  },

  // Z-index order for proper layering
  Z_INDEX: {
    BACKGROUND: 1,
    FRAME: 2,
    ELEMENT: 3,
    LEVEL_IMAGE: 4,
    LEVEL_TEXT: 5,
    MONSTER: 6,
    MOVES: 7,
    NAME: 8,
    STATS: 9
  }
} as const;

// Card zoom animation settings
export const CARD_ZOOM = {
  SCALE: 2,
  DURATION: '0.3s',
  BACKDROP_OPACITY: 0.8,
  Z_INDEX: 50
} as const;
