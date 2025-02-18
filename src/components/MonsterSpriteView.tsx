import React, { useEffect, useRef, useState } from 'react';

type AnimationType = 'walkRight' | 'walkLeft' | 'walkUp' | 'walkDown' | 'attack1' | 'attack2';
type PoseType = 'right' | 'left';

interface MonsterSpriteViewProps {
  sprite: string; // Arweave transaction ID for the sprite sheet
  currentAnimation?: AnimationType;
  pose?: PoseType; // Static pose when not animating
  onAnimationComplete?: () => void;
  isOpponent?: boolean; // Used to determine facing direction
}

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 64;
const FRAMES_PER_ANIMATION = 4;
const ANIMATION_ROWS = 6;
const ANIMATION_SPEED = 1000 / 4; // 1 second total divided by 4 frames = 250ms per frame

const MonsterSpriteView: React.FC<MonsterSpriteViewProps> = ({ 
  sprite, 
  currentAnimation,
  pose,
  onAnimationComplete,
  isOpponent = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spriteImage, setSpriteImage] = useState<HTMLImageElement | null>(null);
  const animationFrameRef = useRef<number>(0);
  const currentFrameRef = useRef<number>(0);
  const animationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load sprite sheet from local assets
  useEffect(() => {
    const img = new Image();
    img.src = new URL(`../assets/sprites/${sprite}.png`, import.meta.url).href;
    img.onload = () => setSpriteImage(img);
    return () => {
      img.onload = null;
    };
  }, [sprite]);

  // Animation mapping
  const getAnimationRow = (type: AnimationType): number => {
    switch (type) {
      case 'walkRight': return 0;
      case 'walkLeft': return 1;
      case 'walkUp': return 2;
      case 'walkDown': return 3;
      case 'attack1': return 4;
      case 'attack2': return 5;
    }
  };

  // Draw current frame
  const drawFrame = (ctx: CanvasRenderingContext2D, frameIndex: number, row: number) => {
    if (!spriteImage) return;
    
    ctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    ctx.drawImage(
      spriteImage,
      frameIndex * FRAME_WIDTH,
      row * FRAME_HEIGHT,
      FRAME_WIDTH,
      FRAME_HEIGHT,
      0,
      0,
      FRAME_WIDTH,
      FRAME_HEIGHT
    );
  };

  // Handle animation
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !spriteImage || !currentAnimation) return;

    const row = getAnimationRow(currentAnimation);
    let frame = 0;

    const animate = () => {
      drawFrame(ctx, frame, row);
      frame = (frame + 1) % FRAMES_PER_ANIMATION;
      currentFrameRef.current = frame;

      if (frame === 0 && currentAnimation.startsWith('attack')) {
        // Stop attack animations after one cycle
        if (onAnimationComplete) {
          onAnimationComplete();
        }
        return;
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    // Start animation with precise timing
    const startAnimation = () => {
      let startTime: number | null = null;
      let frame = 0;
      let cycleCount = 0;

      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const currentFrame = Math.floor((elapsed / ANIMATION_SPEED) % FRAMES_PER_ANIMATION);
        
        if (currentFrame !== frame) {
          frame = currentFrame;
          drawFrame(ctx, frame, row);
          currentFrameRef.current = frame;

          // Check for cycle completion
          if (frame === 0 && elapsed > 0) {
            cycleCount++;
            // For attack animations, complete after one cycle
            if (currentAnimation.startsWith('attack') && cycleCount >= 4) { // 4 cycles = 2 seconds
              if (onAnimationComplete) {
                onAnimationComplete();
              }
              return;
            }
          }
        }

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    startAnimation();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [spriteImage, currentAnimation, onAnimationComplete]);

  // Draw idle frame when no animation is playing
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !spriteImage) return;

    if (!currentAnimation) {
      // Always use walkRight as the default pose
      const poseAnimation = 'walkRight';
      drawFrame(ctx, 0, getAnimationRow(poseAnimation));
    }
  }, [spriteImage, currentAnimation, isOpponent]);

  return (
    <canvas
      ref={canvasRef}
      width={FRAME_WIDTH}
      height={FRAME_HEIGHT}
      className="pixelated" // Ensure pixel-perfect scaling
      style={{
        width: FRAME_WIDTH * 3.75, // Scale up 3.75x for better visibility
        height: FRAME_HEIGHT * 3.75,
        imageRendering: 'pixelated',
        transform: isOpponent ? 'scaleX(-1)' : undefined // Flip opponent sprites horizontally
      }}
    />
  );
};

export default MonsterSpriteView;
