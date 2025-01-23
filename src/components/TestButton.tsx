import React from 'react';
import { SpriteCacheService } from '../services/SpriteCacheService';

interface TestButtonProps {
  layers: {
    [key: string]: {
      style: string;
      color: string;
    };
  };
  darkMode?: boolean;
}

const TestButton: React.FC<TestButtonProps> = ({ layers, darkMode = false }) => {
  const handleTest = async () => {
    try {
      console.log('Starting test...');
      console.log(layers);
      
      // Get or create sprite sheet using cache
      // const canvas = await SpriteCacheService.getOrCreateSprite(layers, {
      //   width: 576, // 12 frames * 48 pixels
      //   height: 60, // Single row height
      //   includeBase: true
      // });
      const canvas = await SpriteCacheService.cacheSprite(layers, {
        width: 576, // 12 frames * 48 pixels
        height: 60, // Single row height
        includeBase: true
      });
      
      // For testing purposes, let's display the result in a new window
      const dataUrl = canvas.toDataURL('image/png');
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(`<img src="${dataUrl}" alt="Generated Sprite Sheet"/>`);
      } else {
        console.log('Preview window blocked. Here\'s the data URL:', dataUrl);
      }
      
    } catch (error) {
      console.error('Test failed:', error);
    }
  };

  return (
    <button
      onClick={handleTest}
      className={`py-2 px-4 rounded-xl text-sm font-medium transition-all duration-300 
        ${darkMode ? 'bg-[#814E33] hover:bg-[#814E33]/90' : 'bg-[#F4860A] hover:bg-[#F4860A]/90'}
        text-[#FCF5D8]`}
    >
      Run Test
    </button>
  );
};

export default TestButton;
