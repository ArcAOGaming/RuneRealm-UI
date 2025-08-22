import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { hexToRgb, matchesGreyShade, calculateColorShade, getGreyLevel } from '../../utils/colorMapping';
import { SpriteColorizer } from "../../utils/spriteColorizer";

interface FourDirectionViewProps {
  layers: {
    [key: string]: {
      style: string;
      color: string;
    };
  };
  darkMode?: boolean;
}

type Direction = 'forward' | 'left' | 'right' | 'back';

class FourDirectionScene extends Phaser.Scene {
  private sprites: { [key: string]: { [direction in Direction]: Phaser.GameObjects.Sprite } };
  private frameSequences: { [key in Direction]: number[] };
  private frameRates: { [key in Direction]: number };
  private textureCache: { [key: string]: string } = {};
  private layers: FourDirectionViewProps['layers'];
  private animationPrefix: { [key in Direction]: string } = {
    forward: 'walk-down',
    left: 'walk-left',
    right: 'walk-right',
    back: 'walk-up'
  };
  private darkMode: boolean;
  setIsLoading: (isLoading: boolean) => void;
  private isUpdating: boolean = false; // Prevent concurrent updates
  
  // Animation synchronization
  private currentFrame: { [key in Direction]: number } = {
    forward: 0,
    left: 0, 
    right: 0,
    back: 0
  };
  private animationTimer: { [key in Direction]: Phaser.Time.TimerEvent | null } = {
    forward: null,
    left: null,
    right: null, 
    back: null
  };
  
  // Define proper layer order for sprite rendering (from back to front)
  private layerDepth: { [key: string]: number } = {
    'BASE': 0,      // Base character (back)
    'Pants': 1,     // Pants over base
    'Shirt': 2,     // Shirt over pants  
    'Shoes': 3,     // Shoes over legs
    'Hair': 4,      // Hair over head
    'Gloves': 5,    // Gloves over hands
    'Hat': 6        // Hat over hair (front)
  };

  constructor(layers: FourDirectionViewProps['layers'], darkMode: boolean) {
    super({ key: 'FourDirectionScene' });
    this.layers = layers;
    this.darkMode = darkMode;
    this.sprites = {};
    this.frameSequences = {
      forward: [0, 1, 2, 1],
      left: [3, 4, 5, 4],
      right: [6, 7, 8, 7],
      back: [9, 10, 11, 10]
    };
    this.frameRates = {
      forward: 8,
      left: 8,
      right: 8,
      back: 8
    };
  }

  setDarkMode(darkMode: boolean) {
    this.darkMode = darkMode;
  }

  preload() {
    const spritesheetConfig = {
      frameWidth: 48,
      frameHeight: 60
    };

    // Load base sprite synchronously like WalkingPreview
    this.load.spritesheet('BASE', new URL('../../assets/BASE.png', import.meta.url).href, spritesheetConfig);

    // Load all layer variations synchronously
    Object.entries(this.layers).forEach(([layerName, layer]) => {
      const assetPath = new URL(`../../assets/${layerName}/${layer.style}.png`, import.meta.url).href;
      this.load.spritesheet(`${layerName}.${layer.style}`, assetPath, spritesheetConfig);
    });

    // Add loading event listeners
    this.load.on('complete', () => {
      this.setIsLoading(false);
    });

    this.load.on('loaderror', (file: any) => {
      console.error('Error loading asset:', file.src);
    });
  }

  create() {
    const directions: Direction[] = ['forward', 'left', 'right', 'back'];
    const frameRates = { forward: 8, left: 8, right: 8, back: 8 };
    
    // Dynamic positioning based on actual canvas size
    const gameWidth = this.sys.game.config.width as number;
    const gameHeight = this.sys.game.config.height as number;
    const spacing = gameWidth / 4; // Divide width into 4 equal parts
    const centerY = gameHeight / 2;
    
    const positions = {
      forward: { x: spacing * 0.5, y: centerY },
      left: { x: spacing * 1.5, y: centerY },
      right: { x: spacing * 2.5, y: centerY },
      back: { x: spacing * 3.5, y: centerY }
    };
    
    // Define frame sequences for ping-pong style animation
    const frameSequences = {
      forward: [0, 1, 2, 1],
      left: [3, 4, 5, 4],
      right: [6, 7, 8, 7],
      back: [9, 10, 11, 10]
    };

    // Add glassmorphism frames - responsive size
    const frameStyle = {
      width: Math.min(175, spacing * 0.8), // Responsive frame width
      height: Math.min(200, gameHeight * 0.8), // Responsive frame height
      fillStyle: 0x814E33,
      fillAlpha: 0.2,
      strokeStyle: 0xF4860A,
      strokeAlpha: 0.3,
      radius: 20
    };

    // Add frames for each position
    Object.entries(positions).forEach(([direction, pos]) => {
      // Larger blur background
      const blurBg = this.add.graphics();
      blurBg.fillStyle(frameStyle.fillStyle, frameStyle.fillAlpha * 0.4);
      blurBg.fillRoundedRect(
        pos.x - frameStyle.width/2 - 10, 
        pos.y - frameStyle.height/2 - 10,
        frameStyle.width + 20,
        frameStyle.height + 20,
        frameStyle.radius + 8
      );

      // Medium blur layer
      const blurMid = this.add.graphics();
      blurMid.fillStyle(frameStyle.fillStyle, frameStyle.fillAlpha * 0.6);
      blurMid.fillRoundedRect(
        pos.x - frameStyle.width/2 - 5, 
        pos.y - frameStyle.height/2 - 5,
        frameStyle.width + 10,
        frameStyle.height + 10,
        frameStyle.radius + 4
      );

      // Main frame
      const frame = this.add.graphics();
      frame.lineStyle(2, frameStyle.strokeStyle, frameStyle.strokeAlpha);
      frame.fillStyle(frameStyle.fillStyle, frameStyle.fillAlpha);
      frame.fillRoundedRect(
        pos.x - frameStyle.width/2, 
        pos.y - frameStyle.height/2,
        frameStyle.width,
        frameStyle.height,
        frameStyle.radius
      );
    });

    // Add direction labels with adjusted positions
    const labelStyle = {
      color: this.darkMode ? '#FCF5D8' : '#2A1912',
      fontSize: Math.min(24, gameWidth / 40) + 'px', // Responsive font size
      fontWeight: 'bold',
      fontFamily: 'Arial'
    };

    // Add direction descriptions
    const descriptions = {
      forward: 'Forward',
      left: 'Left',
      right: 'Right',
      back: 'Back'
    };

    Object.entries(positions).forEach(([direction, pos]) => {
      // Title
      this.add.text(
        pos.x,
        pos.y - frameStyle.height/2 + 25,
        descriptions[direction as Direction],
        labelStyle
      ).setOrigin(0.5);
    });

    // Initialize sprite containers
    this.sprites['BASE'] = {
      forward: this.add.sprite(positions.forward.x, positions.forward.y, 'BASE'),
      left: this.add.sprite(positions.left.x, positions.left.y, 'BASE'),
      right: this.add.sprite(positions.right.x, positions.right.y, 'BASE'),
      back: this.add.sprite(positions.back.x, positions.back.y, 'BASE')
    };

    // Create base sprites and animations for each direction
    directions.forEach(dir => {
      // Create base sprite for this direction
      this.sprites['BASE'][dir] = this.add.sprite(positions[dir].x, positions[dir].y, 'BASE');
      this.sprites['BASE'][dir].setOrigin(0.5, 0.5);
      this.sprites['BASE'][dir].setScale(Math.min(3, gameWidth / 320)); // Responsive sprite scale
      
      // Set BASE to be at the back (depth 0)
      this.sprites['BASE'][dir].setDepth(this.layerDepth['BASE']);

      // Create animation for base
      this.anims.create({
        key: `BASE-${this.animationPrefix[dir]}`,
        frames: this.anims.generateFrameNumbers('BASE', {
          frames: frameSequences[dir]
        }),
        frameRate: frameRates[dir],
        repeat: -1
      });

      // Don't start BASE animation yet - will be controlled by sync system
      this.sprites['BASE'][dir].setFrame(this.frameSequences[dir][0]);
    });

    // Start synchronized animations for all directions
    this.startSynchronizedAnimations();

    // Create layer sprites and animations
    const initializeLayers = async () => {
      for (const [layerName, layer] of Object.entries(this.layers)) {
        const spriteKey = `${layerName}.${layer.style}`;
        
        // Initialize sprites object for this layer
        this.sprites[layerName] = {
          forward: null as any,
          left: null as any, 
          right: null as any,
          back: null as any
        };
        
        // Create a new texture with color replacement
        const colorizedKey = await this.colorizeTexture(this.textures.get(spriteKey), layerName, layer.style, layer.color);
        
        // Create sprites and animations for each direction
        for (const dir of directions) {
          // Create sprite for this direction with colorized texture only
          this.sprites[layerName][dir] = this.add.sprite(
            positions[dir].x,
            positions[dir].y,
            colorizedKey
          );
          this.sprites[layerName][dir].setOrigin(0.5, 0.5);
          this.sprites[layerName][dir].setScale(Math.min(3, this.sys.game.config.width as number / 320)); // Responsive sprite scale
          
          // Set proper depth for layering (higher number = in front)
          const depth = this.layerDepth[layerName] ?? 999; // Default high depth for unknown layers
          this.sprites[layerName][dir].setDepth(depth);

          // Don't create separate animations - use synchronized system
          // Set initial frame to match current synchronized frame
          const currentFrameIndex = this.frameSequences[dir][this.currentFrame[dir]];
          this.sprites[layerName][dir].setFrame(currentFrameIndex);
        }
      }
    };

    // Initialize layers
    initializeLayers();
  }

  async colorizeTexture(texture: Phaser.Textures.Texture, layerName: string, style: string, color: string): Promise<string> {
    const key = `${layerName}_${style}_${color}`;
    
    // Check if we already have this colorized texture
    if (this.textureCache[key]) {
      return key;
    }

    // Create a temporary canvas to get image data
    const tempCanvas = document.createElement('canvas');
    const sourceImage = texture.getSourceImage() as HTMLImageElement;
    tempCanvas.width = sourceImage.width;
    tempCanvas.height = sourceImage.height;
    
    const ctx = tempCanvas.getContext('2d')!;
    ctx.drawImage(sourceImage, 0, 0);
    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

    // Use the shared colorizer
    const colorizedData = SpriteColorizer.colorizeTexture(imageData, color, {
      preserveAlpha: true,
      cacheKey: `preview_${layerName}_${style}_${color}`
    });

    // Create a new canvas for the colorized texture
    const colorizedCanvas = document.createElement('canvas');
    colorizedCanvas.width = tempCanvas.width;
    colorizedCanvas.height = tempCanvas.height;
    const colorizedCtx = colorizedCanvas.getContext('2d')!;
    colorizedCtx.putImageData(colorizedData, 0, 0);

    // Create a temporary image to load into Phaser
    const image = new Image();
    image.src = colorizedCanvas.toDataURL();
    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
    });

    // Add the colorized texture to Phaser's texture manager with spritesheet config
    this.textures.addSpriteSheet(key, image, {
      frameWidth: 48,
      frameHeight: 60
    });

    // Cache the texture key
    this.textureCache[key] = key;

    return key;
  }

  // Synchronized animation system - all sprites move together
  startSynchronizedAnimations() {
    const directions: Direction[] = ['forward', 'left', 'right', 'back'];
    
    directions.forEach(dir => {
      // Stop any existing timer
      if (this.animationTimer[dir]) {
        this.animationTimer[dir]?.destroy();
      }
      
      // Create new synchronized timer for this direction
      this.animationTimer[dir] = this.time.addEvent({
        delay: 1000 / this.frameRates[dir], // Convert frameRate to delay in ms
        callback: () => {
          // Advance frame
          this.currentFrame[dir] = (this.currentFrame[dir] + 1) % this.frameSequences[dir].length;
          const frameIndex = this.frameSequences[dir][this.currentFrame[dir]];
          
          // Update all sprites for this direction to the same frame
          Object.keys(this.sprites).forEach(layerName => {
            if (this.sprites[layerName] && this.sprites[layerName][dir]) {
              try {
                this.sprites[layerName][dir].setFrame(frameIndex);
              } catch (error) {
                // Skip if frame doesn't exist for this sprite
              }
            }
          });
        },
        callbackScope: this,
        loop: true
      });
    });
  }

  // Stop all synchronized animations
  stopSynchronizedAnimations() {
    Object.values(this.animationTimer).forEach(timer => {
      if (timer) {
        timer.destroy();
      }
    });
    
    this.animationTimer = {
      forward: null,
      left: null,
      right: null,
      back: null
    };
  }

  async updateColors(newLayers: FourDirectionViewProps['layers']) {
    // Prevent concurrent updates that can cause race conditions
    if (this.isUpdating) {
      return;
    }
    
    this.isUpdating = true;
    
    try {
      this.layers = newLayers;
      const directions: Direction[] = ['forward', 'left', 'right', 'back'];
      
      // Process each layer from newLayers like WalkingPreview does
      for (const [layerName, layer] of Object.entries(newLayers)) {
      try {
        const baseKey = `${layerName}.${layer.style}`;
        
        // Skip if style is 'None' - remove sprite if it exists
        if (layer.style === 'None') {
          if (this.sprites[layerName]) {
            directions.forEach(dir => {
              if (this.sprites[layerName][dir]) {
                this.sprites[layerName][dir].destroy();
              }
            });
            delete this.sprites[layerName];
          }
          continue;
        }
        
        // Load base spritesheet if not exists
        if (!this.textures.exists(baseKey)) {
          try {
            await new Promise<void>((resolve, reject) => {
              const url = new URL(`../../assets/${layerName}/${layer.style}.png`, import.meta.url).href;
              
              this.load.once('loaderror', () => {
                console.error(`Failed to load asset: ${url}`);
                reject(new Error(`Failed to load ${layerName}/${layer.style}.png`));
              });
              
              this.load.spritesheet(baseKey, url, {
                frameWidth: 48,
                frameHeight: 60
              });
              
              this.load.once('complete', resolve);
              this.load.start();
            });
          } catch (error) {
            console.error(`Error loading ${layerName}/${layer.style}.png:`, error);
            continue;
          }
        }

        // Create colored version
        const baseTexture = this.textures.get(baseKey);
        if (!baseTexture) continue;

        const colorizedKey = await this.colorizeTexture(baseTexture, layerName, layer.style, layer.color);
        
        // Get positions (same as in create method)
        const gameWidth = this.sys.game.config.width as number;
        const gameHeight = this.sys.game.config.height as number;
        const spacing = gameWidth / 4;
        const centerY = gameHeight / 2;
        
        const positions = {
          forward: { x: spacing * 0.5, y: centerY },
          left: { x: spacing * 1.5, y: centerY },
          right: { x: spacing * 2.5, y: centerY },
          back: { x: spacing * 3.5, y: centerY }
        };

        // Create or update sprites for this layer
        if (!this.sprites[layerName]) {
          // Create new sprites
          this.sprites[layerName] = {
            forward: null as any,
            left: null as any,
            right: null as any,
            back: null as any
          };

          directions.forEach(dir => {
            this.sprites[layerName][dir] = this.add.sprite(
              positions[dir].x,
              positions[dir].y,
              colorizedKey
            );
            this.sprites[layerName][dir].setOrigin(0.5, 0.5);
            this.sprites[layerName][dir].setScale(Math.min(3, gameWidth / 320));
            
            // Set proper depth for layering
            const depth = this.layerDepth[layerName] ?? 999;
            this.sprites[layerName][dir].setDepth(depth);
            
            // Immediately sync with current animation frame
            const currentFrameIndex = this.frameSequences[dir][this.currentFrame[dir]];
            this.sprites[layerName][dir].setFrame(currentFrameIndex);
          });
        } else {
          // Update existing sprites with new texture
          directions.forEach(dir => {
            if (this.sprites[layerName][dir]) {
              this.sprites[layerName][dir].setTexture(colorizedKey);
              
              // Ensure depth is still correct after texture update
              const depth = this.layerDepth[layerName] ?? 999;
              this.sprites[layerName][dir].setDepth(depth);
            }
          });
        }

        // Sync new sprites with current animation frame instead of starting separate animations
        directions.forEach(dir => {
          if (this.sprites[layerName][dir]) {
            // Set frame to match current synchronized frame
            const currentFrameIndex = this.frameSequences[dir][this.currentFrame[dir]];
            this.sprites[layerName][dir].setFrame(currentFrameIndex);
          }
        });

        } catch (error) {
          console.error(`Error processing layer ${layerName}:`, error);
          continue;
        }
      }
    } finally {
      this.isUpdating = false;
    }
  }

  shutdown() {
    // Stop synchronized animations
    this.stopSynchronizedAnimations();
    
    Object.values(this.sprites).forEach(directionSprites => {
      Object.values(directionSprites).forEach(sprite => {
        sprite.destroy();
      });
    });
    Object.keys(this.textureCache).forEach(key => {
      if (this.textures.exists(key)) {
        this.textures.remove(key);
      }
    });
    this.textureCache = {};
  }
}

const FourDirectionView: React.FC<FourDirectionViewProps> = ({ layers, darkMode = false }) => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<FourDirectionScene | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingLayersRef = useRef(layers);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameRef.current && containerRef.current) {
      // Get container dimensions for responsive sizing
      const containerRect = containerRef.current.getBoundingClientRect();
      const gameWidth = Math.min(960, containerRect.width * 0.95); // Max 960 or container width
      const gameHeight = Math.min(280, containerRect.height * 0.8); // Max 280 or container height
      
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: gameWidth,
          height: gameHeight,
        },
        parent: 'four-direction-container',
        scene: class extends FourDirectionScene {
          constructor() {
            super(pendingLayersRef.current, darkMode);
            this.setIsLoading = setIsLoading;
          }
        },
        transparent: true,
        pixelArt: true,
        backgroundColor: 'rgba(0, 0, 0, 0)'
      };

      gameRef.current = new Phaser.Game(config);
      
      // Get scene reference once it's ready
      gameRef.current.events.once('ready', () => {
        const scene = gameRef.current?.scene.getScene('FourDirectionScene');
        if (scene instanceof FourDirectionScene) {
          sceneRef.current = scene;
          // No need to apply layers here since constructor already handles initial state
        }
      });
    }

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
        sceneRef.current = null;
      }
    };
  }, []);

  // Handle layers changes
  useEffect(() => {
    pendingLayersRef.current = layers;
    if (sceneRef.current) {
      sceneRef.current.updateColors(layers);
    }
  }, [layers]);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setDarkMode(darkMode);
    }
  }, [darkMode]);

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center rounded-lg overflow-hidden">
      <div id="four-direction-container" className="w-full h-full flex items-center justify-center" />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800/75">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-500" />
        </div>
      )}
    </div>
  );
};

export default FourDirectionView;
