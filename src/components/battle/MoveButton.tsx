import React from "react";

interface MoveButtonProps {
  moveName: string;
  move: any;
  onAttack: (moveName: string) => void;
  isDisabled: boolean;
  battleStatus: string;
  getMoveColor: (moveName: string, move: any) => string;
}

/**
 * MoveButton Component (Redesigned)
 * 
 * Renders an individual move button with:
 * - Three-part layout: Name (top-left), Turns left (top-right), Stats (bottom)
 * - All stats shown with proper styling: greyed when 0, red tint for negative, green for positive
 * - Condensed rectangular design with minimal padding
 * - Color coding based on move type
 * - Disabled state when move count is 0 or battle is ended
 * 
 * @param moveName - Name of the move
 * @param move - Move object containing stats and count
 * @param onAttack - Callback function when move is selected
 * @param isDisabled - Whether the button should be disabled
 * @param battleStatus - Current battle status
 * @param getMoveColor - Function to determine move color based on type
 */
const MoveButton: React.FC<MoveButtonProps> = ({
  moveName,
  move,
  onAttack,
  isDisabled,
  battleStatus,
  getMoveColor,
}) => {
  const isButtonDisabled = isDisabled || battleStatus === "ended" || move.count === 0;
  
  // Ensure all stats exist with default value of 0
  const stats = {
    damage: move.damage || 0,
    attack: move.attack || 0,
    defense: move.defense || 0,
    speed: move.speed || 0,
    health: move.health || 0
  };
  
  // Helper function to get stat styling
  const getStatStyle = (value: number) => {
    if (value === 0) return "opacity-50"; // Grey out
    if (value < 0) return "text-red-200"; // Slight red tint
    return "text-green-200"; // Slight green tint
  };

  return (
    <button
      onClick={() => onAttack(moveName)}
      disabled={isButtonDisabled}
      className={`w-full px-3 py-2 rounded text-sm font-medium text-left transition-all duration-200 h-auto 
        ${getMoveColor(moveName, move)} hover:brightness-110
        ${isButtonDisabled ? "opacity-50 cursor-not-allowed" : ""}
        text-white relative overflow-hidden group flex flex-col`}
    >
      {/* Header: Name and Turn Count */}
      <div className="flex justify-between items-center w-full mb-2">
        <span className="capitalize font-bold truncate mr-2 text-lg">{moveName}</span>
        <span className="text-base bg-black/40 px-2.5 py-0.5 rounded-full font-medium min-w-[2rem] text-center">{move.count}</span>
      </div>

      {/* Stats Section - Segmented with clear divisions */}
      <div className="grid grid-cols-5 gap-1 bg-black/10 p-1 rounded-sm">
        <div className={`flex items-center justify-center ${getStatStyle(stats.damage)} py-0.5 px-1 rounded bg-black/20`}>
          <span className="text-lg mr-0.5">⚔️</span>
          <span className="font-bold text-base">{stats.damage > 0 ? "+" : ""}{stats.damage}</span>
        </div>
        
        <div className={`flex items-center justify-center ${getStatStyle(stats.attack)} py-0.5 px-1 rounded bg-black/20`}>
          <span className="text-lg mr-0.5">💪</span>
          <span className="font-bold text-base">{stats.attack > 0 ? "+" : ""}{stats.attack}</span>
        </div>
        
        <div className={`flex items-center justify-center ${getStatStyle(stats.defense)} py-0.5 px-1 rounded bg-black/20`}>
          <span className="text-lg mr-0.5">🛡️</span>
          <span className="font-bold text-base">{stats.defense > 0 ? "+" : ""}{stats.defense}</span>
        </div>
        
        <div className={`flex items-center justify-center ${getStatStyle(stats.speed)} py-0.5 px-1 rounded bg-black/20`}>
          <span className="text-lg mr-0.5">⚡</span>
          <span className="font-bold text-base">{stats.speed > 0 ? "+" : ""}{stats.speed}</span>
        </div>
        
        <div className={`flex items-center justify-center ${getStatStyle(stats.health)} py-0.5 px-1 rounded bg-black/20`}>
          <span className="text-lg mr-0.5">❤️</span>
          <span className="font-bold text-base">{stats.health > 0 ? "+" : ""}{stats.health}</span>
        </div>
      </div>

      {/* Disabled overlay when move count is 0 */}
      {move.count === 0 && (
        <div className="absolute inset-0 bg-black/50 pointer-events-none">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full h-0.5 bg-red-500 transform rotate-12"></div>
          </div>
        </div>
      )}
    </button>
  );
};

export default MoveButton;
