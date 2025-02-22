import React from 'react';
import logoPath from '../assets/rune-realm-transparent.png';

interface SimpleHeaderProps {
  darkMode: boolean;
  theme: any;
}

const SimpleHeader: React.FC<SimpleHeaderProps> = ({ darkMode, theme }) => {
  return (
    <div className="flex justify-between items-center p-4 flex-shrink-0">
      <img src={logoPath} alt="Rune Realm Logo" className="h-16 sm:h-28 w-auto mx-4" />
    </div>
  );
};

export default SimpleHeader;
