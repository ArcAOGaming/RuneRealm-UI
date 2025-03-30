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

// This structure defines layout and dimensions, but leaves colors to be replaced at runtime with theme values
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
      COLOR: 'white' // Kept as white for visibility on level badge
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
      COLOR: 'white' // Kept as white for visibility on card frame
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
      COLOR: 'white' // Kept as white for visibility on card frame
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
        COLOR: 'white' // Kept as white for visibility on card frame
      },
      STATS: {
        FAMILY: 'Arial, sans-serif',
        WEIGHT: '600',
        SIZE_RATIO: 0.035,
        COLOR: 'white' // Kept as white for visibility on card frame
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
      TOP: 80,     // Top padding for the expanded area
      OVERLAY_LEFT: 15  // Left indentation for the overlay box
    },
    WIDTH: 417,    // Width of the expanded section (full size of background image)
    BACKGROUND: {
      COLOR: 'transparent', // Transparent background
      BORDER: {
        COLOR: '', // Will be replaced with theme.cardBorder at runtime
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
        COLOR: '' // Will be replaced with theme.cardTitle at runtime
      },
      SPACING: {
        BOTTOM: 10,     // Space below the title text before the underline
        AFTER: 20       // Space after the underline before section content
      },
      UNDERLINE: {
        COLOR: '', // Will be replaced with theme.cardAccent at runtime
        WIDTH: 3,
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
      SECTION_SPACING: 30,   // Space between different sections
      TITLE_OFFSET: 5,      // Space above the title
      FIRST_MOVE_OFFSET: 0, // Space after title before first move
      BACKGROUND: {
        COLOR: '' // Will be replaced with theme container value at runtime
      },
      BORDER: {
        COLOR: '', // Will be replaced with theme border value at runtime
        WIDTH: 2,
        RADIUS: 8
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
          COLOR: '', // Will be replaced with theme.cardText at runtime
          OFFSET_X: 15,
          OFFSET_Y: 30
        },
        STATS: {
          FAMILY: 'Arial, sans-serif',
          WEIGHT: 'normal',
          SIZE: 22,
          COLOR: '', // Will be replaced with theme.cardText at runtime
          OFFSET_X: 12,
          OFFSET_Y: 60,
          SPACING: 10
        },
        RARITY: {
          FAMILY: 'Arial, sans-serif',
          WEIGHT: 'normal',
          SIZE: 35,
          COLOR: 'gold', // Keep gold for rarity as it's a standard indication
          OFFSET_X: 30,
          OFFSET_Y: 70
        }
      },
      // Configuration for element type images
      ELEMENT_IMAGE: {
        HEIGHT: 400,
        OFFSET_X: 20,
        OFFSET_Y: 150,
        FALLBACK: {          // Fallback badge when image is not available
          WIDTH: 80,
          HEIGHT: 25,
          OFFSET_X: 120,
          OFFSET_Y: 10,
          FONT: {
            FAMILY: 'Arial, sans-serif',
            WEIGHT: 'bold',
            SIZE: 16,
            COLOR: 'white' // Kept as white for contrast
          },
          TEXT_OFFSET_X: 80,
          TEXT_OFFSET_Y: 27
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
            WIDTH: 85,
            HEIGHT: 30,
            START_Y: 40,
            START_X: 15,
            X_GAP: 0,
            Y_GAP: 0,
            INNER_PADDING: 3
          },
          BACKGROUND: {
            COLOR: '', // Will be replaced with theme container value at runtime
            BORDER_COLOR: '', // Will be replaced with theme border value at runtime
            BORDER_WIDTH: 1,
            RADIUS: 0
          },
          FONT: {
            FAMILY: 'Arial, sans-serif',
            WEIGHT: 'bold',
            SIZE: 20,
            COLOR: '' // Will be replaced with theme.cardText at runtime
          }
        }
      }
    },
    // Inventory section configuration
    INVENTORY: {
      TITLE_OFFSET: 10,
      SECTION_SPACING: 5,
      ITEM_HEIGHT: 70,
      ITEM_WIDTH: 70,
      ITEM_SPACING: 20,
      ITEM_START_Y: 30,
      FONT: {
        NAME: {
          FAMILY: 'Arial, sans-serif',
          WEIGHT: 'bold',
          SIZE: 18,
          COLOR: '' // Will be replaced with theme.cardText at runtime
        }
      },
      SLOT: {
        BACKGROUND: {
          COLOR: '', // Will be replaced with theme container value at runtime
          BORDER_COLOR: '', // Will be replaced with theme border value at runtime
          BORDER_WIDTH: 2
        },
        EMPTY_TEXT: {
          LABEL: "Empty",
          FONT: {
            FAMILY: 'Arial, sans-serif',
            WEIGHT: 'normal',
            SIZE: 14,
            COLOR: '' // Will be replaced with semi-transparent theme.cardText at runtime
          }
        }
      }
    }
  }
} as const;
