// Shared interfaces
export interface InventoryItem {
  id: string;
  name: string;
  imageUrl?: string;
  rarity?: string; // common, uncommon, rare, epic, legendary
  description?: string;
}

// Card images based on element type
export const CardImages = {
  air:{
    backgrounds: "S9ME1vtSmYqS8v5ygzX5CMpvYYVZ-nsV1kselavUDeM",
    cardframe: "AsRyajmJKrIFvmc6k3H-GKYveWb1TDvgIPg7HVH1B9k",
    elementtypes: "FwbLZYa0r0twYUvkP8su81L7yMhvs4EPkulUEm1X52U",
    level: "Bnvgn5yi9_6iRsRlKD9rhQvH5i0XhXvEeDTKu3LhJOI",
    side:"-nnSDId268Dzo9Sb7ERnum2zC5H8Cn9f8p_BOpbg2y0"
  },
  rock:{
    backgrounds: "arPti-7FScNGuPAzcaypGYv_aKk6v5Xk2TBbSeTq9Vc",
    cardframe: "m1GudORk0Q_46kkF0Z_SYvP9EVz3r9EvDMckn7XmwgA",
    elementtypes: "b2pyHeYmaHkE4pzCqIGoqVzjrkXSA71pVruHY9wbv10",
    level: "whQ3nCw8fNrO3gPCSlBOTOlQ2WmLBZH3FeSogwtXmFg",
    side:"-nnSDId268Dzo9Sb7ERnum2zC5H8Cn9f8p_BOpbg2y0"
  },
  fire:{
    backgrounds: "_c3YdO2buD9WYhjst7XiaNRu5CsJ2_dZtSGISB_naQs",
    cardframe: "leecHc-g-zitMPrrMuO_P22ovyFc9OjW3u_F2rFkmSM",
    elementtypes: "1TMMbDFfPFuU60wNZVMN8mlI1c9J-7XPg7T_14SP480",
    level: "qlKFPHcG5xCWkrcFNeHGdKVv4qGS4NyTPOT-CYkmVsY",
    side:"-nnSDId268Dzo9Sb7ERnum2zC5H8Cn9f8p_BOpbg2y0"
  },
  water:{
    backgrounds: "cHmLdp4ozWmhMfnjhGe5noaMB7Jl9ieSg2cGnkovb7Y",
    cardframe: "ts_msM47WJdKVkDphg3TwKgwi_r0Cx6N10qxa8cHhbo",
    elementtypes: "MvwTMcUOAClFOUrQG_BONbuVLCUuzzu2ep_0KXo03lA",
    level: "k8qbJykA3KTUrLQ_O2TraH_LkJWlbGwOwYZs-E-bIjU",
    side:"-nnSDId268Dzo9Sb7ERnum2zC5H8Cn9f8p_BOpbg2y0"
  },
  heal:{
    backgrounds: "cHmLdp4ozWmhMfnjhGe5noaMB7Jl9ieSg2cGnkovb7Y",
    cardframe: "ts_msM47WJdKVkDphg3TwKgwi_r0Cx6N10qxa8cHhbo",
    elementtypes: "FwbLZYa0r0twYUvkP8su81L7yMhvs4EPkulUEm1X52U",
    level: "k8qbJykA3KTUrLQ_O2TraH_LkJWlbGwOwYZs-E-bIjU",
    side:"-nnSDId268Dzo9Sb7ERnum2zC5H8Cn9f8p_BOpbg2y0"
  },
  boost:{
    backgrounds: "cHmLdp4ozWmhMfnjhGe5noaMB7Jl9ieSg2cGnkovb7Y",
    cardframe: "ts_msM47WJdKVkDphg3TwKgwi_r0Cx6N10qxa8cHhbo",
    elementtypes: "MvwTMcUOAClFOUrQG_BONbuVLCUuzzu2ep_0KXo03lA",
    level: "k8qbJykA3KTUrLQ_O2TraH_LkJWlbGwOwYZs-E-bIjU",
    side:"-nnSDId268Dzo9Sb7ERnum2zC5H8Cn9f8p_BOpbg2y0"
  },
  normal:{
    backgrounds: "cHmLdp4ozWmhMfnjhGe5noaMB7Jl9ieSg2cGnkovb7Y",
    cardframe: "ts_msM47WJdKVkDphg3TwKgwi_r0Cx6N10qxa8cHhbo",
    elementtypes: "MvwTMcUOAClFOUrQG_BONbuVLCUuzzu2ep_0KXo03lA",
    level: "k8qbJykA3KTUrLQ_O2TraH_LkJWlbGwOwYZs-E-bIjU",
    side:"-nnSDId268Dzo9Sb7ERnum2zC5H8Cn9f8p_BOpbg2y0"
  },
};

// Card dimensions and layout
export const CARD = {
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
      TOP: 80,     // Top padding for the expanded area (increased to move moves section down)
      OVERLAY_LEFT: 15  // Left indentation for the overlay box
    },
    WIDTH: 417,    // Width of the expanded section (full size of background image)
    BACKGROUND: {
      COLOR: 'transparent', // Transparent background
      BORDER: {
        COLOR: '#ddd',
        WIDTH: 2,
        RADIUS: 10
      }
    },
    // Section titles configuration
    SECTION_TITLE: {
      FONT: {
        FAMILY: 'Arial, sans-serif',
        WEIGHT: 'bold',
        SIZE: 36,
        COLOR: '#333333'
      },
      SPACING: {
        BOTTOM: 10,     // Space below the title text before the underline
        AFTER: 20       // Space after the underline before section content
      },
      UNDERLINE: {
        COLOR: '#5b87cc', // More vibrant blue color
        WIDTH: 3,         // Slightly thicker
        GRADIENT: true    // Use gradient for more gaming aesthetic
      },
      ICON_SIZE: 24,      // Size of the section icons
      SHADOW: {
        COLOR: 'rgba(0, 0, 0, 0.2)',
        BLUR: 3,
        OFFSET_X: 2,
        OFFSET_Y: 2
      }
    },
    // Configuration for move boxes
    MOVES: {
      HEIGHT: 100,           // Height of each move box
      SPACING: 15,           // Vertical space between move boxes
      SECTION_SPACING: 30,   // Space between different sections (reduced)
      TITLE_OFFSET: 5,      // Space above the title
      FIRST_MOVE_OFFSET: 0, // Space after title before first move (further reduced to make moves closer to title)
      BACKGROUND: {
        COLOR: 'rgba(255, 255, 255, 0.7)'
      },
      BORDER: {
        COLOR: '#7e91ac',    // More game-like bluish border
        WIDTH: 2,            // Thicker border
        RADIUS: 8            // Rounded corners
      },
      SHADOW: {
        COLOR: 'rgba(0, 0, 0, 0.15)',
        BLUR: 5,
        OFFSET_X: 2,
        OFFSET_Y: 2
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
            COLOR: 'rgba(255, 255, 255, 0.7)',
            BORDER_COLOR: 'rgba(180, 180, 180, 0.7)',
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
      SECTION_SPACING: 5,    // Space between different sections (further reduced to move inventory higher)
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
          COLOR: 'rgba(255, 255, 255, 0.7)',
          BORDER_COLOR: 'rgba(180, 180, 180, 0.7)',
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
