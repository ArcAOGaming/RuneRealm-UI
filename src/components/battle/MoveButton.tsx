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
 * MoveButton Component
 * 
 * Renders an individual move button with:
 * - Move name and usage count
 * - Color coding based on move type
 * - Move stats display (damage, attack, defense, speed, health)
 * - Disabled state when move count is 0 or battle is ended
 * - Hover effects and animations
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

  return (
    <button
      onClick={() => onAttack(moveName)}
      disabled={isButtonDisabled}
      className={`w-full p-2 rounded-lg font-medium text-left transition-all duration-300 min-h-[80px]
        ${getMoveColor(moveName, move)} hover:brightness-110
        ${isButtonDisabled ? "opacity-50 cursor-not-allowed" : ""}
        text-white relative overflow-hidden group flex flex-col justify-between`}
    >
      {/* Move name and count header */}
      <div className="flex justify-between items-center relative">
        <span className="capitalize">{moveName}</span>
        <span className="text-sm opacity-75">{move.count}</span>
      </div>

      {/* Disabled overlay when move count is 0 */}
      {move.count === 0 && (
        <div className="absolute inset-0 bg-black/50 pointer-events-none">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full h-0.5 bg-red-500 transform rotate-12"></div>
          </div>
        </div>
      )}

      {/* Move stats grid */}
      <div className="text-sm mt-1">
        <div className="grid grid-cols-3 grid-rows-2 gap-1 max-w-[200px] min-h-[32px]">
          {move.damage !== 0 && (
            <span>
              ⚔️ {move.damage > 0 ? "+" : ""}{move.damage}
            </span>
          )}
          {move.attack !== 0 && (
            <span>
              💪 {move.attack > 0 ? "+" : ""}{move.attack}
            </span>
          )}
          {move.defense !== 0 && (
            <span>
              🛡️ {move.defense > 0 ? "+" : ""}{move.defense}
            </span>
          )}
          {move.speed !== 0 && (
            <span>
              ⚡ {move.speed > 0 ? "+" : ""}{move.speed}
            </span>
          )}
          {move.health !== 0 && (
            <span>
              ❤️ {move.health > 0 ? "+" : ""}{move.health}
            </span>
          )}
          {/* Fill remaining grid spaces to maintain layout */}
          {[
            ...Array(
              6 -
                [
                  move.damage,
                  move.attack,
                  move.defense,
                  move.speed,
                  move.health,
                ].filter((v) => v !== 0).length
            ),
          ].map((_, i) => (
            <span key={i} className="invisible">
              placeholder
            </span>
          ))}
        </div>
      </div>

      {/* Hover effect overlay */}
      <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity duration-300"></div>
    </button>
  );
};

export default MoveButton;
