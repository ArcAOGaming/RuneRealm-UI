import React from "react";

interface StruggleButtonProps {
  onAttack: (moveName: string) => void;
  isDisabled: boolean;
  battleStatus: string;
}

/**
 * StruggleButton Component (Redesigned)
 * 
 * Special move button that appears when all regular moves are exhausted (count = 0).
 * The struggle move is a last resort attack that deals minimal damage but can always be used.
 * Redesigned to match the new condensed and informative move button style.
 * 
 * @param onAttack - Callback function when struggle is selected
 * @param isDisabled - Whether the button should be disabled
 * @param battleStatus - Current battle status
 */
const StruggleButton: React.FC<StruggleButtonProps> = ({
  onAttack,
  isDisabled,
  battleStatus,
}) => {
  const isButtonDisabled = isDisabled || battleStatus === "ended";

  return (
    <button
      onClick={() => onAttack("struggle")}
      disabled={isButtonDisabled}
      className={`w-full px-3 py-2 rounded text-sm font-medium text-left transition-all duration-200 
        bg-purple-500 hover:brightness-110 z-10
        ${isButtonDisabled ? "opacity-50 cursor-not-allowed" : ""}
        text-white relative overflow-hidden group flex flex-col`}
    >
      {/* Header: Name and Turn Count */}
      <div className="flex justify-between items-center w-full mb-2">
        <span className="capitalize font-bold text-lg">Struggle</span>
        <span className="text-base bg-black/40 px-2.5 py-0.5 rounded-full font-medium min-w-[2rem] text-center">∞</span>
      </div>
      
      {/* Stats Section - Segmented with clear divisions */}
      <div className="grid grid-cols-5 gap-1 bg-black/10 p-1 rounded-sm">
        <div className="flex items-center justify-center text-green-200 py-0.5 px-1 rounded bg-black/20">
          <span className="text-lg mr-0.5">⚔️</span>
          <span className="font-bold text-base">+1</span>
        </div>
        
        <div className="flex items-center justify-center opacity-50 py-0.5 px-1 rounded bg-black/20">
          <span className="text-lg mr-0.5">💪</span>
          <span className="font-bold text-base">0</span>
        </div>
        
        <div className="flex items-center justify-center opacity-50 py-0.5 px-1 rounded bg-black/20">
          <span className="text-lg mr-0.5">🛡️</span>
          <span className="font-bold text-base">0</span>
        </div>
        
        <div className="flex items-center justify-center opacity-50 py-0.5 px-1 rounded bg-black/20">
          <span className="text-lg mr-0.5">⚡</span>
          <span className="font-bold text-base">0</span>
        </div>
        
        <div className="flex items-center justify-center opacity-50 py-0.5 px-1 rounded bg-black/20">
          <span className="text-lg mr-0.5">❤️</span>
          <span className="font-bold text-base">0</span>
        </div>
      </div>
      
      {/* Last resort label */}
      <div className="text-xs text-center w-full mt-1 opacity-75 italic">
        Last Resort
      </div>
    </button>
  );
};

export default StruggleButton;
