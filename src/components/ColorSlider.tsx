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

  const handleSliderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const index = Math.min(
      Math.max(Math.floor(percentage * RAINBOW_COLORS.length), 0),
      RAINBOW_COLORS.length - 1
    );
    onColorChange(RAINBOW_COLORS[index]);
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

  return (
    <div className="flex items-center space-x-2">
      {/* Left Arrow */}
      <button
        onClick={() => handleArrowClick('left')}
        className={`w-9 h-9 flex items-center justify-center rounded-lg 
          ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'} 
          transition-colors duration-200`}
        style={{ marginTop: '1px' }}
      >
        <svg className="w-6 h-6" fill="none" stroke="black" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="relative flex-1">
        <style>
          {`
            .color-track {
              height: 16px;
              border-radius: 8px;
              background: linear-gradient(to right, ${RAINBOW_COLORS.join(', ')});
              cursor: pointer;
              position: relative;
            }
          `}
        </style>
        <div className="color-track w-full mt-4 mb-4" onClick={handleSliderClick}>
          <div 
            className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: `${(currentIndex / (RAINBOW_COLORS.length - 1)) * 100}%`,
              width: '24px',
              height: '24px',
              background: '#000000',
              border: '2px solid #ffffff',
              borderRadius: '50%',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              transform: 'translate(-50%, -50%)',
              transition: 'left 0.2s ease-out'
            }}
          />
        </div>
      </div>

      {/* Right Arrow */}
      <button
        onClick={() => handleArrowClick('right')}
        className={`w-9 h-9 flex items-center justify-center rounded-lg 
          ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'} 
          transition-colors duration-200`}
        style={{ marginTop: '1px' }}
      >
        <svg className="w-6 h-6" fill="none" stroke="black" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      <div 
        className={`w-6 h-6 rounded-full border-2 flex-shrink-0 ${
          darkMode ? 'border-gray-600' : 'border-gray-300'
        }`}
        style={{ backgroundColor: color }}
      />
    </div>
  );
};

export default ColorSlider;
