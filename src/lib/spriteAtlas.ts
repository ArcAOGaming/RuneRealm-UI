/**
 * The Phaser atlas for a character sheet.
 *
 * Recovered verbatim from `sVIX0l_PFC6M7lYpuEOGJ_f5ESOkMxd5f5xCQSUH_2g`, the
 * atlas every character in the old game pointed at. The layout does not vary
 * per player — 21 named frames mapped onto a 576x60 sheet of 48x60 cells, with
 * several names sharing a cell — so the old customiser uploaded only the PNG
 * and referenced this one atlas by a hardcoded id.
 *
 * One frame name is CORRECTED here: the published atlas has `walk_up_03png`,
 * missing the dot, so the last frame of the up-facing walk does not resolve and
 * that animation is a frame short wherever it plays. It has presumably been
 * that way since the art was cut. Fixed to `walk_up_03.png`; the cell it points
 * at is unchanged.
 *
 * It is generated per character now instead, so the sheet and the atlas that
 * describes it are uploaded together and stay a matched pair. If the frame
 * layout is ever re-cut, an old sheet keeps its own correct atlas rather than
 * being reinterpreted by a newer one.
 */
export const SHEET_SIZE = { w: 576, h: 60 } as const;
export const FRAME_SIZE = { w: 48, h: 60 } as const;

/** Animation names and their frame rates, as Phaser reads them. */
export const ANIMATIONS: Record<string, { fps?: number }> = {
  "idle": {},
  "idle_up": {},
  "idle_down": {},
  "idle_left": {},
  "idle_right": {},
  "walk": {},
  "walk_up": {},
  "walk_down": {},
  "walk_left": {},
  "walk_right": {},
  "run": {
    "fps": 16
  },
  "run_up": {
    "fps": 16
  },
  "run_down": {
    "fps": 16
  },
  "run_left": {
    "fps": 16
  },
  "run_right": {
    "fps": 16
  },
  "emote": {
    "fps": 16
  }
};

/** Every named frame and the cell it points at. */
export const FRAMES: { filename: string; frame: { x: number; y: number; w: number; h: number } }[] = [
  {
    "filename": "idle_00.png",
    "frame": {
      "x": 48,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "idle_down_00.png",
    "frame": {
      "x": 48,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "idle_left_00.png",
    "frame": {
      "x": 192,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "idle_right_00.png",
    "frame": {
      "x": 336,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "idle_up_00.png",
    "frame": {
      "x": 480,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_down_00.png",
    "frame": {
      "x": 0,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_down_01.png",
    "frame": {
      "x": 48,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_down_02.png",
    "frame": {
      "x": 96,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_down_03.png",
    "frame": {
      "x": 48,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_left_00.png",
    "frame": {
      "x": 144,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_left_01.png",
    "frame": {
      "x": 192,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_left_02.png",
    "frame": {
      "x": 240,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_left_03.png",
    "frame": {
      "x": 192,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_right_00.png",
    "frame": {
      "x": 288,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_right_01.png",
    "frame": {
      "x": 336,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_right_02.png",
    "frame": {
      "x": 384,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_right_03.png",
    "frame": {
      "x": 336,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_up_00.png",
    "frame": {
      "x": 432,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_up_01.png",
    "frame": {
      "x": 480,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_up_02.png",
    "frame": {
      "x": 528,
      "y": 0,
      "w": 48,
      "h": 60
    }
  },
  {
    "filename": "walk_up_03.png",
    "frame": {
      "x": 480,
      "y": 0,
      "w": 48,
      "h": 60
    }
  }
];

/**
 * The atlas JSON for a sheet, ready to upload.
 *
 * `image` names the sheet this describes. Phaser is normally handed a relative
 * filename; here it is the sheet's own transaction id, so the pair is resolvable
 * from the atlas alone wherever it is fetched from.
 */
export function buildAtlas(imageTxId: string) {
  return {
    format: "JSON",
    image: imageTxId,
    meta: {
      size: SHEET_SIZE,
      frameSize: FRAME_SIZE,
      animations: ANIMATIONS,
    },
    frames: FRAMES,
  };
}
