import React from "react";
import MoveButton from "./MoveButton";
import StruggleButton from "./StruggleButton";

interface PlayerMovesProps {
  playerName: string;
  moves: { [key: string]: any };
  onAttack: (moveName: string) => void;
  isDisabled: boolean;
  battleStatus: string;
  theme: any;
  getMoveColor: (moveName: string, move: any) => string;
  hideTitle?: boolean;
}

/**
 * PlayerMoves Component (Redesigned)
 * 
 * Renders a player's available moves in a compact grid layout.
 * Optimized for the redesigned MoveButton component with condensed layout.
 * Displays all moves in a dense grid and shows struggle button when all moves are exhausted.
 * 
 * Features:
 * - Compact grid layout (2 columns by default, adaptable)
 * - Minimal padding and spacing for dense presentation
 * - Works with redesigned MoveButton component
 * - Struggle button overlay when all moves are exhausted
 * - Optional title display
 * 
 * @param playerName - Display name for the player (e.g., "Challenger's Moves")
 * @param moves - Object containing all available moves for this player
 * @param onAttack - Callback function when a move is selected
 * @param isDisabled - Whether moves should be disabled (during animations, etc.)
 * @param battleStatus - Current battle status
 * @param theme - Theme object for consistent styling
 * @param getMoveColor - Function to determine move button colors
 * @param hideTitle - Whether to hide the player name title (default: false)
 */
const PlayerMoves: React.FC<PlayerMovesProps> = ({
  playerName,
  moves,
  onAttack,
  isDisabled,
  battleStatus,
  theme,
  getMoveColor,
  hideTitle = false,
}) => {
  // Check if all moves are exhausted to show struggle button
  const allMovesExhausted = Object.values(moves).every((move: any) => move.count === 0);
  
  // Calculate number of moves to determine grid layout
  const moveCount = Object.keys(moves).length;
  
  // Determine grid columns based on move count
  // Note: Using fixed classes for columns since Tailwind doesn't support dynamic class names

  return (
    <div className={`px-2 py-2 rounded ${theme.container} bg-opacity-20 h-full flex flex-col`}>
      {/* Title bar - conditionally rendered and more compact */}
      {!hideTitle && (
        <h4 className="text-sm font-semibold mb-2 px-1">{playerName}</h4>
      )}
      
      <div className="flex-1 overflow-y-auto">
        {/* Compact moves grid with appropriate spacing for larger buttons */}
        <div className={`grid ${moveCount > 4 ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
          {Object.entries(moves).map(([moveName, move]) => (
            <div key={moveName} className="mb-2">
              <MoveButton
                moveName={moveName}
                move={move}
                onAttack={onAttack}
                isDisabled={isDisabled}
                battleStatus={battleStatus}
                getMoveColor={getMoveColor}
              />
            </div>
          ))}

          {/* Struggle button - appears when all moves are exhausted */}
          {allMovesExhausted && (
            <div className="col-span-full mt-0.5">
              <StruggleButton
                onAttack={onAttack}
                isDisabled={isDisabled}
                battleStatus={battleStatus}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlayerMoves;
