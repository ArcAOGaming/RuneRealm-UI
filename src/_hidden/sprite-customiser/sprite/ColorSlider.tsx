import React, { useState, useRef, useCallback } from 'react';

const RAINBOW_COLORS = [
  // Reds
  '#FF0000', // Pure Red
  '#FF2222', // Bright Red
  '#FF4444', // Light Red
  '#CC0000', // Dark Red
  '#AA0000', // Deeper Red
  '#800000', // Maroon
  
  // Oranges
  '#FF8000', // Pure Orange
  '#FF9933', // Light Orange
  '#FFA500', // Standard Orange
  '#FF6600', // Dark Orange
  '#FF4400', // Deep Orange
  '#CC4400', // Very Deep Orange

  // Yellows
  '#FFFF00', // Pure Yellow
  '#FFEE00', // Bright Yellow
  '#FFD700', // Gold
  '#FFC000', // Dark Yellow
  '#CC9900', // Deep Yellow
  '#996600', // Brown Yellow

  // Greens
  '#00FF00', // Pure Green
  '#22FF22', // Bright Green
  '#44FF44', // Light Green
  '#008000', // Dark Green
  '#006400', // Deep Green
  '#004400', // Forest Green

  // Cyans
  '#00FFFF', // Pure Cyan
  '#00EEEE', // Bright Cyan
  '#00E5EE', // Light Cyan
  '#00CED1', // Dark Cyan
  '#008B8B', // Deep Cyan
  '#006666', // Deep Teal

  // Blues
  '#0000FF', // Pure Blue
  '#2222FF', // Bright Blue
  '#4169E1', // Royal Blue
  '#000080', // Navy Blue
  '#000066', // Deep Navy
  '#191970', // Midnight Blue

  // Purples
  '#8000FF', // Pure Purple
  '#9932CC', // Dark Orchid
  '#800080', // Purple
  '#660066', // Deep Purple
  '#4B0082', // Indigo
  '#330033', // Dark Purple

  // Pinks
  '#FF00FF', // Pure Pink
  '#FF44FF', // Bright Pink
  '#FF69B4', // Hot Pink
  '#C71585', // Medium Violet Red
  '#8B008B', // Dark Magenta
  '#660066', // Deep Pink

  // Browns
  '#8B4513', // Saddle Brown
  '#A0522D', // Sienna
  '#6B4423', // Deep Brown
  '#5C3317', // Chocolate Brown
  '#3D2B1F', // Dark Brown
  '#2F1F15', // Very Dark Brown

  // Grays and Metallics
  '#FFFFFF', // White
  '#E0E0E0', // Light Gray
  '#C0C0C0', // Silver
  '#808080', // Gray
  '#404040', // Dark Gray
  '#000000', // Black
];

interface ColorSliderProps {
  layerName: string;
  color: string;
  onColorChange: (color: string) => void;
  darkMode?: boolean;
}

const ColorSlider: React.FC<ColorSliderProps> = ({ layerName, color, onColorChange, darkMode }) => {
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Find the closest color index
  const findClosestColorIndex = (targetColor: string): number => {
    const getRGB = (hex: string) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    });

    const target = getRGB(targetColor);
    let minDistance = Infinity;
    let closestIndex = 0;

    RAINBOW_COLORS.forEach((color, index) => {
      const current = getRGB(color);
      const distance = Math.sqrt(
        Math.pow(current.r - target.r, 2) +
        Math.pow(current.g - target.g, 2) +
        Math.pow(current.b - target.b, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = index;
      }
    });

    return closestIndex;
  };

  const currentIndex = findClosestColorIndex(color);

  const getColorFromPosition = useCallback((clientX: number) => {
    if (!sliderRef.current) return color;
    
    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const index = Math.min(
      Math.max(Math.floor(percentage * RAINBOW_COLORS.length), 0),
      RAINBOW_COLORS.length - 1
    );
    return RAINBOW_COLORS[index];
  }, [color]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    const newColor = getColorFromPosition(e.clientX);
    onColorChange(newColor);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      const newColor = getColorFromPosition(e.clientX);
      onColorChange(newColor);
    }
  }, [isDragging, getColorFromPosition, onColorChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    setIsDragging(true);
    const touch = e.touches[0];
    const newColor = getColorFromPosition(touch.clientX);
    onColorChange(newColor);
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (isDragging) {
      e.preventDefault(); // Prevent scrolling
      const touch = e.touches[0];
      const newColor = getColorFromPosition(touch.clientX);
      onColorChange(newColor);
    }
  }, [isDragging, getColorFromPosition, onColorChange]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleSliderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const newColor = getColorFromPosition(e.clientX);
    onColorChange(newColor);
  };

  const handleArrowClick = (direction: 'left' | 'right') => {
    let newIndex = currentIndex;
    if (direction === 'left') {
      newIndex = (currentIndex - 1 + RAINBOW_COLORS.length) % RAINBOW_COLORS.length;
    } else {
      newIndex = (currentIndex + 1) % RAINBOW_COLORS.length;
    }
    onColorChange(RAINBOW_COLORS[newIndex]);
  };

  // Add global mouse and touch event listeners
  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  return (
    <div className="flex items-center space-x-3">
      {/* Left Arrow */}
      <button
        onClick={() => handleArrowClick('left')}
        className={`w-8 h-8 flex items-center justify-center rounded-lg 
          ${darkMode ? 'bg-[#3B2412]/80 border-[#F4860A]/40 text-white' : 'bg-white/60 border-orange-200/40 text-gray-700'} 
          hover:bg-white/80 hover:border-orange-300/50 transition-all duration-200
          shadow-sm hover:shadow-md`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="relative flex-1">
        <style>
          {`
            .color-track {
              height: 20px;
              border-radius: 10px;
              background: linear-gradient(to right, ${RAINBOW_COLORS.join(', ')});
              cursor: pointer;
              position: relative;
              box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
              border: 1px solid rgba(255,255,255,0.3);
              user-select: none;
            }
            .color-track:hover {
              box-shadow: inset 0 2px 4px rgba(0,0,0,0.15);
            }
          `}
        </style>
        <div 
          ref={sliderRef}
          className="color-track w-full" 
          onClick={handleSliderClick}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <div 
            className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: `${(currentIndex / (RAINBOW_COLORS.length - 1)) * 100}%`,
              width: '28px',
              height: '28px',
              background: '#ffffff',
              border: '3px solid #000000',
              borderRadius: '50%',
              boxShadow: '0 4px 8px rgba(0,0,0,0.2), 0 0 0 2px rgba(255,255,255,0.8)',
              transform: 'translate(-50%, -50%)',
              transition: isDragging ? 'none' : 'left 0.1s ease-out'
            }}
          />
        </div>
      </div>

      {/* Right Arrow */}
      <button
        onClick={() => handleArrowClick('right')}
        className={`w-8 h-8 flex items-center justify-center rounded-lg 
          ${darkMode ? 'bg-[#3B2412]/80 border-[#F4860A]/40 text-white' : 'bg-white/60 border-orange-200/40 text-gray-700'} 
          hover:bg-white/80 hover:border-orange-300/50 transition-all duration-200
          shadow-sm hover:shadow-md`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      <div 
        className="w-8 h-8 rounded-full border-3 flex-shrink-0 shadow-lg"
        style={{ 
          backgroundColor: color,
          border: '2px solid #000000',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15), inset 0 1px 2px rgba(255,255,255,0.3)'
        }}
      />
    </div>
  );
};

export default ColorSlider;
