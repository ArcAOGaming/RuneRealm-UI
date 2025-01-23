import React from 'react';
import logoPath from '../assets/rune-realm-transparent.png';

interface SimpleHeaderProps {
  darkMode: boolean;
  onDarkModeToggle: () => void;
  theme: any;
}

const SimpleHeader: React.FC<SimpleHeaderProps> = ({ darkMode, onDarkModeToggle, theme }) => {
  return (
    <div className="flex justify-between items-center p-4 flex-shrink-0">
      <img src={logoPath} alt="Rune Realm Logo" className="h-16 sm:h-28 w-auto mx-4" />
      <button
        onClick={onDarkModeToggle}
        className={`py-2 px-4 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 
          ${theme.buttonBg} ${theme.buttonHover} ${theme.text} 
          backdrop-blur-md shadow-lg hover:shadow-xl border ${theme.border}`}
      >
        {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
      </button>
    </div>
  );
};

export default SimpleHeader;
