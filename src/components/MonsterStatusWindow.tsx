import React, { useState, useEffect, useRef } from 'react';
import { MonsterStats } from '../utils/aoHelpers';
import MonsterSpriteView from './MonsterSpriteView';

type AnimationType = 'walkRight' | 'walkLeft' | 'idleRight' | 'idleLeft';
type WalkDirection = 'left' | 'right';
type AnimationControl = { type: 'perpetual' | 'once', value?: number };

type Theme = {
  container: string;
  text: string;
  buttonBg: string;
  buttonHover: string;
  border: string;
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
  isLevelingUp?: boolean;
  onLevelUp?: () => void;
  getFibonacciExp?: (level: number) => number;
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
  isLevelingUp,
  onLevelUp,
  getFibonacciExp,
}) => {
  // State for monster roaming behavior
  const [currentAnimation, setCurrentAnimation] = useState<AnimationType>('idleRight');
  const [animationControl, setAnimationControl] = useState<AnimationControl>({ type: 'once' });
  const [position, setPosition] = useState(0);
  const [direction, setDirection] = useState<WalkDirection>('right');
  const [isWalking, setIsWalking] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [selectedBackground, setSelectedBackground] = useState('home');
  const [forestBackgrounds] = useState(['forest']); // Multiple nature backgrounds for Play/Exploring
  const [currentForestIndex, setCurrentForestIndex] = useState(0);

  // State for transition animations
  const [isExitAnimation, setIsExitAnimation] = useState(false);
  const [isEntranceAnimation, setIsEntranceAnimation] = useState(false);
  const [isReturnAnimation, setIsReturnAnimation] = useState(false);
  const [hasCompletedEntrance, setHasCompletedEntrance] = useState(false);
  const [previousActivityType, setPreviousActivityType] = useState<string>('');
  const [backgroundPosition, setBackgroundPosition] = useState(0);

  // State for real-time progress animation
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Refs for timers and animation
  const roamingTimerRef = useRef<NodeJS.Timeout>();
  const walkingTimerRef = useRef<NodeJS.Timeout>();
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();

  // Constants for movement
  const WALK_SPEED = 2;
  const BACKGROUND_SCROLL_SPEED = 2.5;
  const monsterSize = containerSize.width * 0.25;
  const fullWalkDistance = (containerSize.width - monsterSize) / 2;
  const walkDistance = fullWalkDistance;
  // Check if monster is in exploring or playing state
  const isExploringOrPlaying = monster.status.type.toLowerCase() === 'exploring' ||
    monster.status.type.toLowerCase() === 'play';

  // Set background based on monster status with multiple forest options
  useEffect(() => {
    switch (monster.status.type.toLowerCase()) {
      case 'home':
        setSelectedBackground('home');
        setBackgroundPosition(0); // Always keep centered
        setAnimationControl({ type: 'once' }); // Reset to normal animation
        break;
      case 'play':
        // Select random forest background when starting play
        const randomPlayIndex = Math.floor(Math.random() * forestBackgrounds.length);
        setCurrentForestIndex(randomPlayIndex);
        setSelectedBackground(forestBackgrounds[randomPlayIndex]);
        setBackgroundPosition(0); // Always keep centered
        break;
      case 'exploring':
        // Select random forest background when starting exploring
        const randomExploreIndex = Math.floor(Math.random() * forestBackgrounds.length);
        setCurrentForestIndex(randomExploreIndex);
        setSelectedBackground(forestBackgrounds[randomExploreIndex]);
        setBackgroundPosition(0); // Always keep centered
        break;
      case 'mission':
        const missionBg = Math.random() > 0.5 ? 'greenhouse' : 'beach';
        setSelectedBackground(missionBg);
        setBackgroundPosition(0); // Always keep centered
        break;
      default:
        setSelectedBackground('home');
        setBackgroundPosition(0); // Always keep centered
        break;
    }
  }, [monster.status.type, forestBackgrounds]);

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

    // For play/explore: monster stays in center with continuous running animation
    setIsWalking(true); // Always running when playing/exploring
    setPosition(0); // Keep monster at center

    console.log(`[MonsterStatusWindow] Play/Explore mode: isWalking=true, position=0, background will scroll`);

    // Start with right direction for running
    setDirection('right');
    setCurrentAnimation('walkRight');
    // Set perpetual animation for continuous running effect
    setAnimationControl({ type: 'perpetual' });

    // Faster direction changes for more dynamic running effect
    const changeDirection = () => {
      const newDirection = Math.random() < 0.5 ? 'left' : 'right';
      setDirection(newDirection);
      setCurrentAnimation(newDirection === 'right' ? 'walkRight' : 'walkLeft');
      // Keep perpetual animation
      setAnimationControl({ type: 'perpetual' });

      // Shorter intervals for more active running animation
      const directionChangeInterval = 1500 + Math.random() * 1500; // 1.5-3 seconds

      roamingTimerRef.current = setTimeout(() => {
        changeDirection();
      }, directionChangeInterval);
    };

    // Start the continuous animation cycle
    changeDirection();

    return () => {
      if (roamingTimerRef.current) clearTimeout(roamingTimerRef.current);
    };
  }, [isExploringOrPlaying, hasCompletedEntrance, isExitAnimation, isEntranceAnimation, isReturnAnimation]);

  // Real-time progress bar animation
  useEffect(() => {
    if (monster.status.type === 'Home' || !monster.status.until_time) {
      return;
    }

    const updateTimer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000); // Update every second

    return () => clearInterval(updateTimer);
  }, [monster.status.type, monster.status.until_time]);

  // Static background - no scrolling to avoid motion sickness
  // The running effect is now purely from monster animation
  useEffect(() => {
    // Reset background position to center when starting/stopping activities
    if (isExploringOrPlaying && hasCompletedEntrance && !isExitAnimation && !isEntranceAnimation && !isReturnAnimation) {
      // Keep background perfectly centered during activities
      setBackgroundPosition(0);
    }
  }, [isExploringOrPlaying, hasCompletedEntrance, isExitAnimation, isEntranceAnimation, isReturnAnimation]);

  // Disabled background rotation to keep it simple and stable
  // Background stays consistent during activities to avoid visual distraction

  // Helper functions for the design
  const getEnvironmentName = (status: string) => {
    switch (status.toLowerCase()) {
      case 'home': return 'Living Room';
      case 'play': return 'Forest Playground';
      case 'exploring': return 'Whispering Woods';
      case 'mission': return selectedBackground === 'greenhouse' ? 'Mystical Greenhouse' : 'Sunny Beach';
      default: return 'Cozy Den';
    }
  };

  const getEnvironmentDescription = (status: string) => {
    switch (status.toLowerCase()) {
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

  // Check if activity is complete using real-time
  const activityTimeUp = monster.status.type !== 'Home' &&
    monster.status.until_time &&
    currentTime >= monster.status.until_time;

  return (
    <div className="monster-status-container flex flex-col h-full rounded-lg">
      <div className="flex items-center gap-3 mb-4">
        <div>
          <h1 className={`text-xl font-bold ${theme.text}`}>
            Monster Status
          </h1>
          <p className={`${theme.text} opacity-70 text-xs`}>Keep an eye on your companion</p>
        </div>
      </div>
      {/* Status Card */}
      <div className={`w-full ${theme.container} border transition-all duration-300 overflow-hidden rounded-xl backdrop-blur-sm h-full flex-col relative flex`}>
        {/* Environment Display */}
        <div
          ref={containerRef}
          className="relative w-full min-w-20 aspect-[4/2] xl:aspect-auto flex-1 min-h-[252px] 2xl:min-h-[340px]"
          style={{
            backgroundImage: `url(${new URL(`../assets/window-backgrounds/${selectedBackground}.png`, import.meta.url).href})`,
            backgroundSize: 'cover',
            backgroundRepeat: isExploringOrPlaying ? 'repeat' : 'no-repeat',
            backgroundPosition: -backgroundPosition,
            transition: 'background-image 1.5s ease-in-out',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />

          {/* Time of Day Badge */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-white/70 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-md z-20">
            <span className="text-slate-700 font-medium text-xs">
              {getTimeOfDay() === "Day" ? '☀️' : '☾'}{" "}
              {getTimeOfDay()}
            </span>
          </div>

          {/* Location Badge */}
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-white/70 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-md z-20">
            <span className="text-slate-700 font-medium text-xs">📍 {getEnvironmentName(monster.status.type)}</span>
          </div>

          {/* Activity Status Badge */}
          {(monster.status.type !== 'Home' && (monster.status.until_time || activityTimeUp)) && (
            <div className="absolute top-4 right-4 bg-white/70 backdrop-blur-sm px-4 py-2 rounded-full shadow-md z-20">
              <span className="text-slate-700 font-medium text-sm">
                {activityTimeUp
                  ? 'Complete!'
                  : (() => {
                    if (!monster.status.until_time) return '';
                    const remaining = Math.max(0, monster.status.until_time - currentTime);
                    const h = Math.floor(remaining / 3600000);
                    const m = Math.floor((remaining % 3600000) / 60000);
                    const s = Math.floor((remaining % 60000) / 1000);
                    return h > 0
                      ? `${h}h ${m}m ${s}s`
                      : m > 0
                        ? `${m}m ${s}s`
                        : `${s}s`;
                  })()
                }
              </span>
            </div>
          )}

          {/* View NFT Card Button Overlay */}
          <button
            onClick={onShowCard}
            className="absolute bottom-3 right-4 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white px-3 py-1.5 rounded-lg font-medium transition-all hover:scale-105 text-xs shadow-md z-20"
          >
            View NFT
          </button>

          {/* Monster Sprite */}
          {monsterSize > 0 && (
            <div
              className="monster-container absolute left-1/2 flex flex-col items-center"
              style={{
                width: `${Math.min(monsterSize, 120)}px`,
                height: `${Math.min(monsterSize, 120)}px`,
                transform: isExploringOrPlaying && hasCompletedEntrance
                  ? `translateX(-50%)` // Keep perfectly centered when running
                  : `translateX(calc(-50% + ${position}px))`, // Normal movement when at home
                bottom: '0px',
                transition: isExploringOrPlaying ? 'none' : 'transform 0.1s linear',
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
        <div className="p-4">
          <div className="text-center md:text-left">
            <div className="flex items-center justify-between mb-1">
              <h2 className={`text-lg font-bold ${theme.text}`}>Status: {monster.status.type}</h2>
              {/* Level Up Button - Always show for debugging */}
              <button
                onClick={onLevelUp}
                disabled={isLevelingUp || monster.status.type !== 'Home'}
                className="px-3 py-1 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-yellow-900 font-semibold transition-all transform hover:scale-105 disabled:opacity-50 text-xs"
                title={monster.status.type !== 'Home' ? 'Monster must be at Home to level up' : ''}
              >
                {isLevelingUp ? 'Leveling...' : 'Level Up'}
              </button>
            </div>
            <p className={`${theme.text} opacity-70 text-xs`}>{getEnvironmentDescription(monster.status.type)}</p>

            {/* Progress Bar for activities */}
            {monster.status.type !== 'Home' && monster.status.until_time && (
              <div className="mt-3">
                {/* Progress Bar with clear background */}
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 border border-gray-300 dark:border-gray-600 shadow-inner">
                  <div
                    className="bg-gradient-to-r from-orange-400 to-red-500 h-full rounded-full transition-all duration-1000 shadow-sm"
                    style={{
                      width: `${Math.min(100, (() => {
                        const totalDuration = monster.status.until_time - monster.status.since;
                        const elapsed = currentTime - monster.status.since;
                        return Math.max(0, (elapsed / totalDuration) * 100);
                      })())}%`
                    }}
                  />
                </div>
                {/* Time remaining with better visibility */}
                <div className="flex justify-between items-center mt-2">
                  <p className={`text-xs ${theme.text} opacity-80 font-medium`}>
                    {activityTimeUp ? '✅ Activity completed!' : (() => {
                      const remaining = Math.max(0, monster.status.until_time - currentTime);
                      const hours = Math.floor(remaining / (1000 * 60 * 60));
                      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
                      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

                      if (hours > 0) {
                        return `⏰ ${hours}h ${minutes}m ${seconds}s remaining`;
                      } else if (minutes > 0) {
                        return `⏰ ${minutes}m ${seconds}s remaining`;
                      } else {
                        return `⏰ ${seconds}s remaining`;
                      }
                    })()}
                  </p>
                  <p className={`text-xs ${theme.text} opacity-60`}>
                    {Math.round(Math.min(100, (() => {
                      const totalDuration = monster.status.until_time - monster.status.since;
                      const elapsed = currentTime - monster.status.since;
                      return Math.max(0, (elapsed / totalDuration) * 100);
                    })()))}%
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* {onShowCard && (
        <div className="mt-4">
          <button
            onClick={onShowCard}
            className={`w-full py-2 px-4 rounded-lg font-semibold transition-colors ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
          >
            Show Card
          </button>
        </div>
      )} */}


    </div>
  );
};

export default MonsterStatusWindow;
