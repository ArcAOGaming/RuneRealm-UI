import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { currentTheme } from '../../constants/theme';
import { Gateway } from '../../constants/Constants';

interface TokenAnimationProps {
  spriteMapTxid: string;
  alt: string;
  className?: string;
}

const TokenAnimation: React.FC<TokenAnimationProps> = ({ spriteMapTxid, alt, className = "w-6 h-6" }) => {
  const gameRef = useRef<HTMLDivElement>(null);
  const phaserGameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!gameRef.current || !spriteMapTxid) return;

    // Clean up any existing game instance
    if (phaserGameRef.current) {
      phaserGameRef.current.destroy(true);
      phaserGameRef.current = null;
    }

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: 24,
      height: 24,
      parent: gameRef.current,
      backgroundColor: 'transparent',
      audio: {
        disableWebAudio: true,
        noAudio: true
      },
      scene: {
        preload: function() {
          // Load the sprite sheet from the gateway
          const spriteUrl = `${Gateway}${spriteMapTxid}`;
          this.load.spritesheet('token', spriteUrl, {
            frameWidth: 64,
            frameHeight: 64
          });
        },
        create: function() {
          // Create animation frames (6 frames total)
          this.anims.create({
            key: 'tokenAnim',
            frames: this.anims.generateFrameNumbers('token', { start: 0, end: 5 }),
            frameRate: 8, // 8 frames per second for smooth animation
            repeat: -1 // Loop infinitely
          });

          // Create the sprite, scale it down to fit the 24x24 canvas, and center it
          const sprite = this.add.sprite(12, 12, 'token');
          sprite.setScale(0.375); // Scale down from 64px to 24px (24/64 = 0.375)
          sprite.play('tokenAnim');
        }
      },
      render: {
        transparent: true,
        antialias: true,
        pixelArt: false
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      }
    };

    // Create the Phaser game
    phaserGameRef.current = new Phaser.Game(config);

    // Cleanup function
    return () => {
      if (phaserGameRef.current) {
        phaserGameRef.current.destroy(true);
        phaserGameRef.current = null;
      }
    };
  }, [spriteMapTxid]);

  return (
    <div 
      ref={gameRef} 
      className={className}
      title={alt}
      style={{ 
        display: 'inline-block',
        overflow: 'hidden',
        borderRadius: '50%',
        width: '24px',
        height: '24px',
        position: 'relative'
      }}
    />
  );
};

export default TokenAnimation;
