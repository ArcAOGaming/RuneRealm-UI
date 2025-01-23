import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { hexToRgb, matchesGreyShade, calculateColorShade, getGreyLevel } from '../utils/colorMapping';
import { SpriteColorizer } from '../utils/spriteColorizer';

interface PreviewCanvasProps {
  layers: {
    [key: string]: {
      style: string;
      color: string;
    };
  };
  darkMode?: boolean;
}

type Direction = 'forward' | 'left' | 'right' | 'back';

class SpritePreviewScene extends Phaser.Scene {
  private sprites: { [key: string]: { [direction in Direction]: Phaser.GameObjects.Sprite } } = {};
  private textures: { [key: string]: HTMLCanvasElement } = {};
  private layers: PreviewCanvasProps['layers'];
  private animationPrefix: { [key in Direction]: string } = {
    forward: 'walk-down',
    left: 'walk-left',
    right: 'walk-right',
    back: 'walk-up'
  };
  private darkMode: boolean;
  setIsLoading: (isLoading: boolean) => void;

  constructor(layers: PreviewCanvasProps['layers'], darkMode: boolean) {
    super({ key: 'SpritePreviewScene' });
    this.layers = layers;
    this.darkMode = darkMode;
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
      forward: { x: 108, y: 255 },
      left: { x: 108, y: 75 },
      right: { x: 324, y: 75 },
      back: { x: 324, y: 255 }
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
      width: 200,
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
      color: '#000000',
      fontSize: '24px',
      fontWeight: 'bold',
      fontFamily: 'Arial'
    };

    this.add.text(108, positions.left.y - frameStyle.height/2 + 30, 'Left', labelStyle).setOrigin(0.5);
    this.add.text(324, positions.left.y - frameStyle.height/2 + 30, 'Right', labelStyle).setOrigin(0.5);
    this.add.text(108, positions.forward.y - frameStyle.height/2 + 30, 'Forward', labelStyle).setOrigin(0.5);
    this.add.text(324, positions.forward.y - frameStyle.height/2 + 30, 'Back', labelStyle).setOrigin(0.5);

    // Initialize sprite containers
    this.sprites['BASE'] = {};

    // Create base sprites and animations for each direction
    directions.forEach(dir => {
      // Create base sprite for this direction
      this.sprites['BASE'][dir] = this.add.sprite(positions[dir].x, positions[dir].y, 'BASE');
      this.sprites['BASE'][dir].setOrigin(0.5, 0.5);
      this.sprites['BASE'][dir].setScale(3); // Make sprites even larger

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

    // Create layer sprites and their animations
    Object.entries(this.layers).forEach(([layerName, layer]) => {
      const spriteKey = `${layerName}.${layer.style}`;
      this.sprites[layerName] = {};
      
      // Create a new texture with color replacement
      const colorizedKey = this.colorizeTexture(this.textures.get(spriteKey), layerName, layer.color);
      
      // Create sprites and animations for each direction
      directions.forEach(dir => {
        // Create sprite for this direction
        this.sprites[layerName][dir] = this.add.sprite(
          positions[dir].x,
          positions[dir].y,
          colorizedKey
        );
        this.sprites[layerName][dir].setOrigin(0.5, 0.5);
        this.sprites[layerName][dir].setScale(3); // Make sprites even larger

        // Create animation
        this.anims.create({
          key: `${spriteKey}-${this.animationPrefix[dir]}`,
          frames: this.anims.generateFrameNumbers(colorizedKey, {
            frames: frameSequences[dir]
          }),
          frameRate: frameRates[dir],
          repeat: -1
        });

        // Start the animation immediately
        this.sprites[layerName][dir].play(`${spriteKey}-${this.animationPrefix[dir]}`);
      });
    });
  }

  private colorizeTexture(texture: Phaser.Textures.Texture, layerName: string, color: string) {
    const key = `${layerName}_${color}`;
    
    // Check if we already have this colorized texture
    if (this.textures.exists(key)) {
      return key;
    }

    // Create a temporary canvas to get image data
    const tempCanvas = document.createElement('canvas');
    const sourceImage = texture.getSourceImage();
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

    // Add the colorized texture to Phaser's texture manager with spritesheet config
    this.textures.addSpriteSheet(key, colorizedCanvas, {
      frameWidth: 48,
      frameHeight: 60
    });

    return key;
  }

  updateColors(newLayers: PreviewCanvasProps['layers']) {
    Object.entries(newLayers).forEach(([layerName, layer]) => {
      if (this.sprites[layerName]) {
        const spriteKey = `${layerName}.${layer.style}`;
        const baseTexture = this.textures.get(spriteKey);
        if (!baseTexture) return;

        const colorizedKey = this.colorizeTexture(baseTexture, layerName, layer.color);
        
        // Update all direction sprites
        Object.entries(this.sprites[layerName]).forEach(([direction, sprite]) => {
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
              frames: frameSequences[direction as Direction]
            }),
            frameRate: frameRates[direction as Direction],
            repeat: -1
          });

          if (currentAnim) {
            sprite.play(animKey);
          }
        });
      }
    });
  }

  destroy() {
    Object.values(this.textures).forEach(canvas => {
      canvas.remove();
    });
    super.destroy();
  }
}

const PreviewCanvas: React.FC<PreviewCanvasProps> = ({ layers, darkMode = false }) => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<SpritePreviewScene | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameRef.current) {
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        width: 432,
        height: 360,
        parent: 'phaser-container',
        scene: class extends SpritePreviewScene {
          constructor() {
            super(layers, darkMode);
            this.setIsLoading = setIsLoading;
          }
        },
        transparent: true,
        pixelArt: true,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH
        },
        backgroundColor: 'rgba(0, 0, 0, 0)'
      };

      gameRef.current = new Phaser.Game(config);
      sceneRef.current = gameRef.current.scene.getScene('SpritePreviewScene') as SpritePreviewScene;
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
    <div className="relative w-full flex-1 min-h-[360px] flex items-center justify-center rounded-lg">
      <div id="phaser-container" className="w-[432px] h-[360px]" />
      {isLoading && (
        <div className={`absolute inset-0 flex items-center justify-center bg-gray-800/75`}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-500" />
        </div>
      )}
    </div>
  );
};

export default PreviewCanvas;