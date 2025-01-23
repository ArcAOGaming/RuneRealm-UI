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
    <div className="flex items-center space-x-2">
      <label className="text-xs font-medium capitalize min-w-[60px] truncate">
        {layerType.toLowerCase()}:
      </label>
      <select
        value={currentStyle}
        onChange={(e) => onStyleChange(e.target.value)}
        className={`flex-1 py-1 px-2 text-sm border rounded transition-all duration-300 ${
          darkMode 
            ? 'bg-[#814E33]/20 border-[#F4860A]/30 text-[#FCF5D8] focus:border-[#F4860A]/50' 
            : 'bg-[#FCF5D8]/40 border-[#814E33]/20 text-[#814E33] focus:border-[#814E33]/50'
        } outline-none hover:border-opacity-50`}
      >
        {availableStyles.map((style) => (
          <option 
            key={style} 
            value={style}
            className={darkMode 
              ? 'bg-[#814E33] text-[#FCF5D8]' 
              : 'bg-[#FCF5D8] text-[#814E33]'}
          >
            {style}
          </option>
        ))}
      </select>
    </div>
  );
};

export default ClothesSelector;
