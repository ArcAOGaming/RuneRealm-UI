import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { hexToRgb, matchesGreyShade, calculateColorShade, GREY_SHADES } from '../utils/colorMapping';

interface WalkingPreviewProps {
  layers: {
    [key: string]: {
      style: string;
      color: string;
    };
  };
  darkMode?: boolean;
}

class WalkingScene extends Phaser.Scene {
  private character: Phaser.GameObjects.Container;
  private sprites: { [key: string]: Phaser.GameObjects.Sprite } = {};
  private textureCache: { [key: string]: string } = {};
  private colorCache: { [key: string]: ImageData } = {};
  private currentDirection = 'down';
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private speed = 2;
  private touchControls = {
    up: false,
    down: false,
    left: false,
    right: false
  };
  private spriteScale: number = 1;
  private mapScale: number = 1;

  constructor() {
    super({ key: 'WalkingScene' });
  }

  setTouchControl(direction: 'up' | 'down' | 'left' | 'right', pressed: boolean) {
    this.touchControls[direction] = pressed;
  }

  preload() {
    // Load base sprite
    this.load.spritesheet('BASE', new URL('../assets/BASE.png', import.meta.url).href, {
      frameWidth: 48,
      frameHeight: 60
    });
    
    // Load map background
    this.load.image('map', new URL('../assets/Map.png', import.meta.url).href);
  }

  create() {
    // Add map background
    const map = this.add.image(240, 160, 'map');
    map.setOrigin(0.5);
    
    // Calculate scales based on canvas size
    this.mapScale = Math.min(480 / map.width, 320 / map.height);
    this.spriteScale = this.mapScale * 0.6; // Scale character relative to map (25% smaller)
    
    map.setScale(this.mapScale);

    // Create character container in the center
    this.character = this.add.container(240, 160);

    // Create base sprite
    const baseSprite = this.add.sprite(0, 0, 'BASE');
    baseSprite.setScale(this.spriteScale);
    this.character.add(baseSprite);
    this.sprites['BASE'] = baseSprite;

    // Create animations
    const directions = ['down', 'left', 'right', 'up'];
    const frames = {
      down: [0, 1, 2, 1],
      left: [3, 4, 5, 4],
      right: [6, 7, 8, 7],
      up: [9, 10, 11, 10]
    };

    directions.forEach(dir => {
      this.anims.create({
        key: `BASE-walk-${dir}`,
        frames: frames[dir].map(frame => ({ key: 'BASE', frame })),
        frameRate: 6,
        repeat: -1
      });
    });

    // Set up keyboard controls
    this.cursors = this.input.keyboard.createCursorKeys();
  }

  update() {
    // Handle movement based on keyboard and touch input
    let isMoving = false;
    let newDirection = this.currentDirection;
    let wasMoving = Object.values(this.sprites).some(sprite => sprite.anims.isPlaying);

    if (this.cursors.left.isDown || this.touchControls.left) {
      this.character.x -= this.speed;
      newDirection = 'left';
      isMoving = true;
    }
    else if (this.cursors.right.isDown || this.touchControls.right) {
      this.character.x += this.speed;
      newDirection = 'right';
      isMoving = true;
    }
    else if (this.cursors.up.isDown || this.touchControls.up) {
      this.character.y -= this.speed;
      newDirection = 'up';
      isMoving = true;
    }
    else if (this.cursors.down.isDown || this.touchControls.down) {
      this.character.y += this.speed;
      newDirection = 'down';
      isMoving = true;
    }

    // Calculate bounds based on map scale
    const margin = 24 * this.mapScale;
    const maxX = 480 - margin;
    const maxY = 320 - (margin * 1.5); // Reduce bottom boundary to keep character on map

    // Keep character within bounds
    this.character.x = Phaser.Math.Clamp(this.character.x, margin, maxX);
    this.character.y = Phaser.Math.Clamp(this.character.y, margin, maxY);

    // Update animations
    if (isMoving) {
      // If we weren't moving before or changed direction, restart animation
      if (!wasMoving || this.currentDirection !== newDirection) {
        this.currentDirection = newDirection;
        Object.values(this.sprites).forEach(sprite => {
          sprite.play(`${sprite.texture.key}-walk-${this.currentDirection}`);
        });
      }
    } else {
      // Stop animations when not moving
      Object.values(this.sprites).forEach(sprite => {
        sprite.stop();
        const frames = {
          down: 1,
          left: 4,
          right: 7,
          up: 10
        };
        sprite.setFrame(frames[this.currentDirection]);
      });
    }
  }

  private async createColoredTexture(spriteKey: string, color: string): Promise<string> {
    const textureKey = `${spriteKey}-${color}`;
    
    // Return existing texture if we have it
    if (this.textureCache[textureKey]) {
      return textureKey;
    }

    // Get the base texture
    const baseTexture = this.textures.get(spriteKey);
    const frame = baseTexture.getSourceImage() as HTMLImageElement;

    // Create canvas for the full spritesheet
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    // Draw original sprite to canvas
    ctx.drawImage(frame, 0, 0);

    // Get image data for color manipulation
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    const rgbColor = hexToRgb(color);

    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a > 0) { // Only process visible pixels
        const shadeIndex = matchesGreyShade({ r, g, b });
        if (shadeIndex !== -1) {
          // Calculate the color for this shade
          const greyShade = GREY_SHADES[shadeIndex];
          const factor = (greyShade.r + greyShade.g + greyShade.b) / (3 * 255);
          const newColor = calculateColorShade(rgbColor, factor * 255);

          data[i] = newColor.r;
          data[i + 1] = newColor.g;
          data[i + 2] = newColor.b;
        }
      }
    }

    // Put the modified image data back
    ctx.putImageData(imageData, 0, 0);

    // Create a temporary image to load into Phaser
    const image = new Image();
    image.src = canvas.toDataURL();
    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
    });

    // Add the colored texture to Phaser
    this.textures.addSpriteSheet(textureKey, image, {
      frameWidth: 48,
      frameHeight: 60
    });

    // Cache the texture key
    this.textureCache[textureKey] = textureKey;

    return textureKey;
  }

  async updateSprites(layers: WalkingPreviewProps['layers']) {
    // Load and create new sprites
    for (const [layerName, layer] of Object.entries(layers)) {
      try {
        const baseKey = `${layerName}.${layer.style}`;
        
        // Skip if style is 'None'
        if (layer.style === 'None') {
          // Remove sprite if it exists
          if (this.sprites[layerName]) {
            this.sprites[layerName].destroy();
            delete this.sprites[layerName];
          }
          continue;
        }
        
        // Load base spritesheet if not exists
        if (!this.textures.exists(baseKey)) {
          try {
            await new Promise<void>((resolve, reject) => {
              const url = new URL(`../assets/${layerName}/${layer.style}.png`, import.meta.url).href;
              
              // Add error handler
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
            continue; // Skip this layer if loading fails
          }
        }

        // Create colored version
        const coloredKey = await this.createColoredTexture(baseKey, layer.color);

        // Create or update sprite
        if (!this.sprites[layerName]) {
          const sprite = this.add.sprite(0, 0, coloredKey);
          sprite.setScale(this.spriteScale);
          this.character.add(sprite);
          this.sprites[layerName] = sprite;
        } else {
          this.sprites[layerName].setTexture(coloredKey);
        }

        // Create animations for the colored sprite
        const directions = ['down', 'left', 'right', 'up'];
        const frames = {
          down: [0, 1, 2, 1],
          left: [3, 4, 5, 4],
          right: [6, 7, 8, 7],
          up: [9, 10, 11, 10]
        };

        directions.forEach(dir => {
          const animKey = `${coloredKey}-walk-${dir}`;
          if (this.anims.exists(animKey)) {
            this.anims.remove(animKey);
          }

          this.anims.create({
            key: animKey,
            frames: this.anims.generateFrameNumbers(coloredKey, { 
              frames: frames[dir]
            }),
            frameRate: 6,
            repeat: -1
          });
        });
      } catch (error) {
        console.error(`Error processing layer ${layerName}:`, error);
        // Continue with other layers if one fails
        continue;
      }
    }
  }

  cleanup() {
    Object.values(this.sprites).forEach(sprite => sprite.destroy());
    this.sprites = {};
    if (this.character) this.character.destroy();
    
    // Clean up textures
    Object.keys(this.textureCache).forEach(key => {
      if (this.textures.exists(key)) {
        this.textures.remove(key);
      }
    });
    this.textureCache = {};
    this.colorCache = {};
  }
}

const WalkingPreview: React.FC<WalkingPreviewProps> = ({ layers }) => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<WalkingScene | null>(null);
  const pendingLayersRef = useRef(layers);

  useEffect(() => {
    // Create game instance
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 480,
        height: 320,
        parent: 'walking-preview-container',
      },
      transparent: true,
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      scene: WalkingScene,
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { x: 0, y: 0 }
        }
      }
    };
    gameRef.current = new Phaser.Game(config);

    // Get scene reference once it's created
    gameRef.current.events.once('ready', () => {
      const scene = gameRef.current?.scene.getScene('WalkingScene');
      if (scene instanceof WalkingScene) {
        sceneRef.current = scene;
      }
      // Apply any pending layers once the scene is ready
      if (sceneRef.current && pendingLayersRef.current) {
        sceneRef.current.updateSprites(pendingLayersRef.current);
      }
    });

    // Cleanup
    return () => {
      if (sceneRef.current) {
        sceneRef.current.cleanup();
      }
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  // Update sprites when layers change
  useEffect(() => {
    pendingLayersRef.current = layers;
    if (sceneRef.current) {
      sceneRef.current.updateSprites(layers);
    }
  }, [layers]);

  const handleTouchStart = (direction: 'up' | 'down' | 'left' | 'right') => {
    if (sceneRef.current) {
      sceneRef.current.setTouchControl(direction, true);
    }
  };

  const handleTouchEnd = (direction: 'up' | 'down' | 'left' | 'right') => {
    if (sceneRef.current) {
      sceneRef.current.setTouchControl(direction, false);
    }
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div 
        id="walking-preview-container" 
        className="relative w-full h-full flex items-center justify-center bg-black/5 rounded-xl overflow-hidden"
        style={{ 
          aspectRatio: '3/2',
          width: '100%',
          maxHeight: '100%',
          imageRendering: 'pixelated'
        }}
      >
        {/* Touch controls */}
        <div className="absolute bottom-6 right-6 grid grid-cols-3 gap-1.5 w-24">
          {/* Up button */}
          <div className="col-start-2">
            <button
              onMouseDown={() => handleTouchStart('up')}
              onMouseUp={() => handleTouchEnd('up')}
              className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400 transition-colors">
              ▲
            </button>
          </div>

          {/* Left button */}
          <div className="col-start-1 row-start-2">
            <button
              onMouseDown={() => handleTouchStart('left')}
              onMouseUp={() => handleTouchEnd('left')}
              className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400 transition-colors">
              ◄
            </button>
          </div>

          {/* Down button */}
          <div className="col-start-2 row-start-2">
            <button
              onMouseDown={() => handleTouchStart('down')}
              onMouseUp={() => handleTouchEnd('down')}
              className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400 transition-colors">
              ▼
            </button>
          </div>

          {/* Right button */}
          <div className="col-start-3 row-start-2">
            <button
              onMouseDown={() => handleTouchStart('right')}
              onMouseUp={() => handleTouchEnd('right')}
              className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400 transition-colors">
              ►
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WalkingPreview;
