import React from 'react';
import { currentTheme } from '../constants/theme';

interface FooterProps {
  darkMode: boolean;
}

const Footer: React.FC<FooterProps> = ({ darkMode }) => {
  const theme = currentTheme(darkMode);

  return (
    <div className={`flex justify-center items-center gap-2 py-1.5 px-3 ${theme.container} backdrop-blur-sm rounded-b-2xl border-t ${theme.border} flex-shrink-0`}>
      <div className="flex items-center gap-2">
        <span className={`text-base font-bold ${darkMode ? 'text-white/70' : 'text-black/70'}`}>Powered by</span>
        <a 
          href="https://ar.io" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="transition-transform hover:scale-105"
        >
          <img 
            src={darkMode ? new URL('../assets/ARIO-Dark.png', import.meta.url).href : new URL('../assets/ARIO-Light.png', import.meta.url).href} 
            alt="ARIO.png" 
            className="h-10" 
          />
        </a>
        <span className={`text-base font-bold ${darkMode ? 'text-white/70' : 'text-black/70'}`}>+</span>
        <a 
          href="https://ardrive.io/turbo" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="transition-transform hover:scale-105"
        >
          <img 
            src={darkMode ? new URL('../assets/Turbo-Dark.png', import.meta.url).href : new URL('../assets/Turbo-Light.png', import.meta.url).href} 
            alt="Turbo.png" 
            className="h-10" 
          />
        </a>
        <span className={`text-base font-bold ${darkMode ? 'text-white/70' : 'text-black/70'}`}>on</span>
        <a 
          href="https://game.ar.io" 
          target="_blank" 
          rel="noopener noreferrer"
          className="transition-transform hover:scale-105"
        >
          <img 
          src={darkMode ? new URL('../assets/arcao-Dark.png', import.meta.url).href : new URL('../assets/arcao-Light.png', import.meta.url).href} 
          alt="arcao.png" 
          className="h-10" />
        </a>
      </div>
    </div>
  );
};

export default Footer;
