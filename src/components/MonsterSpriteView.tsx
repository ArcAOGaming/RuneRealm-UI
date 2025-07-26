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
                    'idle' | 'sleep' | 'eat' | 'train' | 'play' | 'happy';

/**
 * Static poses when not animating
 */
type PoseType = 'right' | 'left';

/**
 * Animation behavior modes that control how the sprite moves
 */
type BehaviorMode = 'static' | 'pacing' | 'activity';

/**
 * Props for the MonsterSpriteView component
 */
interface MonsterSpriteViewProps {
  sprite: string;                          // Filename for the sprite sheet
  currentAnimation?: AnimationType;        // Explicit animation to play
  pose?: PoseType;                         // Static pose when not animating
  onAnimationComplete?: () => void;        // Callback when animation completes
  isOpponent?: boolean;                    // Used to determine facing direction
  behaviorMode?: BehaviorMode;             // Controls how the sprite behaves
  activityType?: string;                   // Type of activity the monster is doing
  containerWidth?: number;                 // Width of container for pacing calculations
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
    img.src = new URL(`../assets/effects/${effect}.png`, import.meta.url).href;
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
              onComplete();
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
  containerHeight
}) => {
  const { currentFrame, effectRef, FRAME_COUNT, FRAME_SIZE } = 
    useEffectAnimation(effect, onComplete);

  // Don't render anything if no effect is provided
  if (!effect) return null;

  // Calculate the scale based on container dimensions
  const scale = Math.min(containerWidth, containerHeight) / FRAME_SIZE;

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
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }} 
      />
    </div>
  );
});

const MonsterSpriteView: React.FC<MonsterSpriteViewProps> = ({ 
  sprite, 
  currentAnimation,
  pose,
  onAnimationComplete,
  isOpponent = false,
  behaviorMode = 'static',
  activityType,
  containerWidth = FRAME_WIDTH * 4,
  containerHeight = FRAME_HEIGHT * 4,
  effect: externalEffect,
  onEffectComplete
}) => {
  const [effect, setEffect] = useState<EffectType>(externalEffect);
  
  // Log when effect prop changes
  useEffect(() => {
    console.log('[EFFECT DEBUG] MonsterSpriteView received effect:', externalEffect);
    if (externalEffect) {
      console.log('[EFFECT DEBUG] Sprite for effect:', sprite);
    }
  }, [externalEffect, sprite]);

  const effectCompletedRef = useRef(false);

  // Handle external effect changes
  useEffect(() => {
    if (externalEffect && externalEffect !== effect) {
      effectCompletedRef.current = false;
      setEffect(externalEffect);
    }
  }, [externalEffect, effect]);

  // Handle effect completion
  const handleEffectComplete = useCallback(() => {
    console.log('[EFFECT DEBUG] Effect animation completed');
    setEffect(null);
    if (onEffectComplete) {
      onEffectComplete();
    }
  }, [onEffectComplete]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spriteImage, setSpriteImage] = useState<HTMLImageElement | null>(null);
  const animationFrameRef = useRef<number>(0);
  const currentFrameRef = useRef<number>(0);
  const animationTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Position state for animations
  const [position, setPosition] = useState(0); // For pacing (horizontal only)
  const [positionX, setPositionX] = useState(containerWidth / 2); // For 2D movement
  const [positionY, setPositionY] = useState(containerHeight / 2); // For 2D movement
  const [direction, setDirection] = useState<'right' | 'left'>('right');
  const [currentBehavior, setCurrentBehavior] = useState<AnimationType | null>(null);
  const [activityAnimation, setActivityAnimation] = useState<AnimationType | null>(null);
  const randomPauseDurationRef = useRef<number>(Math.floor(Math.random() * 3000) + 2000);

  // Load sprite sheet from local assets
  useEffect(() => {
    const img = new Image();
    img.src = new URL(`../assets/sprites/${sprite}.png`, import.meta.url).href;
    img.onload = () => setSpriteImage(img);
    return () => {
      img.onload = null;
    };
  }, [sprite]);

  // Map activity types to appropriate animations
  const getActivityAnimation = useCallback((activity: string | undefined): AnimationType => {
    if (!activity) return 'idle';
    
    switch (activity) {
      case 'Play': return 'play';
      case 'Mission': return 'walkUp';
      case 'Battle': return 'attack1';
      default: return 'idle';
    }
  }, []);

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
      case 'sleep': return 3; // Use walkDown row
      case 'eat': return 3;  // Use walkDown row
      case 'train': return 4; // Use attack1 row
      case 'play': return 0;  // Use walkRight row
      case 'happy': return 2; // Use walkUp row
    }
  };

  // Draw current frame
  const drawFrame = (ctx: CanvasRenderingContext2D, frameIndex: number, row: number, animationType?: AnimationType) => {
    if (!spriteImage) return;
    
    // For idle animation, always use the first frame
    const frameToUse = (animationType === 'idle') ? 0 : frameIndex;
    
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

  // Handle explicitly provided animation
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !spriteImage || !currentAnimation) return;

    const row = getAnimationRow(currentAnimation);
    let frame = 0;

    const animate = () => {
      drawFrame(ctx, frame, row, currentAnimation);
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
          drawFrame(ctx, frame, row, currentAnimation);
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
  
  // Handle behavior-based animations
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !spriteImage || currentAnimation) return;
    
    let animation: AnimationType | null = null;
    
    // Determine which animation to use based on behavior mode
    if (behaviorMode === 'pacing' && currentBehavior) {
      animation = currentBehavior;
    } else if (behaviorMode === 'activity' && activityAnimation) {
      animation = activityAnimation;
    }
    
    if (!animation) return;
    
    const row = getAnimationRow(animation);
    let frame = 0;
    
    const startAnimation = () => {
      let startTime: number | null = null;
      
      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const currentFrame = Math.floor((elapsed / ANIMATION_SPEED) % FRAMES_PER_ANIMATION);
        
        if (currentFrame !== frame) {
          frame = currentFrame;
          drawFrame(ctx, frame, row);
          currentFrameRef.current = frame;
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
  }, [spriteImage, currentAnimation, currentBehavior, activityAnimation, behaviorMode]);

  // Pacing animation logic
  useEffect(() => {
    if (behaviorMode !== 'pacing' || !spriteImage || currentAnimation) return;
    
    let pacingTimer: NodeJS.Timeout;
    let pauseTimer: NodeJS.Timeout;
    let isPaused = false;
    let isMoving = false;
    
    const updatePosition = () => {
      if (isPaused) return;
      
      if (isMoving) {
        setPosition(prevPos => {
          let newPos = prevPos;
          const movementRate = 5; // Maximum movement speed for very fast walking
          
          if (direction === 'right') {
            newPos += movementRate;
            if (newPos >= containerWidth - FRAME_WIDTH * 3) {
              // Reached right boundary, now pause before turning
              isMoving = false;
              setCurrentBehavior('idle');
              setTimeout(() => {
                setDirection('left');
                setCurrentBehavior('walkLeft');
                isMoving = true;
              }, Math.floor(Math.random() * 1000) + 500); // Random pause before turning
            }
          } else {
            newPos -= movementRate;
            if (newPos <= 0) {
              // Reached left boundary, now pause before turning
              isMoving = false;
              setCurrentBehavior('idle');
              setTimeout(() => {
                setDirection('right');
                setCurrentBehavior('walkRight');
                isMoving = true;
              }, Math.floor(Math.random() * 1000) + 500); // Random pause before turning
            }
          }
          
          return newPos;
        });
      }
    };
    
    const togglePause = () => {
      isPaused = !isPaused;
      isMoving = !isPaused;
      
      if (isPaused) {
        // Switch to idle animation when paused
        setCurrentBehavior('idle');
        randomPauseDurationRef.current = Math.floor(Math.random() * 3000) + 2000;
        pauseTimer = setTimeout(() => {
          isPaused = false;
          isMoving = true;
          setCurrentBehavior(direction === 'right' ? 'walkRight' : 'walkLeft');
        }, randomPauseDurationRef.current);
      }
    };
    
    // Start with idle animation briefly, then start moving
    setCurrentBehavior('idle');
    setTimeout(() => {
      setCurrentBehavior(direction === 'right' ? 'walkRight' : 'walkLeft');
      isMoving = true;
    }, 1500);
    
    pacingTimer = setInterval(() => {
      updatePosition();
      
      // Randomly decide to pause (only if currently moving)
      if (isMoving && !isPaused && Math.random() < 0.01) { // 1% chance to pause per interval
        togglePause();
      }
    }, 33); // Faster update interval for smoother motion
    
    return () => {
      clearInterval(pacingTimer);
      clearTimeout(pauseTimer);
    };
  }, [behaviorMode, containerWidth, direction, spriteImage, currentAnimation]);

  // Activity animation logic
  useEffect(() => {
    if (behaviorMode !== 'activity' || !spriteImage || currentAnimation) return;
    
    // Set the initial animation based on activity type
    const baseAnimation = getActivityAnimation(activityType);
    setActivityAnimation(baseAnimation);
    
    // Track whether monster is in a movement animation
    const isMovementAnimation = (anim: AnimationType) => {
      return anim === 'walkRight' || anim === 'walkLeft' || anim === 'walkUp' || anim === 'walkDown';
    };
    
    // Position management for movement animations
    let moveTimerId: NodeJS.Timeout;
    let currentPos = { x: containerWidth / 2, y: containerHeight / 2 };
    let targetPos = { x: currentPos.x, y: currentPos.y };
    let isMoving = false;
    
    // Function to move monster around during activity
    const moveMonster = () => {
      if (isMovementAnimation(baseAnimation) && Math.random() < 0.4) { // 40% chance to move
        isMoving = true;
        // Calculate a random target position within container bounds
        targetPos = {
          x: Math.random() * (containerWidth - FRAME_WIDTH * 3.5),
          y: Math.min(containerHeight * 0.6, Math.max(containerHeight * 0.2, Math.random() * containerHeight * 0.4))
        };
        
        // Determine which direction to walk based on target position
        if (Math.abs(targetPos.x - currentPos.x) > Math.abs(targetPos.y - currentPos.y)) {
          // Horizontal movement is dominant
          setActivityAnimation(targetPos.x > currentPos.x ? 'walkRight' : 'walkLeft');
        } else {
          // Vertical movement is dominant
          setActivityAnimation(targetPos.y > currentPos.y ? 'walkDown' : 'walkUp');
        }
        
        // Set up movement interval
        moveTimerId = setInterval(() => {
          setPosition(prevPos => {
            // Move towards target position
            const moveSpeed = 1.5;
            const dx = targetPos.x - currentPos.x;
            const dy = targetPos.y - currentPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < moveSpeed) {
              // Reached target, stop moving and switch to idle
              currentPos = targetPos;
              clearInterval(moveTimerId);
              setActivityAnimation('idle');
              isMoving = false;
              return prevPos; // This doesn't matter as we're updating X/Y separately
            }
            
            // Move towards target
            currentPos.x += (dx / dist) * moveSpeed;
            currentPos.y += (dy / dist) * moveSpeed;
            
            // Update the position state for X and Y
            setPositionX(currentPos.x);
            setPositionY(currentPos.y);
            
            return prevPos; // This is only used for the horizontal pacing
          });
        }, 33);
      } else {
        // Not moving, switch between idle and activity-specific animations
        if (!isMoving) {
          setActivityAnimation(Math.random() < 0.7 ? baseAnimation : 'idle');
        }
      }
    };
    
    // Occasionally change animations to make it more dynamic
    const activityTimer = setInterval(() => {
      // Only change animation if not currently moving to a target
      if (!isMoving) {
        moveMonster();
      }
    }, 3000);
    
    return () => {
      clearInterval(activityTimer);
      clearInterval(moveTimerId);
    };
  }, [behaviorMode, activityType, spriteImage, currentAnimation, getActivityAnimation, containerWidth, containerHeight]);

  // Draw idle frame when no animation is playing
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !spriteImage) return;

    if (!currentAnimation && !currentBehavior && !activityAnimation) {
      // Use the last known direction for idle pose
      const poseAnimation = direction === 'left' ? 'walkLeft' : 'walkRight';
      drawFrame(ctx, 0, getAnimationRow(poseAnimation), 'idle');
    }
  }, [spriteImage, currentAnimation, isOpponent, currentBehavior, activityAnimation, direction]);

  // Calculate scaling factor based on container size
  const scale = Math.min(containerWidth / FRAME_WIDTH, containerHeight / FRAME_HEIGHT);
  const scaledWidth = FRAME_WIDTH * scale;
  const scaledHeight = FRAME_HEIGHT * scale;

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
          width: scaledWidth,
          height: scaledHeight,
          transform: `
            translateX(${
              behaviorMode === 'pacing' 
                ? `${position}px` 
                : behaviorMode === 'activity' 
                  ? `${positionX}px`
                  : '0'
            })
            ${isOpponent ? 'scaleX(-1)' : ''}
          `,
          transition: behaviorMode === 'pacing' 
            ? 'transform 0.1s linear' 
            : 'transform 0.3s ease',
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
          />
        </div>
      )}
    </div>
  );
};

export default MonsterSpriteView;
