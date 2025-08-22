import React, { useEffect, useRef, useState, useCallback } from 'react';

// ================ Type Definitions ================

/**
 * Effect types that can be displayed over the monster
 */
export type EffectType = 'Full Heal' | 'Large Heal' | 'Medium Heal' | 'Small Heal' | 'Revive' | 'Attack Boost' | 'Shield Boost' | null;

/**
 * Animation types for monster sprite
 */
type AnimationType = 'walkRight' | 'walkLeft' | 'walkUp' | 'walkDown' | 'attack1' | 'attack2' | 
                    'idle' | 'idleRight' | 'idleLeft' | 'sleep' | 'eat' | 'train' | 'play' | 'happy';

/**
 * Static poses when not animating
 */
type PoseType = 'right' | 'left';



/**
 * Animation control types for flexible animation handling
 */
type AnimationControlType = 'perpetual' | 'duration' | 'loops' | 'once';

/**
 * Animation control configuration
 */
interface AnimationControl {
  type: AnimationControlType;
  value?: number; // Duration in ms for 'duration', number of loops for 'loops'
}

/**
 * Props for the MonsterSpriteView component
 */
interface MonsterSpriteViewProps {
  sprite: string;                          // Filename for the sprite sheet
  currentAnimation?: AnimationType;        // Explicit animation to play
  animationControl?: AnimationControl;     // How to control the animation (perpetual, duration, loops, once)
  scale?: number;                          // Scale factor for monster and effects (default: 1.0)
  pose?: PoseType;                         // Static pose when not animating
  onAnimationComplete?: () => void;        // Callback when animation completes
  isOpponent?: boolean;                    // Used to determine facing direction
  containerWidth?: number;                 // Width of container for scaling calculations
  containerHeight?: number;                // Height of container for animation positioning
  effect?: EffectType;                     // Current effect to display
  onEffectComplete?: () => void;           // Callback when effect animation completes
}

// ================ Constants ================

// Sprite sheet constants
const FRAME_WIDTH = 64;                    // Width of each sprite frame in pixels
const FRAME_HEIGHT = 64;                   // Height of each sprite frame in pixels
const FRAMES_PER_ANIMATION = 4;            // Number of frames per animation cycle
const ANIMATION_ROWS = 6;                  // Number of animation rows in the sprite sheet
const ANIMATION_SPEED = 250;               // Duration per frame in milliseconds (1000 / 4 = 250ms)

// ================ Effect Animation Logic ================

/**
 * Props for the EffectAnimation component
 */
interface EffectAnimationProps {
  effect: EffectType;                // Type of effect to display
  onComplete: () => void;           // Callback when animation completes
  containerWidth: number;           // Container width for scaling
  containerHeight: number;          // Container height for scaling
  scale?: number;                   // Additional scale factor (default: 1.0)
}

/**
 * Constants for effect animations
 */
const EFFECT_CONSTANTS = {
  FRAME_COUNT: 8,                   // Number of frames in effect animations
  FRAME_SIZE: 64,                   // Size of each effect frame in pixels
  FRAME_DURATION: 100               // Duration per effect frame in milliseconds
};

/**
 * Hook to manage effect animation state and logic
 */
const useEffectAnimation = (effect: EffectType, onComplete: () => void) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const effectRef = useRef<HTMLImageElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastUpdateTime = useRef<number>(0);
  const isMounted = useRef(true);
  const hasCompleted = useRef(false);
  
  // Cleanup on unmount
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Handle effect animation
  useEffect(() => {
    console.log('[EFFECT DEBUG] Starting effect animation for:', effect);
    if (!effect) return;
    
    // Clear any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    // Reset animation state
    setCurrentFrame(0);
    lastUpdateTime.current = performance.now();
    hasCompleted.current = false;

    // Load the effect image
    const img = new Image();
    img.src = new URL(`../../assets/effects/${effect}.png`, import.meta.url).href;
    effectRef.current = img;
    
    // Animation loop function
    const animate = (timestamp: number) => {
      if (!isMounted.current) return;
      
      if (!lastUpdateTime.current) lastUpdateTime.current = timestamp;
      
      const delta = timestamp - lastUpdateTime.current;
      
      if (delta >= EFFECT_CONSTANTS.FRAME_DURATION) {
        setCurrentFrame(prev => {
          const nextFrame = prev + 1;
          // Check if animation is complete
          if (nextFrame >= EFFECT_CONSTANTS.FRAME_COUNT) {
            if (!hasCompleted.current) {
              hasCompleted.current = true;
              // Defer onComplete callback to avoid setState during render
              setTimeout(() => {
                if (isMounted.current) {
                  onComplete();
                }
              }, 0);
            }
            return prev; // Stay on last frame
          }
          return nextFrame;
        });
        lastUpdateTime.current = timestamp;
      }
      
      // Continue animation loop until we've completed all frames
      if (!hasCompleted.current) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    // Start animation
    animationRef.current = requestAnimationFrame(animate);

    // Cleanup function
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [effect, onComplete]);

  return { 
    currentFrame, 
    effectRef, 
    FRAME_COUNT: EFFECT_CONSTANTS.FRAME_COUNT, 
    FRAME_SIZE: EFFECT_CONSTANTS.FRAME_SIZE 
  };
};

/**
 * Component that renders an effect animation over the monster
 */
const EffectAnimation: React.FC<EffectAnimationProps> = React.memo(({ 
  effect, 
  onComplete,
  containerWidth,
  containerHeight,
  scale = 1.0
}) => {
  const { currentFrame, effectRef, FRAME_COUNT, FRAME_SIZE } = 
    useEffectAnimation(effect, onComplete);

  // Don't render anything if no effect is provided
  if (!effect) return null;

  // Calculate the scale based on container dimensions and user scale
  // Use same approach as monster sprite: ensure 4x space and apply user scale
  const baseEffectScale = Math.min(containerWidth / (FRAME_SIZE * 4), containerHeight / (FRAME_SIZE * 4));
  const finalEffectScale = Math.max(baseEffectScale, 1.0) * scale;

  return (
    <div 
      className="effect-animation" 
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        top: 0,
        left: 0,
        zIndex: 10,
        pointerEvents: 'none',
        overflow: 'visible',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div 
        style={{
          width: `${FRAME_SIZE}px`,
          height: `${FRAME_SIZE}px`,
          backgroundImage: effectRef.current ? `url(${effectRef.current.src})` : 'none',
          backgroundPosition: `-${currentFrame * FRAME_SIZE}px 0`,
          backgroundSize: `${FRAME_SIZE * FRAME_COUNT}px ${FRAME_SIZE}px`,
          backgroundRepeat: 'no-repeat',
          imageRendering: 'pixelated',
          transform: `scale(${finalEffectScale})`,
          transformOrigin: 'center center',
        }} 
      />
    </div>
  );
});

const MonsterSpriteView: React.FC<MonsterSpriteViewProps> = ({
  sprite,
  currentAnimation,
  animationControl = { type: 'perpetual' },
  scale = 1.0,
  pose = 'right',
  onAnimationComplete,
  isOpponent = false,
  containerWidth = 256,
  containerHeight = 256,
  effect,
  onEffectComplete
}) => {
  // Effect completion handling - completely independent of monster animation
  // No local effect state - use external effect directly to prevent interruption
  const handleEffectComplete = useCallback(() => {
    console.log('[EFFECT DEBUG] Effect animation completed:', effect);
    if (onEffectComplete) {
      onEffectComplete();
    }
  }, [onEffectComplete, effect]);
  
  // Log when effect prop changes
  useEffect(() => {
    console.log('[EFFECT DEBUG] MonsterSpriteView received effect:', effect);
    if (effect) {
      console.log('[EFFECT DEBUG] Sprite for effect:', sprite);
    }
  }, [effect, sprite]);

  // Monster animation state - completely separate from effect system
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spriteImage, setSpriteImage] = useState<HTMLImageElement | null>(null);
  const animationFrameRef = useRef<number>(0);
  const currentFrameRef = useRef<number>(0);
  const animationTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Direction state for animations
  const [direction, setDirection] = useState<'right' | 'left'>('right');
  
  // Animation control state to prevent conflicts
  const animationControllerRef = useRef<{
    currentAnimation: AnimationType | null;
    isRunning: boolean;
    cleanup: (() => void) | null;
  }>({ currentAnimation: null, isRunning: false, cleanup: null });

  // Load sprite sheet from local assets
  useEffect(() => {
    const img = new Image();
    img.src = new URL(`../../assets/sprites/${sprite}.png`, import.meta.url).href;
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
      case 'idle': 
        // For idle, we'll use the same row as the last direction
        return direction === 'left' ? 1 : 0; // Use walkLeft or walkRight row based on direction
      case 'idleRight': return 0; // Use walkRight row for right-facing idle
      case 'idleLeft': return 1;  // Use walkLeft row for left-facing idle
      case 'sleep': return 3; // Use walkDown row
      case 'eat': return 3;  // Use walkDown row
      case 'train': return 4; // Use attack1 row
      case 'play': return 0;  // Use walkRight row
      case 'happy': return 2; // Use walkUp row
    }
  };

  // Draw current frame - this is the ONLY function that should modify the canvas
  const drawFrame = (ctx: CanvasRenderingContext2D, frameIndex: number, row: number, animationType?: AnimationType) => {
    if (!spriteImage) return;
    
    // For idle animations, always use the first frame
    const frameToUse = (animationType === 'idle' || animationType === 'idleRight' || animationType === 'idleLeft') ? 0 : frameIndex;
    
    ctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    ctx.drawImage(
      spriteImage,
      frameToUse * FRAME_WIDTH,
      row * FRAME_HEIGHT,
      FRAME_WIDTH,
      FRAME_HEIGHT,
      0,
      0,
      FRAME_WIDTH,
      FRAME_HEIGHT
    );
  };

  // Enhanced animation controller with flexible control options
  const startAnimation = useCallback((animationType: AnimationType, control: AnimationControl = { type: 'perpetual' }) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] MonsterSpriteView.startAnimation: Starting '${animationType}' with control:`, control);
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !spriteImage) {
      console.log(`[${timestamp}] MonsterSpriteView.startAnimation: Missing dependencies - canvas:`, !!canvas, 'ctx:', !!ctx, 'spriteImage:', !!spriteImage);
      return;
    }

    // Stop any existing animation
    if (animationControllerRef.current.cleanup) {
      console.log(`[${timestamp}] MonsterSpriteView.startAnimation: Cleaning up previous animation:`, animationControllerRef.current.currentAnimation);
      animationControllerRef.current.cleanup();
    }

    const controller = animationControllerRef.current;
    controller.currentAnimation = animationType;
    controller.isRunning = true;

    const row = getAnimationRow(animationType);
    let startTime: number | null = null;
    let frame = 0;
    let cycleCount = 0;
    let durationTimeout: NodeJS.Timeout | null = null;

    // Set up duration-based timeout if needed
    if (control.type === 'duration' && control.value) {
      console.log(`[${timestamp}] MonsterSpriteView.startAnimation: Setting duration timeout for ${control.value}ms`);
      durationTimeout = setTimeout(() => {
        const endTimestamp = new Date().toISOString();
        console.log(`[${endTimestamp}] MonsterSpriteView.startAnimation: Duration timeout reached for '${animationType}'`);
        controller.isRunning = false;
        if (onAnimationComplete) {
          onAnimationComplete();
        }
      }, control.value);
    }

    const animate = (timestamp: number) => {
      if (!controller.isRunning || controller.currentAnimation !== animationType) {
        const stopTimestamp = new Date().toISOString();
        console.log(`[${stopTimestamp}] MonsterSpriteView.animate: Animation stopped - isRunning:`, controller.isRunning, 'currentAnimation:', controller.currentAnimation, 'expected:', animationType);
        return; // Animation was stopped or changed
      }

      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const currentFrame = Math.floor((elapsed / ANIMATION_SPEED) % FRAMES_PER_ANIMATION);
      
      if (currentFrame !== frame) {
        frame = currentFrame;
        drawFrame(ctx, frame, row, animationType);
        currentFrameRef.current = frame;

        // Check for cycle completion
        if (frame === 0 && elapsed > 0) {
          cycleCount++;
          const cycleTimestamp = new Date().toISOString();
          console.log(`[${cycleTimestamp}] MonsterSpriteView.animate: Cycle ${cycleCount} completed for '${animationType}' with control type '${control.type}'`);
          
          // Handle different control types
          let shouldStop = false;
          
          switch (control.type) {
            case 'once':
              shouldStop = cycleCount >= 1;
              console.log(`[${cycleTimestamp}] MonsterSpriteView.animate: 'once' control - shouldStop:`, shouldStop);
              break;
            case 'loops':
              shouldStop = control.value ? cycleCount >= control.value : false;
              console.log(`[${cycleTimestamp}] MonsterSpriteView.animate: 'loops' control (${control.value}) - shouldStop:`, shouldStop);
              break;
            case 'duration':
              // Duration is handled by timeout, don't stop here
              shouldStop = false;
              console.log(`[${cycleTimestamp}] MonsterSpriteView.animate: 'duration' control - continuing until timeout`);
              break;
            case 'perpetual':
            default:
              shouldStop = false;
              console.log(`[${cycleTimestamp}] MonsterSpriteView.animate: 'perpetual' control - continuing indefinitely`);
              break;
          }
          
          if (shouldStop) {
            console.log(`[${cycleTimestamp}] MonsterSpriteView.animate: Stopping animation '${animationType}' after ${cycleCount} cycles`);
            controller.isRunning = false;
            if (onAnimationComplete) {
              onAnimationComplete();
            }
            return;
          }
        }
      }

      if (controller.isRunning) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    // Set up cleanup function
    controller.cleanup = () => {
      controller.isRunning = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = 0;
      }
      if (durationTimeout) {
        clearTimeout(durationTimeout);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [spriteImage, onAnimationComplete]);

  // Handle explicitly provided animation using enhanced controller
  useEffect(() => {
    const timestamp = new Date().toISOString();
    
    if (!spriteImage || !currentAnimation) {
      console.log(`[${timestamp}] MonsterSpriteView: Skipping animation - spriteImage:`, !!spriteImage, 'currentAnimation:', currentAnimation);
      return;
    }
    
    console.log(`[${timestamp}] MonsterSpriteView: Starting animation:`, currentAnimation, 'with control:', animationControl);
    
    // Use the enhanced animation controller with the provided control settings
    startAnimation(currentAnimation, animationControl);

    return () => {
      const cleanupTimestamp = new Date().toISOString();
      console.log(`[${cleanupTimestamp}] MonsterSpriteView: Cleaning up animation:`, currentAnimation);
      if (animationControllerRef.current.cleanup) {
        animationControllerRef.current.cleanup();
      }
    };
  }, [currentAnimation, animationControl, spriteImage, startAnimation]);

  // Draw idle frame when no animation is playing
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !spriteImage) return;

    if (!currentAnimation) {
      const timestamp = new Date().toISOString();
      const poseAnimation = direction === 'left' ? 'walkLeft' : 'walkRight';
      console.log(`[${timestamp}] MonsterSpriteView: Drawing idle frame with direction:`, direction, 'poseAnimation:', poseAnimation);
      // Use the last known direction for idle pose
      drawFrame(ctx, 0, getAnimationRow(poseAnimation), 'idle');
    }
  }, [spriteImage, currentAnimation, isOpponent, direction]);

  // Calculate base scale to fit container, but ensure minimum 2x space for scaling
  const baseScale = Math.min(containerWidth / (FRAME_WIDTH * 2), containerHeight / (FRAME_HEIGHT * 2));
  // Apply user-defined scale on top of base scale, clamped to 0.5x-2x range
  const clampedScale = Math.max(0.5, Math.min(2.0, scale));
  const finalScale = Math.max(baseScale, 1.0) * clampedScale;
  const scaledWidth = FRAME_WIDTH * finalScale;
  const scaledHeight = FRAME_HEIGHT * finalScale;

  return (
    <div 
      className="monster-sprite-container relative"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      <div 
        style={{
          position: 'relative',
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
          transform: `
            scale(${finalScale})
            ${isOpponent ? 'scaleX(-1)' : ''}
          `,
          transition: 'transform 0.3s ease',
        }}
      >
        <canvas
          ref={canvasRef}
          width={FRAME_WIDTH}
          height={FRAME_HEIGHT}
          className="pixelated"
          style={{
            width: '100%',
            height: '100%',
            imageRendering: 'pixelated',
            position: 'relative',
            zIndex: 1,
          }}
        />
      </div>
      
      {/* Effect animation container - positioned absolutely over the monster */}
      {effect && (
        <div 
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <EffectAnimation 
            effect={effect} 
            onComplete={handleEffectComplete}
            containerWidth={containerWidth}
            containerHeight={containerHeight}
            scale={scale}
          />
        </div>
      )}
    </div>
  );
};

export default MonsterSpriteView;
