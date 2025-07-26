import React, { useState, useEffect, useRef } from 'react';
import { MonsterStats } from '../utils/aoHelpers';
import MonsterSpriteView from './MonsterSpriteView';

type AnimationType = 'walkRight' | 'walkLeft' | 'walkUp' | 'walkDown' | 'attack1' | 'attack2' | 'idle' | 'sleep' | 'eat' | 'train' | 'play' | 'happy';
type WalkDirection = 'left' | 'right';

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
  currentEffect: string | null;
  onEffectTrigger: (effect: string) => void;
  formatTimeRemaining: (until: number) => string;
  calculateProgress: (since: number, until: number) => number;
  isActivityComplete: (monster: MonsterStats) => boolean;
  onShowCard?: () => void;
}

const DEV_MODE = true; // Toggle this to enable/disable developer tools

const MonsterStatusWindow: React.FC<MonsterStatusWindowProps> = ({
  monster,
  theme,
  currentEffect,
  onEffectTrigger,
  formatTimeRemaining,
  calculateProgress,
  isActivityComplete,
  onShowCard,
}) => {
  const activityTimeUp = isActivityComplete(monster);
  const [isWalking, setIsWalking] = useState(false);
  const [position, setPosition] = useState(0);
  // Store normalized position (-10 to 10 scale) for consistent resizing
  const [normalizedPos, setNormalizedPos] = useState(0);
  const [walkDirection, setWalkDirection] = useState<WalkDirection>('right');
  const [currentAnimation, setCurrentAnimation] = useState<AnimationType>('idle');
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [selectedBackground, setSelectedBackground] = useState<string>('home');
  
  // Set background based on monster status
  useEffect(() => {
    switch(monster.status.type.toLowerCase()) {
      case 'home':
        setSelectedBackground('home');
        break;
      case 'play':
        setSelectedBackground('forest');
        break;
      case 'mission':
        // Randomly choose between greenhouse and beach for missions
        setSelectedBackground(Math.random() > 0.5 ? 'greenhouse' : 'beach');
        break;
      default:
        setSelectedBackground('home');
    }
  }, [monster.status.type]);
  
  const idleTimerRef = useRef<number>();
  const animationRef = useRef<number>();
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Constants for movement
  const WALK_SPEED = 1;
  
  // Calculate derived values
  const monsterSize = containerSize.width * 0.25; // 1 unit (1/4 of 4 units)
  // Full walk distance from center to edge (for position display scaling)
  const fullWalkDistance = (containerSize.width - monsterSize) / 2;
  // Restricted walk distance (100% of full distance) to prevent clipping (could be less for some reasons)
  const walkDistance = fullWalkDistance * 1;
  
  // Update container size and maintain 4:2 aspect ratio
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateSize = () => {
      if (!containerRef.current) return;
      
      const containerWidth = containerRef.current.offsetWidth;
      const containerHeight = containerWidth * 0.5; // 4:2 aspect ratio
      
      setContainerSize({
        width: containerWidth,
        height: containerHeight
      });
    };
    
    // Initial update
    updateSize();
    
    // Set up resize observer
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(containerRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, []);
  
  // Update pixel position when container size changes to maintain normalized position
  useEffect(() => {
    if (fullWalkDistance > 0) {
      // Convert normalized position back to pixels based on new container size
      setPosition(normalizedPos * fullWalkDistance / 10);
    }
  }, [containerSize, fullWalkDistance, normalizedPos]);
  
  const triggerEffect = (effect: string) => {
    onEffectTrigger(effect);
  };

  // Handle walking animation
  useEffect(() => {
    if (!isWalking || walkDistance <= 0) {
      setCurrentAnimation('idle');
      return;
    }

    const moveMonster = (timestamp: number) => {
      setPosition(prevPos => {
        // Calculate movement based on direction
        const directionMultiplier = walkDirection === 'right' ? 1 : -1;
        let newPos = prevPos + (WALK_SPEED * directionMultiplier);
        
        // Handle direction change at restricted boundaries (75% of full distance)
        if (newPos >= walkDistance) {
          newPos = walkDistance - 0.1; // Prevent getting stuck at boundary
          setWalkDirection('left');
          setCurrentAnimation('walkLeft');
        } else if (newPos <= -walkDistance) {
          newPos = -walkDistance + 0.1; // Prevent getting stuck at boundary
          setWalkDirection('right');
          setCurrentAnimation('walkRight');
        } else {
          setCurrentAnimation(walkDirection === 'right' ? 'walkRight' : 'walkLeft');
        }
        
        // Update normalized position (-10 to 10 scale) for consistent resizing
        if (fullWalkDistance > 0) {
          setNormalizedPos((newPos / fullWalkDistance) * 10);
        }

        return newPos;
      });

      animationRef.current = requestAnimationFrame(moveMonster);
    };

    animationRef.current = requestAnimationFrame(moveMonster);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isWalking, walkDistance, walkDirection]);

  // Handle idle/walking state changes
  useEffect(() => {
    const decideState = () => {
      const shouldWalk = Math.random() < 0.3; // 30% chance to walk
      setIsWalking(shouldWalk);
      
      // Set a random time for the next state change (between 2-5 seconds)
      const nextStateChange = 2000 + Math.random() * 3000;
      
      idleTimerRef.current = window.setTimeout(() => {
        decideState();
      }, nextStateChange);
    };

    decideState();
    
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Render effect buttons separately
  const renderEffectButtons = () => (
    <div className="flex flex-wrap justify-center gap-2 mt-2">
      {[
        { text: 'Small Heal', color: 'bg-green-500 hover:bg-green-600' },
        { text: 'Medium Heal', color: 'bg-blue-500 hover:bg-blue-600' },
        { text: 'Large Heal', color: 'bg-purple-500 hover:bg-purple-600' },
        { text: 'Full Heal', color: 'bg-pink-500 hover:bg-pink-600' },
        { text: 'Revive', color: 'bg-yellow-500 hover:bg-yellow-600' }
      ].map(({ text, color }) => (
        <button 
          key={text}
          onClick={() => onEffectTrigger(text)}
          className={`px-3 py-1.5 text-sm rounded transition-colors whitespace-nowrap text-white ${
            currentEffect ? 'bg-gray-400 cursor-not-allowed' : color
          }`}
          disabled={!!currentEffect}
        >
          {text}
        </button>
      ))}
    </div>
  );

  // Calculate position on -10 to 10 scale for display purposes
  const normalizedPosition = fullWalkDistance > 0 
    ? Math.round((position / fullWalkDistance) * 10 * 10) / 10
    : 0;

  return (
    <div className="monster-status-container flex flex-col h-full bg-[#814E33]/20 rounded-lg p-4">
      <div className="monster-status-header px-2 py-1 flex justify-between items-center">
        <div className="text-left">
          <span className={`font-bold ${theme.text}`}>Status:</span> <span className={theme.text}>{monster.status.type}</span>
        </div>
        <div className="text-right">
          {DEV_MODE && (
            <select 
              value={selectedBackground} 
              onChange={(e) => setSelectedBackground(e.target.value)}
              className="bg-gray-700 text-white text-sm rounded-md px-2 py-1 border border-gray-500"
            >
              <option value="home">Home</option>
              <option value="beach">Beach</option>
              <option value="forest">Forest</option>
              <option value="greenhouse">Greenhouse</option>
            </select>
          )}
        </div>
      </div>
      
      {/* Main Window with 4:2 aspect ratio */}
      <div 
        ref={containerRef}
        className={`monster-window relative overflow-hidden rounded-lg border-2 ${theme.border} bg-[#814E33]/10`}
        style={{
          width: '100%',
          minWidth: '5rem', // Minimum width of 5rem
          aspectRatio: '4/2', // 4:2 aspect ratio (width:height)
          position: 'relative'
        }}
      >
        {/* Background */}
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
        
        {/* Monster */}
        {monsterSize > 0 && (
          <div 
            className="monster-container absolute left-1/2 flex flex-col items-center"
            style={{
              width: `${monsterSize}px`,
              height: `${monsterSize}px`,
              transform: `translateX(calc(-50% + ${position}px))`,
              // Using pixel position that scales with container size
              // bottom: '2.5%', /* Raised from bottom by 2.5% of container height */
              bottom: 0,
              transition: 'transform 0.1s linear',
              zIndex: 10
            }}
          >
            {/* Position indicator above the monster - only shown in dev mode */}
            {DEV_MODE && (
              <div className="absolute -top-6 bg-black bg-opacity-70 text-white text-xs px-2 py-0.5 rounded whitespace-nowrap">
                Pos: {normalizedPosition.toFixed(1)} | {currentAnimation}
              </div>
            )}
            <MonsterSpriteView 
              sprite={monster.sprite || ''}
              currentAnimation={currentAnimation}
              behaviorMode={isWalking ? 'pacing' : 'static'}
              containerWidth={monsterSize}
              containerHeight={monsterSize}
              activityType={monster.status.type}
              effect={currentEffect as any}
              onEffectComplete={() => {}}
            />
          </div>
        )}
        
        {/* Status Effect Particles - Only show when monster is playing and no other effect is active */}
        {monster.status.type === 'Play' && !currentEffect && (
          <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2">
            <div className="flex gap-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Show Card Button */}
      {onShowCard && (
        <div className="mt-4">
          <button
            onClick={onShowCard}
            className={`w-full py-2 px-4 rounded-lg font-semibold transition-colors ${
              theme.buttonBg
            } ${theme.buttonHover} ${theme.text}`}
          >
            Show Card
          </button>
        </div>
      )}
      
      {/* Effect Buttons - Only show in dev mode */}
      {DEV_MODE && (
        <div className="mt-2 pt-2 border-t border-gray-300">
          {renderEffectButtons()}
        </div>
      )}
    </div>
  );
};

export default MonsterStatusWindow;
