import React from 'react';
import ColorSlider from './ColorSlider';
import ClothesSelector from './ClothesSelector';
import { currentTheme } from '../constants/theme';

interface LayerSelectorProps {
  layers: {
    [key: string]: {
      style: string;
      color: string;
    };
  };
  availableStyles: {
    name: string;
    options: string[];
  }[];
  onStyleChange: (layerName: string, style: string) => void;
  onColorChange: (layerName: string, color: string) => void;
  darkMode?: boolean;
}

const LayerSelector: React.FC<LayerSelectorProps> = ({
  layers,
  availableStyles,
  onStyleChange,
  onColorChange,
  darkMode = false
}) => {
  const theme = currentTheme(darkMode);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
      {Object.entries(layers).map(([layerName, layer]) => (
        <div 
          key={layerName} 
          className={`p-2 sm:p-3 rounded-xl backdrop-blur-md transition-all duration-300 hover:shadow-lg w-full
            ${theme.container} border ${theme.border}`}
        >
          <div className="space-y-2 w-full">
            <ClothesSelector
              layerType={layerName}
              currentStyle={layer.style}
              availableStyles={availableStyles.find(category => category.name === layerName)?.options || []}
              onStyleChange={(style) => onStyleChange(layerName, style)}
              darkMode={darkMode}
            />
            <ColorSlider
              layerName={layerName}
              color={layer.color}
              onColorChange={(color) => onColorChange(layerName, color)}
              darkMode={darkMode}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default LayerSelector;