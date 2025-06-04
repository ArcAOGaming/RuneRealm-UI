import React, { useCallback } from 'react';
import { MonsterStats } from '../utils/aoHelpers';
import MonsterSpriteView from './MonsterSpriteView';

interface MonsterStatusWindowProps {
  monster: MonsterStats;
  theme: {
    container: string;
    text: string;
    buttonBg: string;
    buttonHover: string;
    border: string;
  };
  currentEffect: string | null;
  onEffectTrigger: (effect: string) => void;
  formatTimeRemaining: (until: number) => string;
  calculateProgress: (since: number, until: number) => number;
  isActivityComplete: (monster: MonsterStats) => boolean;
}

export const MonsterStatusWindow: React.FC<MonsterStatusWindowProps> = ({
  monster,
  theme,
  currentEffect,
  onEffectTrigger,
  formatTimeRemaining,
  calculateProgress,
  isActivityComplete,
}) => {
  const activityTimeUp = isActivityComplete(monster);

  const triggerEffect = (effect: string) => {
    onEffectTrigger(effect);
  };

  return (
    <div className={`status-section ${theme.container} rounded-lg p-6`}>
      <h3 className={`text-xl font-bold mb-2 ${theme.text}`}>Current Status</h3>
      
      {/* Status information and progress bar */}
      <div className="flex flex-col space-y-2 mb-4">
        <div className="flex justify-between items-center">
          <span className={`font-medium ${theme.text}`}>
            Status: <span className="font-bold">{monster.status.type}</span>
          </span>
          {monster.status.type !== 'Home' && monster.status.type !== 'Battle' && monster.status.until_time && (
            <span className={`${theme.text} ${activityTimeUp ? 'text-green-500 font-bold' : ''}`}>
              {activityTimeUp ? 'Ready to Return!' : `Time Remaining: ${formatTimeRemaining(monster.status.until_time)}`}
            </span>
          )}
        </div>
        
        {monster.status.type !== 'Home' && monster.status.type !== 'Battle' && monster.status.until_time && (
          <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className={`h-full ${activityTimeUp ? 'bg-green-500' : 'bg-blue-500'} rounded-full`}
              style={{ 
                width: `${calculateProgress(monster.status.since, monster.status.until_time)}%` 
              }}
            ></div>
          </div>
        )}
      </div>
      
      {/* Monster Status Scene */}
      <div 
        className="monster-status-scene relative bg-cover bg-center rounded-lg overflow-hidden"
        style={{
          height: '280px',
          backgroundImage: monster.status.type === 'Home' 
            ? `url(${new URL('../assets/backgrounds/home.png', import.meta.url).href})` 
            : monster.status.type === 'Battle'
              ? `url(${new URL('../assets/backgrounds/1.png', import.meta.url).href})`
              : `url(${new URL('../assets/backgrounds/activity.png', import.meta.url).href})`
        }}
      >
        {/* Status Bubble */}
        <div className="absolute top-2 right-2 bg-white bg-opacity-80 rounded-full px-3 py-1 z-10 font-semibold text-sm">
          {monster.status.type === 'Home' ? 'Resting at Home' : monster.status.type}
        </div>
        
        {/* Animated Monster Sprite */}
        <MonsterSpriteView 
          sprite={monster.sprite}
          containerWidth={400}
          containerHeight={280}
          behaviorMode={monster.status.type === 'Home' ? 'pacing' : 'activity'}
          activityType={monster.status.type}
          effect={currentEffect as any}
          onEffectComplete={() => {}}
        />
        
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
        
        {/* Effect Test Buttons */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-2 p-2 bg-black bg-opacity-50 z-20">
          <button 
            onClick={() => triggerEffect('Small Heal')}
            className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors whitespace-nowrap"
            disabled={!!currentEffect}
          >
            Small Heal
          </button>
          <button 
            onClick={() => triggerEffect('Medium Heal')}
            className="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 transition-colors whitespace-nowrap"
            disabled={!!currentEffect}
          >
            Medium Heal
          </button>
          <button 
            onClick={() => triggerEffect('Large Heal')}
            className="px-2 py-1 bg-purple-500 text-white text-xs rounded hover:bg-purple-600 transition-colors whitespace-nowrap"
            disabled={!!currentEffect}
          >
            Large Heal
          </button>
          <button 
            onClick={() => triggerEffect('Full Heal')}
            className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition-colors whitespace-nowrap"
            disabled={!!currentEffect}
          >
            Full Heal
          </button>
          <button 
            onClick={() => triggerEffect('Revive')}
            className="px-2 py-1 bg-yellow-500 text-white text-xs rounded hover:bg-yellow-600 transition-colors whitespace-nowrap"
            disabled={!!currentEffect}
          >
            Revive
          </button>
        </div>
      </div>
    </div>
  );
};

export default MonsterStatusWindow;
