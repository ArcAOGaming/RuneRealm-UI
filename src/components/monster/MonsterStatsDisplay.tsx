import React from 'react';
import { MonsterStats } from '../../utils/aoHelpers';
import { getFibonacciExp } from "../../utils/cardRenderHelpers";
import { Theme } from '../../constants/theme';

interface MonsterStatsDisplayProps {
  monster: MonsterStats;
  theme: Theme;
  isLevelingUp: boolean;
  onLevelUp: () => void;
}

const MonsterStatsDisplay: React.FC<MonsterStatsDisplayProps> = ({
  monster,
  theme,
  isLevelingUp,
  onLevelUp
}) => {
  // Calculate experience needed for next level
  const expNeeded = getFibonacciExp(monster.level);
  const expPercentage = Math.min(100, Math.floor((monster.exp / expNeeded) * 100));
  
  // Calculate energy and happiness percentages
  const energyPercentage = Math.min(100, Math.floor((monster.energy / 100) * 100));
  const happinessPercentage = Math.min(100, Math.floor((monster.happiness / 100) * 100));
  
  // Check if level up is available
  const canLevelUp = monster.status?.type === 'Home' && monster.exp >= expNeeded;

  return (
    <div className={`monster-stats-display ${theme.container} rounded-lg p-4 pr-8 mb-4`}>
      <h3 className={`text-lg font-bold ${theme.text} mb-2`}>Monster Stats</h3>
      
      {/* Energy Bar */}
      <div className="mb-2">
        <div className="flex justify-between items-center">
          <span className={`text-sm ${theme.text}`}>Energy</span>
          <span className={`text-sm ${theme.text}`}>{monster.energy}/100</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4 dark:bg-gray-700">
          <div 
            className="h-4 rounded-full" 
            style={{ 
              width: `${energyPercentage}%`, 
              backgroundColor: theme.statusEnergy || '#60a5fa' 
            }}
          ></div>
        </div>
      </div>
      
      {/* Happiness Bar */}
      <div className="mb-2">
        <div className="flex justify-between items-center">
          <span className={`text-sm ${theme.text}`}>Happiness</span>
          <span className={`text-sm ${theme.text}`}>{monster.happiness}/100</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4 dark:bg-gray-700">
          <div 
            className="h-4 rounded-full" 
            style={{ 
              width: `${happinessPercentage}%`, 
              backgroundColor: theme.statusHappiness || '#f59e0b' 
            }}
          ></div>
        </div>
      </div>
      
      {/* Experience Bar */}
      <div className="mb-2">
        <div className="flex justify-between items-center">
          <span className={`text-sm ${theme.text}`}>Experience</span>
          <span className={`text-sm ${theme.text}`}>{monster.exp}/{expNeeded}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4 dark:bg-gray-700">
          <div 
            className="h-4 rounded-full" 
            style={{ 
              width: `${expPercentage}%`, 
              backgroundColor: theme.statusExperience || '#10b981' 
            }}
          ></div>
        </div>
      </div>
      
      {/* Level Up Button (only shown if eligible) */}
      {canLevelUp && (
        <div className="mt-3">
          <button
            onClick={onLevelUp}
            disabled={isLevelingUp}
            className={`w-full py-2 rounded-lg ${theme.buttonBg} ${theme.buttonHover} ${theme.text} text-center`}
          >
            {isLevelingUp ? 'Leveling...' : 'Level Up'}
          </button>
        </div>
      )}
    </div>
  );
};

export default MonsterStatsDisplay;
