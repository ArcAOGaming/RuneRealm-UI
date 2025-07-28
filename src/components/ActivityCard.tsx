import React from 'react';
import { Gateway } from '../constants/Constants';
import { Zap, Play, Sword, Compass, Trophy } from 'lucide-react';

interface ActivityCardProps {
  title: string;
  badge: string;
  badgeColor: string;
  gradientFrom: string;
  gradientTo: string;
  tokenLogo?: string;
  tokenBalance: number;
  tokenRequired: number;
  costs: Array<{
    icon: string;
    text: string;
    isAvailable: boolean;
  }>;
  rewards: Array<{
    icon: string;
    text: string;
    color: string;
  }>;
  onAction: () => void;
  isLoading: boolean;
  isDisabled: boolean;
  buttonText: string;
  theme: any;
  highlightSelectable?: boolean;
}

// Activity color configurations matching the beautiful design
const activityColors = {
  Feed: {
    bgGradient: 'from-blue-500/10 to-cyan-500/10',
    borderColor: 'border-blue-200',
    buttonColor: 'bg-blue-500 hover:bg-blue-600',
    icon: Zap,
    textColor: 'text-slate-800'
  },
  Play: {
    bgGradient: 'from-green-500/10 to-emerald-500/10',
    borderColor: 'border-green-200',
    buttonColor: 'bg-green-500 hover:bg-green-600',
    icon: Play,
    textColor: 'text-slate-800'
  },
  Battle: {
    bgGradient: 'from-red-500/10 to-orange-500/10',
    borderColor: 'border-red-200',
    buttonColor: 'bg-red-500 hover:bg-red-600',
    icon: Sword,
    textColor: 'text-slate-800'
  },
  Explore: {
    bgGradient: 'from-purple-500/10 to-indigo-500/10',
    borderColor: 'border-purple-200',
    buttonColor: 'bg-purple-500 hover:bg-purple-600',
    icon: Compass,
    textColor: 'text-slate-800'
  }
};

export const ActivityCard: React.FC<ActivityCardProps> = ({
  title,
  badge,
  badgeColor,
  gradientFrom,
  gradientTo,
  tokenLogo,
  tokenBalance,
  tokenRequired,
  costs,
  rewards,
  onAction,
  isLoading,
  isDisabled,
  buttonText,
  theme,
  highlightSelectable = false
}) => {
  // Get activity configuration
  const activityConfig = activityColors[title] || activityColors.Feed;
  const IconComponent = activityConfig.icon;
  
  // Helper to get reward icons
  const getRewardIcon = (cost: any) => {
    if (cost.icon === '⚡' || cost.text.includes('Energy')) return '⚡';
    if (cost.text.includes('Happy') || cost.icon === '💝') return '❤️';
    return '💰';
  };

  // Enhanced border effect for selectable items
  const borderStyle = !isDisabled && highlightSelectable
    ? `border-2 border-${gradientFrom}`
    : activityConfig.borderColor;

  // Enhanced glow effect for selectable items
  const glowEffect = !isDisabled && highlightSelectable
    ? `shadow-lg shadow-${gradientFrom}/20`
    : '';
    
  // Enhanced scale effect for selectable items
  const hoverEffect = !isDisabled
    ? 'hover:scale-[1.02]'
    : '';

  // Enhanced button styling for better visual feedback
  const buttonStyle = !isDisabled 
    ? `${activityConfig.buttonColor} text-white font-medium shadow-lg hover:shadow-xl` 
    : 'bg-gray-400 cursor-not-allowed text-white';

  // Add a highlight indicator for selectable items
  const SelectableIndicator = () => {
    if (!isDisabled && highlightSelectable) {
      return (
        <div className="absolute top-1 right-1 w-3 h-3 rounded-full animate-pulse bg-green-500"></div>
      );
    }
    return null;
  };

  return (
    <div
      className={`activity-card relative overflow-hidden bg-gradient-to-br ${activityConfig.bgGradient} ${borderStyle} border-2 hover:shadow-xl transition-all duration-300 ${hoverEffect} ${glowEffect} rounded-xl`}>
      
      {/* Selectable indicator */}
      <SelectableIndicator />
      
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg">
              <IconComponent className="w-4 h-4 text-slate-700" />
            </div>
            <h3 className={`text-lg font-semibold ${activityConfig.textColor}`}>{title}</h3>
          </div>
          <div className={`px-2 py-1 bg-${badgeColor}-500 text-${badgeColor}-900 rounded-full text-xs font-bold`}>
            {badge}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-1">
            {tokenLogo ? (
              <img 
                src={`${Gateway}${tokenLogo}`}
                alt="Token"
                className="w-4 h-4 rounded-full"
              />
            ) : (
              <Trophy className="w-3 h-3 text-slate-600" />
            )}
            <span className="text-sm font-bold text-slate-700">{tokenBalance}/{tokenRequired}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Cost display */}
            {costs.map((cost, index) => {
              const number = cost.text.match(/-?\d+/)?.[0] || '';
              const icon = getRewardIcon(cost);
              return (
                <div key={index} className="flex items-center gap-0.5">
                  <span className="text-xs">{icon}</span>
                  <span className={`text-xs font-semibold ${cost.isAvailable ? 'text-red-500' : 'text-red-400'}`}>
                    {number}
                  </span>
                </div>
              );
            })}
            
            {/* Reward display */}
            {rewards.map((reward, index) => {
              const number = reward.text.match(/\d+/)?.[0] || '';
              const icon = getRewardIcon(reward);
              return (
                <div key={index} className="flex items-center gap-0.5">
                  <span className="text-xs">{icon}</span>
                  <span className="text-xs font-semibold text-green-500">+{number}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onAction}
          disabled={isLoading || isDisabled}
          className={`w-full ${buttonStyle} py-1.5 rounded-lg transition-all duration-200 text-sm ${
            isLoading || isDisabled ? 'opacity-50 cursor-not-allowed' : ''
          } ${!isDisabled && highlightSelectable ? 'ring-2 ring-offset-1 ring-opacity-50' : ''}`}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
};
