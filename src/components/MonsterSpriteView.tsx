import React, { useEffect, useRef, useState, useCallback } from 'react';

type EffectType = 'Full Heal' | 'Large Heal' | 'Medium Heal' | 'Small Heal' | 'Revive' | null;

// Extended animation types to support new behaviors
type AnimationType = 'walkRight' | 'walkLeft' | 'walkUp' | 'walkDown' | 'attack1' | 'attack2' | 
                    'idle' | 'sleep' | 'eat' | 'train' | 'play' | 'happy';
type PoseType = 'right' | 'left';

// Animation behavior modes
type BehaviorMode = 'static' | 'pacing' | 'activity';

interface MonsterSpriteViewProps {
  sprite: string; // Arweave transaction ID for the sprite sheet
  currentAnimation?: AnimationType;
  pose?: PoseType; // Static pose when not animating
  onAnimationComplete?: () => void;
  isOpponent?: boolean; // Used to determine facing direction
  behaviorMode?: BehaviorMode; // Controls how the sprite behaves
  activityType?: string; // Type of activity the monster is doing
  containerWidth?: number; // Width of container for pacing calculations
  containerHeight?: number; // Height of container for animation positioning
  effect?: EffectType; // Current effect to display
  onEffectComplete?: () => void; // Callback when effect animation completes
}

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 64;
const FRAMES_PER_ANIMATION = 4;
const ANIMATION_ROWS = 6;
const ANIMATION_SPEED = 1000 / 4; // 1 second total divided by 4 frames = 250ms per frame

const EffectAnimation: React.FC<{ effect: EffectType; onComplete: () => void }> = ({ effect, onComplete }) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const effectRef = useRef<HTMLImageElement | null>(null);
  const FRAME_COUNT = 8;
  const ANIMATION_SPEED = 100; // ms per frame

  useEffect(() => {
    if (!effect) return;
    
    const img = new Image();
    img.src = new URL(`../assets/effects/${effect}.png`, import.meta.url).href;
    effectRef.current = img;

    const timer = setInterval(() => {
      setCurrentFrame(prev => {
        if (prev >= FRAME_COUNT - 1) {
          clearInterval(timer);
          onComplete();
          return 0;
        }
        return prev + 1;
      });
    }, ANIMATION_SPEED);

    return () => clearInterval(timer);
  }, [effect, onComplete]);

  if (!effect) return null;

  return (
    <div className="effect-animation" style={{
      position: 'absolute',
      width: '64px',
      height: '64px',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%) scale(3.75)',
      zIndex: 10,
      pointerEvents: 'none',
      overflow: 'hidden',
    }}>
      <div style={{
        width: '64px',
        height: '64px',
        backgroundImage: effectRef.current ? `url(${effectRef.current.src})` : 'none',
        backgroundPosition: `-${currentFrame * 64}px 0`,
        backgroundSize: '512px 64px', // 8 frames * 64px
        imageRendering: 'pixelated',
      }} />
    </div>
  );
};

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
  const [effect, setEffect] = useState<EffectType>(null);

  // Handle external effect changes
  useEffect(() => {
    if (externalEffect && externalEffect !== effect) {
      setEffect(externalEffect);
    }
  }, [externalEffect]);

  const handleEffectComplete = useCallback(() => {
    setEffect(null);
    onEffectComplete?.();
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
      case 'idle': return 0; // Use walkRight row
      case 'sleep': return 3; // Use walkDown row
      case 'eat': return 3;  // Use walkDown row
      case 'train': return 4; // Use attack1 row
      case 'play': return 0;  // Use walkRight row
      case 'happy': return 2; // Use walkUp row
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

  // Handle explicitly provided animation
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
          const movementRate = 2; // Faster movement rate
          
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
      // Always use walkRight as the default pose
      const poseAnimation = 'walkRight';
      drawFrame(ctx, 0, getAnimationRow(poseAnimation));
    }
  }, [spriteImage, currentAnimation, isOpponent, currentBehavior, activityAnimation]);

  return (
    <div 
      className="monster-sprite-container relative"
      style={{
        width: containerWidth,
        height: containerHeight
      }}
    >
      <div style={{
        position: 'relative',
        width: FRAME_WIDTH * 3.75,
        height: FRAME_HEIGHT * 3.75,
        left: behaviorMode === 'pacing' 
          ? `${position}px` 
          : behaviorMode === 'activity' 
            ? `${positionX}px`
            : '50%',
        bottom: behaviorMode === 'activity'
          ? `${Math.min(90, Math.max(10, positionY))}px`
          : '10%',
        marginLeft: behaviorMode === 'pacing' || behaviorMode === 'activity' ? 0 : '-120px',
        transform: isOpponent ? 'scaleX(-1)' : undefined,
      }}>
        <canvas
          ref={canvasRef}
          width={FRAME_WIDTH}
          height={FRAME_HEIGHT}
          className="pixelated absolute"
          style={{
            width: '100%',
            height: '100%',
            imageRendering: 'pixelated',
            zIndex: 1,
          }}
        />
        {effect && (
          <EffectAnimation 
            effect={effect} 
            onComplete={handleEffectComplete} 
          />
        )}
      </div>
    </div>
  );
};

export default MonsterSpriteView;
