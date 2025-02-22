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
    <div className={`activity-card relative overflow-hidden rounded-xl ${theme.container} border-2 ${theme.border} transform hover:scale-105 transition-all duration-300 h-[140px] flex flex-col`}>
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-${gradientFrom} to-${gradientTo}`}></div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex justify-between items-center mb-2">
          <h3 className={`text-lg font-bold ${theme.text}`}>{title}</h3>
          <span className={`px-2 py-1 bg-${badgeColor} text-${badgeColor}-900 rounded-full text-xs font-bold`}>
            {badge}
          </span>
        </div>
        
        <div className="space-y-2">
          {tokenLogo && (
            <img 
              src={`${Gateway}${tokenLogo}`}
              alt="Token"
              className={`w-6 h-6 rounded-full ${tokenBalance >= tokenRequired ? 'opacity-100' : 'opacity-50'}`}
            />
          )}
          
          {costs.map((cost, index) => (
            <div key={index} className={`flex items-center gap-2 ${cost.isAvailable ? 'text-green-500' : 'text-red-500'}`}>
              <span>{cost.icon}</span>
              <span className="text-sm">{cost.text}</span>
            </div>
          ))}

          {rewards.map((reward, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className={`text-${reward.color}`}>{reward.icon}</span>
              <span className={`text-${reward.color} text-sm`}>{reward.text}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onAction}
          disabled={isLoading || isDisabled}
          className={`w-full mt-auto px-4 py-2 rounded-lg font-bold text-white text-sm
            ${!isDisabled 
              ? `bg-gradient-to-r from-${gradientFrom} to-${gradientTo} hover:from-${gradientFrom}-500 hover:to-${gradientTo}-600 transform hover:scale-105` 
              : 'bg-gray-400 cursor-not-allowed'
            } transition-all duration-300`}
        >
          {isLoading ? loadingText : actionText}
        </button>
      </div>
    </div>
  );
};
