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
  className?: string;
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
  highlightSelectable = false,
  className = ''
}) => {
  // Detect minimized mode
  const isMinimized = className?.includes('minimized');
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
      className={`activity-card relative overflow-hidden ${theme.container} border ${theme.border} ${isMinimized ? 'rounded-lg' : 'rounded-xl'} hover:shadow-xl transition-all duration-300 ${hoverEffect} ${glowEffect} ${isMinimized ? 'h-full' : ''}`}>
      
      {/* Selectable indicator */}
      <SelectableIndicator />
      
      <div className={`${isMinimized ? 'p-2 flex flex-col h-full' : 'p-4'}`}>
        {/* Header */}
        <div className={`flex items-center justify-between ${isMinimized ? 'mb-1' : 'mb-3'}`}>
          <div className="flex items-center gap-1">
            <div className={`${isMinimized ? 'p-1' : 'p-1.5'} bg-white/20 backdrop-blur-sm rounded-lg`}>
              <IconComponent className={`${isMinimized ? 'w-3 h-3' : 'w-4 h-4'} ${theme.text}`} />
            </div>
            <h3 className={`${isMinimized ? 'text-sm' : 'text-lg'} font-semibold ${theme.text}`}>{title}</h3>
          </div>
          <div className={`px-2 py-1 bg-${badgeColor}-500 text-${badgeColor}-900 rounded-full ${isMinimized ? 'text-xs' : 'text-xs'} font-bold`}>
            {badge}
          </div>
        </div>

        {/* Stats */}
        <div className={`flex items-center gap-2 ${isMinimized ? 'mb-1' : 'mb-3'}`}>
          <div className="flex items-center gap-1">
            {tokenLogo ? (
              <img 
                src={`${Gateway}${tokenLogo}`}
                alt="Token"
                className={isMinimized ? 'w-3 h-3 rounded-full' : 'w-4 h-4 rounded-full'}
              />
            ) : (
              <Trophy className={`${isMinimized ? 'w-3 h-3' : 'w-3 h-3'} ${theme.text}`} />
            )}
            <span className={`${isMinimized ? 'text-xs' : 'text-sm'} font-bold ${theme.text}`}>{tokenBalance}/{tokenRequired}</span>
          </div>
          <div className="flex items-center gap-1">
            {/* Cost display */}
            {costs.map((cost, index) => {
              const number = cost.text.match(/-?\d+/)?.[0] || '';
              const icon = getRewardIcon(cost);
              return (
                <div key={index} className="flex items-center gap-0.5">
                  <span className={isMinimized ? 'text-xs' : 'text-xs'}>{icon}</span>
                  <span className={`${isMinimized ? 'text-xs' : 'text-xs'} font-semibold ${cost.isAvailable ? 'text-red-500' : 'text-red-400'}`}>
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
                  <span className={isMinimized ? 'text-xs' : 'text-xs'}>{icon}</span>
                  <span className={`${isMinimized ? 'text-xs' : 'text-xs'} font-semibold text-green-500`}>+{number}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onAction}
          disabled={isLoading || isDisabled}
          className={`w-full ${buttonStyle} ${isMinimized ? 'py-1.5 text-sm mt-auto' : 'py-1.5 text-sm'} rounded-lg transition-all duration-200 ${
            isLoading || isDisabled ? 'opacity-50 cursor-not-allowed' : ''
          } ${!isDisabled && highlightSelectable ? 'ring-2 ring-offset-1 ring-opacity-50' : ''}`}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
};
