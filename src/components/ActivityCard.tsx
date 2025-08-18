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
  buttonText: string;
  theme: any;
  highlightSelectable?: boolean;
  className?: string;
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
  buttonText,
  highlightSelectable = false,
}) => {

  // Helper to get reward icons
  const getRewardIcon = (cost: any) => {
    if (cost.icon === '⚡') return '🔋';
    if (cost.icon === '💝') return '❤️';
    if (cost.icon === '🧭') return '🧭';
    if (cost.icon === '🗡️') return '🗡️';
    return cost.icon;
  };

  // Enhanced border effect for selectable items
  const borderStyle = !isDisabled && highlightSelectable
    ? `border border-[#814E3355]`
    : 'border border-[#e7dfd2]';

  // Enhanced glow effect for selectable items
  const glowEffect = !isDisabled && highlightSelectable
    ? `shadow-lg shadow-${gradientFrom}/20`
    : '';

  // Enhanced scale effect for selectable items
  const hoverEffect = !isDisabled
    ? 'hover:scale-[1.02]'
    : 'hover:shadow-none hover:scale-100';

  // Button uses solid color based on badgeColor if active/enabled, else gray
  const buttonBgMap: Record<string, string> = {
    yellow: 'bg-[#facc15] hover:bg-[#eab308] text-white',
    green: 'bg-[#22c55e] hover:bg-[#16a34a] text-white',
    red: 'bg-[#ef4444] hover:bg-[#dc2626] text-white',
    blue: 'bg-[#3b82f6] hover:bg-[#2563eb] text-white'
  };
  const buttonStyle = !isDisabled
    ? `${buttonBgMap[badgeColor] || 'bg-blue-500 hover:bg-blue-600 text-white'} font-medium shadow-lg hover:shadow-xl`
    : 'bg-gray-300 cursor-not-allowed text-white hover:scale-100 hover:shadow-none';

  // Add a highlight indicator for selectable items
  const SelectableIndicator = () => {
    if (!isDisabled && highlightSelectable) {
      return (
        <div className="absolute top-1 right-1 w-3 h-3 rounded-full animate-pulse bg-green-500"></div>
      );
    }
    return null;
  };

  const badgeTextMap: Record<string, string> = {
    yellow: 'text-[#78350f]',
    green: 'text-[#166534]',
    red: 'text-[#7f1d1d]',
    blue: 'text-[#1e3a8a]'
  };

  return (
    <div
      className={`activity-card relative overflow-hidden bg-[#fcf8f3] ${borderStyle} rounded-lg hover:shadow-xl transition-all duration-300 ${hoverEffect} ${glowEffect}`}>
      <SelectableIndicator />
      <div className="p-2 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          </div>
          <div
            className={`xl:px-2 xl:py-1 px-1 py-0.5 rounded-full xl:text-xs text-[10px] font-bold ${badgeTextMap[badgeColor] || 'text-slate-800'}`}
            style={{
              background: badgeColor === 'yellow'
                ? '#facc15'
                : badgeColor === 'green'
                  ? '#22c55e'
                  : badgeColor === 'red'
                    ? '#ef4444'
                    : badgeColor === 'blue'
                      ? '#3b82f6'
                      : '#e5e7eb'
            }}
          >
            {badge}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-1 flex-wrap">
            {tokenLogo ? (
              <img
                src={`${Gateway}${tokenLogo}`}
                alt="Token"
                className="w-3 h-3 rounded-full"
              />
            ) : (
              <span className="w-3 h-3 inline-block">🪙</span>
            )}
            <span className="text-xs font-bold text-slate-800">{tokenBalance}/{tokenRequired}</span>
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
          className={`w-full ${buttonStyle} py-1.5 text-sm mt-auto rounded-lg transition-all duration-200 ${isLoading || isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
};
