interface ClothesSelectorProps {
  layerType: string;  // e.g., "PANTS", "SHIRT"
  currentStyle: string; // e.g., "STYLE1", "STYLE2"
  availableStyles: string[];
  onStyleChange: (style: string) => void;
  darkMode?: boolean;
}

const ClothesSelector: React.FC<ClothesSelectorProps> = ({
  layerType,
  currentStyle,
  availableStyles,
  onStyleChange,
  darkMode,
}) => {
  return (
    <div className="flex items-center space-x-3">
      <label className={`text-sm font-semibold capitalize min-w-[70px] truncate ${darkMode ? 'text-white' : 'text-gray-700'}`}>
        {layerType}:
      </label>
      <select
        value={currentStyle}
        onChange={(e) => onStyleChange(e.target.value)}
        className={`flex-1 py-2 px-3 text-sm rounded-lg transition-all duration-300 
          ${darkMode ? 'bg-[#3B2412]/80 border-[#F4860A]/40 text-white focus:border-[#F4860A]/70 focus:ring-[#F4860A]/30' : 'bg-white/60 border-orange-200/40 text-gray-800 focus:border-orange-400/60 focus:ring-orange-200/30'}
          outline-none hover:border-opacity-50 hover:bg-white/70 shadow-sm hover:shadow-md`}
      >
        {availableStyles.map((style) => (
          <option 
            key={style} 
            value={style}
            className={darkMode ? 'bg-[#3B2412] text-white' : 'bg-white text-gray-800'}
          >
            {style}
          </option>
        ))}
      </select>
    </div>
  );
};

export default ClothesSelector;
