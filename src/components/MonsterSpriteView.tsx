import React, { useEffect, useRef, useState } from 'react';

type AnimationType = 'walkRight' | 'walkLeft' | 'walkUp' | 'walkDown' | 'attack1' | 'attack2';

interface MonsterSpriteViewProps {
  spriteId: number; // 1-4 for different sprite sheets
  currentAnimation?: AnimationType;
  onAnimationComplete?: () => void;
  isOpponent?: boolean; // Used to determine facing direction
}

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 64;
const FRAMES_PER_ANIMATION = 4;
const ANIMATION_ROWS = 6;
const ANIMATION_SPEED = 750; // Slower animation speed (750ms per frame)

const MonsterSpriteView: React.FC<MonsterSpriteViewProps> = ({ 
  spriteId, 
  currentAnimation,
  onAnimationComplete,
  isOpponent = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sprite, setSprite] = useState<HTMLImageElement | null>(null);
  const animationFrameRef = useRef<number>(0);
  const currentFrameRef = useRef<number>(0);
  const animationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load sprite sheet
  useEffect(() => {
    const img = new Image();
    img.src = `/src/assets/sprites/${spriteId}.png`;
    img.onload = () => setSprite(img);
    return () => {
      img.onload = null;
    };
  }, [spriteId]);

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
    if (!sprite) return;
    
    ctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    ctx.drawImage(
      sprite,
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
    if (!canvas || !ctx || !sprite || !currentAnimation) return;

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

    // Start animation loop with consistent timing
    const startAnimation = () => {
      if (animationTimerRef.current) {
        clearInterval(animationTimerRef.current);
      }
      animationTimerRef.current = setInterval(() => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        animate();
      }, ANIMATION_SPEED);
    };

    startAnimation();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (animationTimerRef.current) {
        clearInterval(animationTimerRef.current);
      }
    };
  }, [sprite, currentAnimation, onAnimationComplete]);

  // Draw idle frame when no animation is playing
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !sprite) return;

    if (!currentAnimation) {
      // Default to facing each other when idle
      const idleAnimation = isOpponent ? 'walkLeft' : 'walkRight';
      drawFrame(ctx, 0, getAnimationRow(idleAnimation));
    }
  }, [sprite, currentAnimation, isOpponent]);

  return (
    <canvas
      ref={canvasRef}
      width={FRAME_WIDTH}
      height={FRAME_HEIGHT}
      className="pixelated" // Ensure pixel-perfect scaling
      style={{
        width: FRAME_WIDTH * 2, // Scale up 2x for better visibility
        height: FRAME_HEIGHT * 2,
        imageRendering: 'pixelated',
        transform: isOpponent ? 'scaleX(-1)' : undefined // Flip opponent sprites horizontally
      }}
    />
  );
};

export default MonsterSpriteView;
