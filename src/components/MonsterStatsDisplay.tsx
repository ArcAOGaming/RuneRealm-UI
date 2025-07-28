import React from 'react';
import { MonsterStats } from '../utils/aoHelpers';
import { getFibonacciExp } from '../utils/cardRenderHelpers';
import { Theme } from '../constants/theme';
import { Zap, Heart, Star, TrendingUp } from 'lucide-react';

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
  const expRemaining = expNeeded - monster.exp;

  return (
    <div className="bg-white/80 backdrop-blur-sm border-2 border-white/50 shadow-xl rounded-xl p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {/* <div className="p-2 bg-gradient-to-r from-slate-600 to-slate-700 rounded-xl shadow-lg">
          <TrendingUp className="w-6 h-6 text-white" />
        </div> */}
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
            Monster Stats
          </h1>
          <p className="text-slate-600 text-sm">Track your companion's progress</p>
        </div>
      </div>

      {/* Energy */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-orange-500" />
            <span className="text-lg font-semibold text-slate-800">Energy</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium">{monster.energy}/100</span>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden">
          <div 
            className="h-6 bg-gradient-to-r from-orange-400 to-yellow-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${energyPercentage}%` }}
          />
        </div>
      </div>

      {/* Happiness */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-pink-500" />
            <span className="text-lg font-semibold text-slate-800">Happiness</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium">{monster.happiness}/100</span>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden">
          <div 
            className="h-6 bg-gradient-to-r from-pink-400 to-rose-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${happinessPercentage}%` }}
          />
        </div>
      </div>

      {/* Experience */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-blue-500" />
            <span className="text-lg font-semibold text-slate-800">Experience</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium">{monster.exp}/{expNeeded}</span>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden">
          <div 
            className="h-6 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${expPercentage}%` }}
          />
        </div>
      </div>

      {/* Level Up Section */}
      {!canLevelUp && expRemaining > 0 && (
        <div className="text-center text-slate-600 mb-4">
          <p className="text-sm">Need {expRemaining} more XP to level up</p>
        </div>
      )}

      {/* Level Up Button */}
      {canLevelUp && (
        <div className="text-center">
          <button
            onClick={onLevelUp}
            disabled={isLevelingUp}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:transform-none"
          >
            <TrendingUp className="w-5 h-5" />
            {isLevelingUp ? 'Leveling...' : 'Level Up'}
          </button>
        </div>
      )}
    </div>
  );
};

export default MonsterStatsDisplay;
