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
  currentEffect?: string | null;
  onEffectTrigger?: (effect: string) => void;
  triggerReturn?: boolean;
  onReturnComplete?: () => void;
  isLevelingUp?: boolean;
  onLevelUp?: () => void;
}

const MonsterStatusWindow: React.FC<MonsterStatusWindowProps> = ({
  monster,
  theme,
  onShowCard,
  currentEffect,
  onEffectTrigger,
  triggerReturn,
  onReturnComplete,
  isLevelingUp,
  onLevelUp,
}) => {
  // State for monster roaming behavior
  const [currentAnimation, setCurrentAnimation] = useState<AnimationType>('idleRight');
  const [animationControl, setAnimationControl] = useState<AnimationControl>({ type: 'once' });
  const [position, setPosition] = useState(0);
  const [direction, setDirection] = useState<WalkDirection>('right');
  const [isWalking, setIsWalking] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [selectedBackground, setSelectedBackground] = useState('home');

  // State for real-time progress animation
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Refs for timers and animation
  const roamingTimerRef = useRef<NodeJS.Timeout>();
  const walkingTimerRef = useRef<NodeJS.Timeout>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Constants for movement
  const WALK_SPEED = 1;
  const monsterSize = containerSize.width * 0.25;
  const fullWalkDistance = (containerSize.width - monsterSize) / 2;
  const walkDistance = fullWalkDistance;

  // Set background based on monster status
  useEffect(() => {
    switch (monster.status.type.toLowerCase()) {
      case 'home': setSelectedBackground('home'); break;
      case 'play': setSelectedBackground('forest'); break;
      case 'mission': setSelectedBackground(Math.random() > 0.5 ? 'greenhouse' : 'beach'); break;
      default: setSelectedBackground('home'); break;
    }
  }, [monster.status.type]);

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

  // Natural roaming behavior system
  useEffect(() => {
    if (walkDistance <= 0) return;

    const startRoaming = () => {
      // Random action: idle left, idle right, walk left, or walk right
      const actions = ['idleLeft', 'idleRight', 'walkLeft', 'walkRight'] as const;
      const randomAction = actions[Math.floor(Math.random() * actions.length)];

      if (randomAction.startsWith('idle')) {
        // Just idle in the specified direction
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] MonsterStatusWindow: Setting idle animation:`, randomAction);
        setIsWalking(false);
        setCurrentAnimation(randomAction as AnimationType);
        setAnimationControl({ type: 'once' }); // Idle animations should be once/static
        setDirection(randomAction === 'idleLeft' ? 'left' : 'right');

        // Schedule next action after idle period
        roamingTimerRef.current = setTimeout(startRoaming, 1500 + Math.random() * 2500);
      } else {
        // Start walking in the specified direction
        const walkDirection = randomAction === 'walkLeft' ? 'left' : 'right';
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] MonsterStatusWindow: Starting walking animation:`, randomAction, 'direction:', walkDirection);
        setDirection(walkDirection);
        setIsWalking(true);
        setCurrentAnimation(randomAction as AnimationType);
        setAnimationControl({ type: 'perpetual' }); // Walking animations should be perpetual

        // Walk for a random duration, then stop and idle
        const walkDuration = 1000 + Math.random() * 2000;
        console.log(`[${timestamp}] MonsterStatusWindow: Walking duration set to:`, walkDuration, 'ms');
        walkingTimerRef.current = setTimeout(() => {
          const endTimestamp = new Date().toISOString();
          console.log(`[${endTimestamp}] MonsterStatusWindow: Ending walking, switching to idle:`, walkDirection === 'left' ? 'idleLeft' : 'idleRight');
          setIsWalking(false);
          setCurrentAnimation(walkDirection === 'left' ? 'idleLeft' : 'idleRight');
          setAnimationControl({ type: 'once' }); // Switch back to once for idle

          // Schedule next action after walking
          roamingTimerRef.current = setTimeout(startRoaming, 1000 + Math.random() * 2000);
        }, walkDuration);
      }
    };

    // Start the roaming behavior
    startRoaming();

    return () => {
      if (roamingTimerRef.current) clearTimeout(roamingTimerRef.current);
      if (walkingTimerRef.current) clearTimeout(walkingTimerRef.current);
    };
  }, [walkDistance]);

  // Handle position updates during walking
  useEffect(() => {
    if (!isWalking || walkDistance <= 0) return;

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] MonsterStatusWindow: Starting position updates for walking in direction:`, direction);

    const updatePosition = () => {
      setPosition(prevPos => {
        const directionMultiplier = direction === 'right' ? 1 : -1;
        let newPos = prevPos + (WALK_SPEED * directionMultiplier);

        // Respect boundaries
        if (newPos >= walkDistance) {
          newPos = walkDistance - 0.1;
        } else if (newPos <= -walkDistance) {
          newPos = -walkDistance + 0.1;
        }

        return newPos;
      });
    };

    const intervalId = setInterval(updatePosition, 33); // ~30fps

    return () => {
      const endTimestamp = new Date().toISOString();
      console.log(`[${endTimestamp}] MonsterStatusWindow: Stopping position updates`);
      clearInterval(intervalId);
    };
  }, [isWalking, direction, walkDistance]);

  // Returns the environment name based on status
  const getEnvironmentName = (status: string, selectedBackground?: string) => {
    switch (status.toLowerCase()) {
      case 'home': return 'Living Room';
      case 'play': return 'Forest Playground';
      case 'exploring': return 'Whispering Woods';
      case 'mission': return selectedBackground === 'greenhouse' ? 'Mystical Greenhouse' : 'Sunny Beach';
      default: return 'Cozy Den';
    }
  };

  // Returns the environment description based on status
  const getEnvironmentDescription = (status: string, selectedBackground?: string) => {
    switch (status.toLowerCase()) {
      case 'home': return 'A warm and inviting space with a comfy couch.';
      case 'play': return 'Running around and having fun in nature.';
      case 'exploring': return 'Discovering new paths and hidden treasures.';
      case 'mission': return selectedBackground === 'greenhouse' ? 'A magical place filled with exotic plants.' : 'A peaceful shoreline with gentle waves.';
      default: return 'A peaceful resting place.';
    }
  };

  // Returns "Day" or "Night" based on current hour
  const getTimeOfDay = () => {
    const hour = new Date().getHours();
    return hour >= 6 && hour < 18 ? 'Day' : 'Night';
  };

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
      <div className={`w-full ${theme.container} border transition-all duration-300 overflow-hidden rounded-xl backdrop-blur-sm`}>
        {/* Environment Display */}
        <div
          ref={containerRef}
          className="relative w-full min-w-20 aspect-[4/2] overflow-hidden"
          style={{
            backgroundImage: `url(${new URL(`../assets/window-backgrounds/${selectedBackground}.png`, import.meta.url).href})`,
            backgroundSize: 'cover',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
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
                transform: `translateX(calc(-50% + ${position}px))`,
                bottom: 0,
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
