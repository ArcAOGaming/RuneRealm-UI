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
}

const MonsterStatusWindow: React.FC<MonsterStatusWindowProps> = ({
  monster,
  theme,
  currentEffect,
  onEffectTrigger,
  formatTimeRemaining,
  calculateProgress,
  isActivityComplete,
}) => {
  const activityTimeUp = isActivityComplete(monster);
  const [isWalking, setIsWalking] = useState(false);
  const [position, setPosition] = useState(0);
  const [walkDirection, setWalkDirection] = useState<WalkDirection>('right');
  const [currentAnimation, setCurrentAnimation] = useState<AnimationType>('idle');
  const [monsterSize, setMonsterSize] = useState(0);
  const [walkDistance, setWalkDistance] = useState(0);
  const idleTimerRef = useRef<number>();
  const animationRef = useRef<number>();
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Constants for movement
  const WALK_SPEED = 1;
  
  // Update walk distance when container size changes
  useEffect(() => {
    if (containerRef.current) {
      // Calculate walk distance based on container width minus monster size
      setWalkDistance((containerRef.current.offsetWidth - monsterSize) / 2);
    }
  }, [monsterSize]);
  
  // Update monster size based on container dimensions
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        // Set container to maintain 4:2 aspect ratio
        const containerWidth = containerRef.current.offsetWidth;
        const containerHeight = containerWidth * 0.5; // 4:2 aspect ratio (width:height)
        containerRef.current.style.height = `${containerHeight}px`;
        
        // Set monster size to be 1/4 of container width
        const monsterWidth = containerWidth * 0.25; // 1/4 of container width
        setMonsterSize(monsterWidth);
      }
    };
    
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      resizeObserver.disconnect();
    };
  }, []);
  
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
        
        // Handle direction change at boundaries
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
    <div className="flex flex-wrap justify-center gap-2 mt-4">
      {['Small Heal', 'Medium Heal', 'Large Heal', 'Full Heal', 'Revive'].map((effect) => (
        <button 
          key={effect}
          onClick={() => onEffectTrigger(effect)}
          className={`px-3 py-1.5 text-sm rounded transition-colors whitespace-nowrap ${
            currentEffect 
              ? 'bg-gray-400 cursor-not-allowed' 
              : effect.includes('Heal') 
                ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                : effect === 'Revive' 
                  ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                  : 'bg-purple-500 hover:bg-purple-600 text-white'
          }`}
          disabled={!!currentEffect}
        >
          {effect}
        </button>
      ))}
    </div>
  );

  // Calculate position on -10 to 10 scale
  const normalizedPosition = walkDistance > 0 
    ? Math.round((position / walkDistance) * 10 * 10) / 10
    : 0;

  return (
    <div className="flex flex-col h-full">
      <div 
        ref={containerRef}
        className={`relative overflow-hidden rounded-lg border-2 ${theme.border} ${theme.container} flex-1 flex flex-col`}
        style={{ minHeight: '250px' }}
      >
        <div className="px-2 py-1">
          <h3 className={`text-xl font-bold ${theme.text} text-center`}>Current Status</h3>
        </div>
        
        {/* Monster Status Scene */}
        <div className="relative flex-1">
          <div 
            className="relative w-full h-full"
            style={{
              backgroundImage: monster.status.type === 'Home' 
                ? `url(${new URL('../assets/backgrounds/home.png', import.meta.url).href})` 
                : monster.status.type === 'Battle'
                  ? `url(${new URL('../assets/backgrounds/1.png', import.meta.url).href})`
                  : `url(${new URL('../assets/backgrounds/activity.png', import.meta.url).href})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              borderRadius: '0.5rem',
              border: '2px solid black',
              overflow: 'hidden',
              position: 'relative'
            }}
          >
            {/* Status Bubble */}
            <div className="absolute top-2 right-2 bg-white bg-opacity-80 rounded-full px-3 py-1 z-10 font-semibold text-sm">
              {monster.status.type === 'Home' ? 'Resting at Home' : monster.status.type}
            </div>

            {/* Animated Monster Sprite */}
            {monsterSize > 0 && (
              <div 
                className="absolute bottom-0 left-1/2 transform -translate-x-1/2 flex flex-col items-center"
                style={{
                  width: '25%',
                  height: 'auto',
                  aspectRatio: '1',
                  transform: `translateX(${position}px) translateX(-50%)`,
                  transition: 'transform 0.5s ease-out',
                  zIndex: 10,
                  maxWidth: '100%',
                  maxHeight: '100%',
                  bottom: '0'
                }}
              >
                {/* Position indicator above the monster */}
                <div className="absolute -top-6 bg-black bg-opacity-70 text-white text-xs px-2 py-0.5 rounded whitespace-nowrap">
                  Pos: {normalizedPosition.toFixed(1)} | {currentAnimation}
                </div>
                <MonsterSpriteView 
                  sprite={monster.sprite}
                  currentAnimation={currentAnimation}
                  containerWidth={monsterSize}
                  containerHeight={monsterSize}
                  behaviorMode={isWalking ? 'pacing' : 'static'}
                  activityType={monster.status.type}
                  effect={currentEffect as any}
                  onEffectComplete={() => {}}
                />
              </div>
            )}
        
            {/* Status Effect Particles */}
            {monster.status.type === 'Play' && (
              <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2">
                <div className="flex gap-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Effect Buttons */}
      <div className="mt-2 pt-2 border-t border-gray-300">
        {renderEffectButtons()}
      </div>
    </div>
  );
};

export default MonsterStatusWindow;
