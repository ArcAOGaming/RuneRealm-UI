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
  theme
}) => {
  return (
    <div
  className={`activity-card relative overflow-hidden rounded-xl 
    ${theme.container} border-2 ${theme.border} transform hover:scale-105 
    transition-all duration-300 h-[225px] w-[200px] flex flex-col`}>
        {/* Gradient bar at top */}
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-${gradientFrom} to-${gradientTo}`}></div>
      
      {/* Main content */}
      <div className="p-4 flex flex-col h-full">
        {/* Header */}
        <div className="flex justify-between items-center mb-3">
          <h3 className={`text-lg font-bold ${theme.text}`}>{title}</h3>
          <span className={`px-2 py-1 bg-${badgeColor} text-${badgeColor}-900 rounded-full text-xs font-bold`}>
            {badge}
          </span>
        </div>
        
        {/* Token info and requirements */}
        <div className="flex-grow space-y-2">
          {/* Token display */}
          <div className="flex items-center gap-2 mb-2">
            {tokenLogo && (
              <img 
                src={`${Gateway}${tokenLogo}`}
                alt="Token"
                className="w-6 h-6 rounded-full"
              />
            )}
            <span className={`text-lg font-medium ${tokenBalance >= tokenRequired ? 'text-green-500' : 'text-red-500'}`}>
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
                    <span className="text-lg text-red-500">{number}</span>
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
                    <span className="text-lg text-green-500">+{number}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Action button - always at bottom */}
        <div className="mt-2">
          <button
            onClick={onAction}
            disabled={isLoading || isDisabled}
            className={`w-full px-4 py-2 rounded-lg font-bold text-white text-sm
              ${!isDisabled 
                ? `bg-gradient-to-r from-${gradientFrom} to-${gradientTo} hover:from-${gradientFrom}-500 hover:to-${gradientTo}-600 transform hover:scale-105` 
                : 'bg-gray-400 cursor-not-allowed'
              } transition-all duration-300`}
          >
            {isLoading ? loadingText : actionText}
          </button>
        </div>
      </div>
    </div>
  );
};
