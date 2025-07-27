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
}

const MonsterStatusWindow: React.FC<MonsterStatusWindowProps> = ({
  monster,
  theme,
  onShowCard,
}) => {
  // State for monster roaming behavior
  const [currentAnimation, setCurrentAnimation] = useState<AnimationType>('idleRight');
  const [animationControl, setAnimationControl] = useState<AnimationControl>({ type: 'once' });
  const [position, setPosition] = useState(0);
  const [direction, setDirection] = useState<WalkDirection>('right');
  const [isWalking, setIsWalking] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [selectedBackground, setSelectedBackground] = useState('home');

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
    switch(monster.status.type.toLowerCase()) {
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

  return (
    <div className="monster-status-container flex flex-col h-full bg-[#814E33]/20 rounded-lg p-4">
      <div className="monster-status-header px-2 py-1 flex justify-between items-center">
        <div className="text-left">
          <span className={`font-bold ${theme.text}`}>Status:</span> <span className={theme.text}>{monster.status.type}</span>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`monster-window relative overflow-hidden rounded-lg border-2 ${theme.border} bg-[#814E33]/10`}
        style={{ width: '100%', minWidth: '5rem', aspectRatio: '4/2', position: 'relative' }}
      >
        <div
          className="monster-window-bg absolute inset-0 w-full h-full"
          style={{
            backgroundImage: `url(${new URL(`../assets/window-backgrounds/${selectedBackground}.png`, import.meta.url).href})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            borderRadius: '0.5rem',
            border: '2px solid black',
            overflow: 'hidden',
          }}
        />

        {monsterSize > 0 && (
          <div
            className="monster-container absolute left-1/2 flex flex-col items-center"
            style={{
              width: `${monsterSize}px`,
              height: `${monsterSize}px`,
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
              containerWidth={monsterSize}
              containerHeight={monsterSize}
            />
          </div>
        )}
      </div>

      {onShowCard && (
        <div className="mt-4">
          <button
            onClick={onShowCard}
            className={`w-full py-2 px-4 rounded-lg font-semibold transition-colors ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
          >
            Show Card
          </button>
        </div>
      )}


    </div>
  );
};

export default MonsterStatusWindow;
