import React from 'react';
import { Gateway } from '../constants/Constants';

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
  actionText: string;
  loadingText: string;
  theme: any;
  highlightSelectable?: boolean;
  remainingTime?: string;
  progress?: number;
}

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
  actionText,
  loadingText,
  theme,
  highlightSelectable = false,
  remainingTime,
  progress
}) => {
  // Enhanced border effect for selectable items
  const borderStyle = !isDisabled && highlightSelectable
    ? `border-2 border-${gradientFrom}`
    : `border-2 ${theme.border}`;

  // Enhanced glow effect for selectable items
  const glowEffect = !isDisabled && highlightSelectable
    ? `shadow-lg shadow-${gradientFrom}/20`
    : '';
    
  // Enhanced scale effect for selectable items
  const hoverEffect = !isDisabled
    ? 'hover:scale-105'
    : '';

  // Enhanced button styling for better visual feedback
  const buttonStyle = !isDisabled 
    ? `bg-gradient-to-r from-${gradientFrom} to-${gradientTo} hover:from-${gradientFrom}-700 hover:to-${gradientTo}-700 transform hover:scale-105 hover:shadow-md` 
    : 'bg-gray-400 cursor-not-allowed';

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
      className={`activity-card relative overflow-hidden rounded-xl 
      ${theme.container} ${borderStyle} ${glowEffect} transform ${hoverEffect} 
      transition-all duration-300 h-[200px] w-[180px] flex flex-col`}>
      
      {/* Gradient bar at top */}
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-${gradientFrom} to-${gradientTo}`}></div>
      
      {/* Selectable indicator */}
      <SelectableIndicator />
      
      {/* Main content */}
      <div className="p-3 flex flex-col h-full">
        {/* Header */}
        <div className="flex justify-between items-center mb-2">
          <h3 className={`text-base font-bold ${theme.text}`}>{title}</h3>
          <span className={`px-1.5 py-0.5 bg-${badgeColor} text-${badgeColor}-900 rounded-full text-xs font-bold`}>
            {badge}
          </span>
        </div>
        
        {/* Token info and requirements */}
        <div className="flex-grow space-y-2">
          {/* Token display */}
          <div className="flex items-center gap-1.5 mb-2">
            {tokenLogo && (
              <img 
                src={`${Gateway}${tokenLogo}`}
                alt="Token"
                className="w-5 h-5 rounded-full"
              />
            )}
            <span className={`text-base font-medium ${tokenBalance >= tokenRequired ? 'text-green-500' : 'text-red-500'}`}>
              {tokenBalance}/{tokenRequired}
            </span>
          </div>
          
          {/* Costs and Rewards side by side */}
          <div className="flex justify-between items-start">
            {/* Costs section */}
            <div className="space-y-1">
              {costs.map((cost, index) => {
                // Extract just the number from the text
                const number = cost.text.match(/-?\d+/)?.[0] || '';
                // Replace energy emoji with battery if present
                const icon = cost.icon === '⚡' ? '🔋' : cost.icon;
                return (
                  <div key={index} className="flex items-center gap-1">
                    <span>{icon}</span>
                    <span className={`text-base ${cost.isAvailable ? 'text-red-500' : 'text-red-700'}`}>{number}</span>
                  </div>
                );
              })}
            </div>

            {/* Rewards section */}
            <div className="space-y-1">
              {rewards.map((reward, index) => {
                // Extract just the number from the text
                const number = reward.text.match(/\d+/)?.[0] || '';
                // Replace energy emoji with battery if present
                const icon = reward.icon === '⚡' ? '🔋' : reward.icon;
                return (
                  <div key={index} className="flex items-center gap-1">
                    <span>{icon}</span>
                    <span className={`text-base text-${reward.color}`}>+{number}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Progress bar if activity is in progress */}
        {progress !== undefined && (
          <div className="mt-1 mb-1">
            <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
              <div 
                className={`h-full bg-gradient-to-r from-${gradientFrom} to-${gradientTo}`} 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            {remainingTime && (
              <div className="text-xs text-center mt-0.5 font-medium text-gray-600">
                {remainingTime}
              </div>
            )}
          </div>
        )}
        
        {/* Action button - always at bottom */}
        <div className="mt-2">
          <button
            onClick={onAction}
            disabled={isLoading || isDisabled}
            className={`w-full px-3 py-1.5 rounded-lg font-bold text-white text-sm
              ${buttonStyle} transition-all duration-300 
              ${!isDisabled && highlightSelectable ? 'ring-2 ring-offset-1 ring-' + gradientFrom : ''}`}
          >
            {isLoading ? loadingText : actionText}
          </button>
        </div>
      </div>
    </div>
  );
};
