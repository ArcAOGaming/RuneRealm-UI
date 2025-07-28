import React, { useState, useEffect, useRef } from 'react';
import { MonsterStats } from '../utils/aoHelpers';
import MonsterSpriteView from './MonsterSpriteView';
import { Home, MapPin, PawPrint, Sun, Moon } from 'lucide-react';

type AnimationType = 'walkRight' | 'walkLeft' | 'idleRight' | 'idleLeft';
type WalkDirection = 'left' | 'right';
type AnimationControl = { type: 'perpetual' | 'once', value?: number };

type Theme = {
  container: string;
  text: string;
  border: string;
  buttonBg: string;
  buttonHover: string;
};

interface MonsterStatusWindowProps {
  monster: MonsterStats;
  theme: Theme;
  onShowCard?: () => void;
  formatTimeRemaining?: (until: number) => string;
  calculateProgress?: (since: number, until: number) => number;
  isActivityComplete?: (monster: MonsterStats) => boolean;
  currentEffect?: string | null;
  onEffectTrigger?: (effect: string) => void;
  triggerReturn?: boolean;
  onReturnComplete?: () => void;
}

const MonsterStatusWindow: React.FC<MonsterStatusWindowProps> = ({
  monster,
  theme,
  onShowCard,
  formatTimeRemaining,
  calculateProgress,
  isActivityComplete,
  currentEffect,
  onEffectTrigger,
  triggerReturn,
  onReturnComplete,
}) => {
  // State for monster roaming behavior
  const [currentAnimation, setCurrentAnimation] = useState<AnimationType>('idleRight');
  const [animationControl, setAnimationControl] = useState<AnimationControl>({ type: 'once' });
  const [position, setPosition] = useState(0);
  const [direction, setDirection] = useState<WalkDirection>('right');
  const [isWalking, setIsWalking] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [selectedBackground, setSelectedBackground] = useState('home');

  // State for transition animations
  const [isExitAnimation, setIsExitAnimation] = useState(false);
  const [isEntranceAnimation, setIsEntranceAnimation] = useState(false);
  const [isReturnAnimation, setIsReturnAnimation] = useState(false);
  const [hasCompletedEntrance, setHasCompletedEntrance] = useState(false);
  const [previousActivityType, setPreviousActivityType] = useState<string>('');
  const [backgroundPosition, setBackgroundPosition] = useState(0);

  // Refs for timers and animation
  const roamingTimerRef = useRef<NodeJS.Timeout>();
  const walkingTimerRef = useRef<NodeJS.Timeout>();
  const animationRef = useRef<number>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Constants for movement
  const WALK_SPEED = 2;
  const BACKGROUND_SCROLL_SPEED = 2.5; // Increased for better visual effect during play/explore
  const monsterSize = containerSize.width * 0.25;
  const fullWalkDistance = (containerSize.width - monsterSize) / 2;
  const walkDistance = fullWalkDistance;

  // Check if monster is in exploring or playing state
  const isExploringOrPlaying = monster.status.type.toLowerCase() === 'exploring' || 
                               monster.status.type.toLowerCase() === 'play';

  // Set background based on monster status
  useEffect(() => {
    switch(monster.status.type.toLowerCase()) {
      case 'home': setSelectedBackground('home'); break;
      case 'play': setSelectedBackground('forest'); break;
      case 'exploring': setSelectedBackground('forest'); break;
      case 'mission': setSelectedBackground(Math.random() > 0.5 ? 'greenhouse' : 'beach'); break;
      default: setSelectedBackground('home'); break;
    }
  }, [monster.status.type]);

  // Handle manual return trigger
  useEffect(() => {
    if (triggerReturn && isExploringOrPlaying && !isReturnAnimation && !isExitAnimation && !isEntranceAnimation) {
      console.log(`[MonsterStatusWindow] Manual return triggered`);
      setIsReturnAnimation(true);
      setIsExitAnimation(false);
      setIsEntranceAnimation(false);
      setHasCompletedEntrance(false);
      setCurrentAnimation('walkLeft');
      setPosition(0); // Start from center in current background
      
      // Clear roaming timers
      if (roamingTimerRef.current) {
        clearTimeout(roamingTimerRef.current);
      }
    }
  }, [triggerReturn, isExploringOrPlaying, isReturnAnimation, isExitAnimation, isEntranceAnimation]);

  // Track activity changes for transition animations
  useEffect(() => {
    const currentActivity = monster.status.type.toLowerCase();
    
    // When switching from home to play/exploring, trigger exit animation
    if ((currentActivity === 'play' || currentActivity === 'exploring') && 
        previousActivityType === 'home') {
      console.log(`[MonsterStatusWindow] Starting exit animation from home to ${currentActivity}`);
      setIsExitAnimation(true);
      setIsReturnAnimation(false);
      setIsEntranceAnimation(false);
      setHasCompletedEntrance(false);
      setCurrentAnimation('walkRight');
      setPosition(0); // Start from center
    }
    // When switching from play/exploring to home, trigger return animation (auto return)
    else if (currentActivity === 'home' && 
             (previousActivityType === 'play' || previousActivityType === 'exploring') &&
             !triggerReturn) { // Only auto-return if not manually triggered
      console.log(`[MonsterStatusWindow] Auto return animation from ${previousActivityType} to home`);
      setIsReturnAnimation(true);
      setIsExitAnimation(false);
      setIsEntranceAnimation(false);
      setHasCompletedEntrance(false);
      setCurrentAnimation('walkLeft');
      setPosition(0); // Start from center in current background
    }
    // When already in play/exploring state, trigger entrance animation if not completed
    else if (isExploringOrPlaying && !hasCompletedEntrance && !isExitAnimation && !isReturnAnimation) {
      console.log(`[MonsterStatusWindow] Starting entrance animation for ${currentActivity}`);
      setIsEntranceAnimation(true);
      setPosition(-walkDistance); // Start from left edge
      setCurrentAnimation('walkRight');
    }
    
    setPreviousActivityType(currentActivity);
  }, [monster.status.type, isExploringOrPlaying, walkDistance, hasCompletedEntrance, isExitAnimation, isReturnAnimation, previousActivityType, triggerReturn]);

  // Handle container resizing
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const w = containerRef.current.offsetWidth;
        setContainerSize({ width: w, height: w * 0.5 });
      }
    };
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Handle walking animation with exit/entrance/return/continuous scrolling
  useEffect(() => {
    if (isExitAnimation || isEntranceAnimation || isReturnAnimation || isExploringOrPlaying) {
      setIsWalking(true);
      if (isReturnAnimation) {
        setDirection('left');
        setCurrentAnimation('walkLeft');
      } else {
        setDirection('right');
        setCurrentAnimation('walkRight');
      }
    } else {
      // For other activities (like home), use the original random walking logic
      if (!isWalking || walkDistance <= 0) {
        setCurrentAnimation('idleRight');
        return;
      }
    }

    const moveMonster = (timestamp: number) => {
      if (isExitAnimation) {
        // Exit animation: monster walks from center to right edge (in home background)
        setPosition(prevPos => {
          let newPos = prevPos + WALK_SPEED;
          
          // When monster reaches right edge, complete exit and immediately trigger entrance
          if (newPos >= walkDistance) {
            newPos = walkDistance;
            console.log(`[MonsterStatusWindow] Exit animation complete, triggering entrance`);
            setIsExitAnimation(false);
            // Background changes to forest immediately, then start entrance animation
            setIsEntranceAnimation(true);
            setPosition(-walkDistance); // Monster appears from left edge
          }
          
          return newPos;
        });
             } else if (isReturnAnimation) {
         // Return animation: monster walks from center to left edge (in forest background)  
         setPosition(prevPos => {
           let newPos = prevPos - WALK_SPEED;
           
           // When monster reaches left edge, complete return and enter home from left
           if (newPos <= -walkDistance) {
             newPos = -walkDistance;
             console.log(`[MonsterStatusWindow] Return animation complete, entering home`);
             setIsReturnAnimation(false);
             // Background changes to home immediately, then enter from left
             setPosition(-walkDistance);
             setIsEntranceAnimation(true);
             
             // Notify parent that return is complete
             if (onReturnComplete) {
               onReturnComplete();
             }
           }
           
           return newPos;
         });
       } else if (isEntranceAnimation && !hasCompletedEntrance) {
        // Entrance animation: monster walks from left to center (in current background)
        setPosition(prevPos => {
          let newPos = prevPos + WALK_SPEED;
          
          // When monster reaches center, stop entrance animation
          if (newPos >= 0) {
            newPos = 0;
            console.log(`[MonsterStatusWindow] Entrance animation complete`);
            setIsEntranceAnimation(false);
            // Only set completed entrance for exploring/playing activities
            if (isExploringOrPlaying) {
              setHasCompletedEntrance(true);
            } else {
              // For home activities, reset all states
              setHasCompletedEntrance(false);
              setPosition(0);
              setBackgroundPosition(0);
            }
          }
          
          return newPos;
        });
      }
      
      // Background scrolling for exploring/playing monsters (after entrance, no other animations)
      if (isExploringOrPlaying && hasCompletedEntrance && !isExitAnimation && !isEntranceAnimation && !isReturnAnimation) {
        // Keep monster at center position when exploring/playing
        setPosition(0);
        
        // Scroll background continuously
        setBackgroundPosition(prevPos => {
          let newPos = prevPos + BACKGROUND_SCROLL_SPEED;
          
          // Reset background position to create seamless loop
          if (newPos >= 100) {
            newPos = 0;
          }
          
          return newPos;
        });
      }
      
      // Original walking logic for other activities (home, etc.) - only when no transitions
      if (!isExitAnimation && !isEntranceAnimation && !isReturnAnimation && !isExploringOrPlaying) {
        setPosition(prevPos => {
          // Calculate movement based on direction
          const directionMultiplier = direction === 'right' ? 1 : -1;
          let newPos = prevPos + (WALK_SPEED * directionMultiplier);
          
          // Handle direction change at restricted boundaries
          if (newPos >= walkDistance) {
            newPos = walkDistance - 0.1;
            setDirection('left');
            setCurrentAnimation('walkLeft');
          } else if (newPos <= -walkDistance) {
            newPos = -walkDistance + 0.1;
            setDirection('right');
            setCurrentAnimation('walkRight');
          } else {
            setCurrentAnimation(direction === 'right' ? 'walkRight' : 'walkLeft');
          }
          
          return newPos;
        });
      }

      animationRef.current = requestAnimationFrame(moveMonster);
    };

    animationRef.current = requestAnimationFrame(moveMonster);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isWalking, walkDistance, direction, isExitAnimation, isEntranceAnimation, isReturnAnimation, isExploringOrPlaying, hasCompletedEntrance]);

  // Handle idle/walking state changes for home activities only
  useEffect(() => {
    if (isExitAnimation || isEntranceAnimation || isReturnAnimation || isExploringOrPlaying) {
      // Don't change state for special animations or exploring/playing
      return;
    }

    const decideState = () => {
      const shouldWalk = Math.random() < 0.3; // 30% chance to walk
      setIsWalking(shouldWalk);
      
      // Set a random time for the next state change (between 2-5 seconds)
      const nextStateChange = 2000 + Math.random() * 3000;
      
      roamingTimerRef.current = setTimeout(() => {
        decideState();
      }, nextStateChange);
    };

    decideState();
    
    return () => {
      if (roamingTimerRef.current) clearTimeout(roamingTimerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isExitAnimation, isEntranceAnimation, isReturnAnimation, isExploringOrPlaying]);

  // Handle roaming for exploring/playing after entrance is complete
  useEffect(() => {
    if (!isExploringOrPlaying || !hasCompletedEntrance || isExitAnimation || isEntranceAnimation || isReturnAnimation) {
      return;
    }

    console.log(`[MonsterStatusWindow] Starting exploring/playing behavior - monster stays center, background scrolls`);

    // For play/explore: monster stays in center with continuous walking animation
    setIsWalking(true); // Always walking when playing/exploring
    setPosition(0); // Keep monster at center
    
    console.log(`[MonsterStatusWindow] Play/Explore mode: isWalking=true, position=0, background will scroll`);
    
    const changeDirection = () => {
      // Randomly change direction every 2-4 seconds for variety
      const newDirection = Math.random() < 0.5 ? 'left' : 'right';
      setDirection(newDirection);
      setCurrentAnimation(newDirection === 'right' ? 'walkRight' : 'walkLeft');
      
      const directionChangeInterval = 2000 + Math.random() * 2000;
      
      roamingTimerRef.current = setTimeout(() => {
        changeDirection();
      }, directionChangeInterval);
    };

    // Start with initial direction
    changeDirection();
    
    return () => {
      if (roamingTimerRef.current) clearTimeout(roamingTimerRef.current);
    };
  }, [isExploringOrPlaying, hasCompletedEntrance, isExitAnimation, isEntranceAnimation, isReturnAnimation]);

  // Helper functions for the design
  const getEnvironmentName = (status: string) => {
    switch(status.toLowerCase()) {
      case 'home': return 'Living Room';
      case 'play': return 'Forest Playground';
      case 'exploring': return 'Whispering Woods';
      case 'mission': return selectedBackground === 'greenhouse' ? 'Mystical Greenhouse' : 'Sunny Beach';
      default: return 'Cozy Den';
    }
  };

  const getEnvironmentDescription = (status: string) => {
    switch(status.toLowerCase()) {
      case 'home': return 'A warm and inviting space with a comfy couch.';
      case 'play': return 'Running around and having fun in nature.';
      case 'exploring': return 'Discovering new paths and hidden treasures.';
      case 'mission': return selectedBackground === 'greenhouse' ? 'A magical place filled with exotic plants.' : 'A peaceful shoreline with gentle waves.';
      default: return 'A peaceful resting place.';
    }
  };

  const getTimeOfDay = () => {
    const hour = new Date().getHours();
    return hour >= 6 && hour < 18 ? 'Day' : 'Night';
  };

  const activityTimeUp = isActivityComplete ? isActivityComplete(monster) : false;

  return (
    <div className="monster-status-container">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="p-3 bg-gradient-to-r from-orange-500 to-red-600 rounded-2xl shadow-lg">
          <PawPrint className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
            Monster Status
          </h1>
          <p className="text-slate-600 text-sm">Keep an eye on your companion</p>
        </div>
      </div>

      {/* Status Card */}
      <div className="bg-white/80 backdrop-blur-sm border-2 border-white/50 shadow-xl hover:shadow-2xl transition-all duration-300 overflow-hidden rounded-xl">
        {/* Environment Display */}
        <div
          ref={containerRef}
          className="relative w-full h-64 overflow-hidden"
          style={{
            backgroundImage: `url(${new URL(`../assets/window-backgrounds/${selectedBackground}.png`, import.meta.url).href})`,
            backgroundSize: 'cover',
            backgroundPosition: isExploringOrPlaying && hasCompletedEntrance 
              ? `${backgroundPosition}% center` 
              : 'center',
            transition: isExploringOrPlaying && hasCompletedEntrance ? 'none' : 'background-position 0.1s linear',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
          
          {/* Time of Day Badge */}
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-white/70 backdrop-blur-sm px-4 py-2 rounded-full shadow-md z-20">
            {getTimeOfDay() === 'Day' ? (
              <Sun className="w-4 h-4 text-yellow-500" />
            ) : (
              <Moon className="w-4 h-4 text-blue-500" />
            )}
            <span className="text-slate-700 font-medium text-sm">
              {getTimeOfDay()}
            </span>
          </div>

          {/* Location Badge */}
          <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-white/70 backdrop-blur-sm px-4 py-2 rounded-full shadow-md z-20">
            <MapPin className="w-4 h-4 text-slate-600" />
            <span className="text-slate-700 font-medium text-sm">{getEnvironmentName(monster.status.type)}</span>
          </div>

          {/* Activity Status Badge */}
          {(monster.status.type !== 'Home' && (monster.status.until_time || activityTimeUp)) && (
            <div className="absolute top-4 right-4 bg-white/70 backdrop-blur-sm px-4 py-2 rounded-full shadow-md z-20">
              <span className="text-slate-700 font-medium text-sm">
                {activityTimeUp ? 'Complete!' : formatTimeRemaining ? formatTimeRemaining(monster.status.until_time) : ''}
              </span>
            </div>
          )}

          {/* Monster Sprite */}
          {monsterSize > 0 && (
            <div
              className="monster-container absolute left-1/2 flex flex-col items-center"
              style={{
                width: `${Math.min(monsterSize, 120)}px`,
                height: `${Math.min(monsterSize, 120)}px`,
                transform: `translateX(calc(-50% + ${position * 0.5}px))`,
                bottom: '0px',
                transition: 'transform 0.1s linear',
                zIndex: 10
              }}
            >
              <MonsterSpriteView
                sprite={monster.sprite || ''}
                scale={2.0}
                currentAnimation={currentAnimation}
                animationControl={animationControl}
                containerWidth={Math.min(monsterSize, 120)}
                containerHeight={Math.min(monsterSize, 120)}
                effect={currentEffect as any}
                onEffectComplete={() => {
                  // Clear the effect after animation completes
                  if (onEffectTrigger) {
                    onEffectTrigger('');
                  }
                }}
              />
            </div>
          )}
        </div>

        {/* Monster and Status Info */}
        <div className="p-6">
          <div className="text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
              <Home className="w-5 h-5 text-slate-600" />
              <h2 className="text-xl font-bold text-slate-800">Status: {monster.status.type}</h2>
            </div>
            <p className="text-slate-600 text-sm">{getEnvironmentDescription(monster.status.type)}</p>
            
            {/* Progress Bar for activities */}
            {monster.status.type !== 'Home' && monster.status.until_time && calculateProgress && (
              <div className="mt-3">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-gradient-to-r from-orange-400 to-red-500 h-2 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${Math.min(100, calculateProgress(monster.status.since, monster.status.until_time))}%` 
                    }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {activityTimeUp ? 'Activity completed!' : `${formatTimeRemaining ? formatTimeRemaining(monster.status.until_time) : ''} remaining`}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonsterStatusWindow;
