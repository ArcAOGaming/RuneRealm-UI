import React, { useState } from 'react';
import ColorSlider from './ColorSlider';
import ClothesSelector from './ClothesSelector';
import { currentTheme } from "../../constants/theme";

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
  const [activeTab, setActiveTab] = useState(0);
  
  // Group categories into tabs (2 categories per tab)
  const tabs = [
    { name: 'Head', categories: ['Hair', 'Hat'] },
    { name: 'Body', categories: ['Shirt', 'Pants'] },
    { name: 'Accessories', categories: ['Gloves', 'Shoes'] }
  ];

  const activeCategories = tabs[activeTab]?.categories || [];

  return (
    <div className="w-full">
      {/* Tab Navigation */}
      <div className="flex mb-4 rounded-xl overflow-hidden backdrop-blur-md bg-white/10 border border-orange-200/20 shadow-lg">
        {tabs.map((tab, index) => (
          <button
            key={tab.name}
            onClick={() => setActiveTab(index)}
            className={`flex-1 py-3 px-4 text-sm font-medium transition-all duration-300 ${
              activeTab === index
                ? (darkMode ? 'bg-gradient-to-r from-amber-400/80 to-orange-500/80 text-white shadow-lg' : 'bg-gradient-to-r from-amber-400/80 to-orange-500/80 text-white shadow-lg')
                : (darkMode ? 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white' : 'bg-white/5 text-gray-600 hover:bg-white/10 hover:text-gray-800')
            } backdrop-blur-sm border-r border-orange-200/10 last:border-r-0`}
          >
            {tab.name}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-3">
        {activeCategories.map((categoryName) => {
          const layer = layers[categoryName];
          const categoryStyles = availableStyles.find(cat => cat.name === categoryName)?.options || [];
          
          // Safety check: if layer is undefined, return null or skip this category
          if (!layer) {
            console.warn(`Layer for ${categoryName} is undefined`);
            return null;
          }
          
          // Additional safety check for layer properties
          if (!layer.style || !layer.color) {
            console.warn(`Layer for ${categoryName} has missing properties:`, layer);
            return null;
          }
          
          return (
            <div 
              key={categoryName} 
              className="p-4 rounded-xl backdrop-blur-md bg-gradient-to-br from-white/20 to-white/10 
                border border-orange-200/30 shadow-lg hover:shadow-xl transition-all duration-300
                bg-gradient-to-br from-amber-50/30 via-orange-50/20 to-amber-100/10"
            >
              <div className="space-y-3">
                <ClothesSelector
                  layerType={categoryName}
                  currentStyle={layer.style}
                  availableStyles={categoryStyles}
                  onStyleChange={(style) => onStyleChange(categoryName, style)}
                  darkMode={darkMode}
                />
                <ColorSlider
                  layerName={categoryName}
                  color={layer.color}
                  onColorChange={(color) => onColorChange(categoryName, color)}
                  darkMode={darkMode}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LayerSelector;