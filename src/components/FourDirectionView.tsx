import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { hexToRgb, matchesGreyShade, calculateColorShade, getGreyLevel } from '../utils/colorMapping';
import { SpriteColorizer } from '../utils/spriteColorizer';

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

  preload() {
    console.log('Starting to load assets...');
    
    const spritesheetConfig = {
      frameWidth: 48,
      frameHeight: 60
    };

    // Load base sprite synchronously like WalkingPreview
    this.load.spritesheet('BASE', new URL('../assets/BASE.png', import.meta.url).href, spritesheetConfig);

    // Load all layer variations synchronously
    Object.entries(this.layers).forEach(([layerName, layer]) => {
      const assetPath = new URL(`../assets/${layerName}/${layer.style}.png`, import.meta.url).href;
      console.log(`Loading asset: ${assetPath}`);
      this.load.spritesheet(`${layerName}.${layer.style}`, assetPath, spritesheetConfig);
    });

    // Add loading event listeners
    this.load.on('complete', () => {
      console.log('All assets loaded successfully');
      this.setIsLoading(false);
    });

    this.load.on('loaderror', (file: any) => {
      console.error('Error loading asset:', file.src);
    });
  }

  create() {
    const directions: Direction[] = ['forward', 'left', 'right', 'back'];
    const frameRates = { forward: 8, left: 8, right: 8, back: 8 };
    const positions = {
      forward: { x: 160, y: 120 },
      left: { x: 360, y: 120 },
      right: { x: 560, y: 120 },
      back: { x: 760, y: 120 }
    };
    
    // Define frame sequences for ping-pong style animation
    const frameSequences = {
      forward: [0, 1, 2, 1],
      left: [3, 4, 5, 4],
      right: [6, 7, 8, 7],
      back: [9, 10, 11, 10]
    };

    // Add glassmorphism frames
    const frameStyle = {
      width: 175,
      height: 200,
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
      fontSize: '24px',
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
      this.sprites['BASE'][dir].setScale(3); // Make sprites larger

      // Create animation for base
      this.anims.create({
        key: `BASE-${this.animationPrefix[dir]}`,
        frames: this.anims.generateFrameNumbers('BASE', {
          frames: frameSequences[dir]
        }),
        frameRate: frameRates[dir],
        repeat: -1
      });

      // Start the animation immediately
      this.sprites['BASE'][dir].play(`BASE-${this.animationPrefix[dir]}`);
    });

    // Create layer sprites and animations
    const initializeLayers = async () => {
      for (const [layerName, layer] of Object.entries(this.layers)) {
        const spriteKey = `${layerName}.${layer.style}`;
        this.sprites[layerName] = {
          forward: this.add.sprite(positions.forward.x, positions.forward.y, spriteKey),
          left: this.add.sprite(positions.left.x, positions.left.y, spriteKey),
          right: this.add.sprite(positions.right.x, positions.right.y, spriteKey),
          back: this.add.sprite(positions.back.x, positions.back.y, spriteKey)
        };
        
        // Create a new texture with color replacement
        const colorizedKey = await this.colorizeTexture(this.textures.get(spriteKey), layerName, layer.color);
        // Create sprites and animations for each direction
        for (const dir of directions) {
          // Create sprite for this direction
          this.sprites[layerName][dir] = this.add.sprite(
            positions[dir].x,
            positions[dir].y,
            colorizedKey
          );
          this.sprites[layerName][dir].setOrigin(0.5, 0.5);
          this.sprites[layerName][dir].setScale(3); // Make sprites larger

          // Create animation
          this.anims.create({
            key: `${spriteKey}-${this.animationPrefix[dir]}`,
            frames: this.anims.generateFrameNumbers(colorizedKey, {
              frames: this.frameSequences[dir]
            }),
            frameRate: this.frameRates[dir],
            repeat: -1
          });

          // Start the animation immediately
          this.sprites[layerName][dir].play(`${spriteKey}-${this.animationPrefix[dir]}`);
        }
      }
    };

    // Initialize layers
    initializeLayers();
  }

  async colorizeTexture(texture: Phaser.Textures.Texture, layerName: string, color: string): Promise<string> {
    const key = `${layerName}_${color}`;
    
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
      cacheKey: `preview_${layerName}_${color}`
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

  async updateColors(newLayers: FourDirectionViewProps['layers']) {
    for (const [layerName, layer] of Object.entries(newLayers)) {
      if (this.sprites[layerName]) {
        const spriteKey = `${layerName}.${layer.style}`;
        const baseTexture = this.textures.get(spriteKey);
        if (!baseTexture) return;

        const colorizedKey = await this.colorizeTexture(baseTexture, layerName, layer.color);
        
        // Update all direction sprites
        for (const [direction, sprite] of Object.entries(this.sprites[layerName])) {
          const currentAnim = sprite.anims.currentAnim;
          sprite.setTexture(colorizedKey);
          
          // Recreate animation with new texture
          const animKey = `${spriteKey}-${this.animationPrefix[direction as Direction]}`;
          if (this.anims.exists(animKey)) {
            this.anims.remove(animKey);
          }
          
          this.anims.create({
            key: animKey,
          frames: this.anims.generateFrameNumbers(colorizedKey, {
            frames: this.frameSequences[direction as Direction]
          }),
          frameRate: this.frameRates[direction as Direction],
            repeat: -1
          });

          if (currentAnim) {
            sprite.play(animKey);
          }
        }
      }
    }
  }

  shutdown() {
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
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameRef.current) {
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: 960,
          height: 280,  // Increased height to accommodate larger frames
        },
        parent: 'four-direction-container',
        scene: class extends FourDirectionScene {
          constructor() {
            super(layers, darkMode);
            this.setIsLoading = setIsLoading;
          }
        },
        transparent: true,
        pixelArt: true,
        backgroundColor: 'rgba(0, 0, 0, 0)'
      };

      gameRef.current = new Phaser.Game(config);
      sceneRef.current = gameRef.current.scene.getScene('FourDirectionScene') as FourDirectionScene;
    } else if (sceneRef.current) {
      sceneRef.current.updateColors(layers);
    }

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [layers, darkMode]);

  return (
    <div className="relative w-full h-full flex items-center justify-center rounded-lg overflow-hidden">
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
