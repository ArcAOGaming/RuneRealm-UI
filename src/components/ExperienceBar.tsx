import React from 'react';
import { currentTheme } from '../constants/theme';

interface ExperienceBarProps {
  exp: number;
  level: number;
  darkMode: boolean;
  getFibonacciExp: (level: number) => number;
}

export const ExperienceBar: React.FC<ExperienceBarProps> = ({ exp, level, darkMode, getFibonacciExp }) => {
  const theme = currentTheme(darkMode);
  const requiredExp = getFibonacciExp(level);
  const progressPercentage = Math.min(100, (exp / requiredExp) * 100);

  return (
    <div className="col-span-2">
      <div className="flex justify-between mb-1">
        <span className={`${theme.text} text-sm`}>Experience</span>
        <span className={`${theme.text} text-sm`}>{exp}/{requiredExp}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div 
          className="bg-purple-600 h-2.5 rounded-full" 
          style={{ width: `${progressPercentage}%` }}
        ></div>
      </div>
    </div>
  );
};
