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
 * PlayerMoves Component
 * 
 * Renders a player's available moves in a grid layout.
 * Displays regular moves as buttons and shows a struggle button when all moves are exhausted.
 * Handles both challenger and accepter moves with the same interface.
 * 
 * Features:
 * - Grid layout for move buttons (2 columns)
 * - Individual move buttons with stats and usage counts
 * - Struggle button overlay when all moves have 0 uses
 * - Consistent styling and theming
 * 
 * @param playerName - Display name for the player (e.g., "Challenger's Moves")
 * @param moves - Object containing all available moves for this player
 * @param onAttack - Callback function when a move is selected
 * @param isDisabled - Whether moves should be disabled (during animations, etc.)
 * @param battleStatus - Current battle status
 * @param theme - Theme object for consistent styling
 * @param getMoveColor - Function to determine move button colors
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

  return (
    <div className={`p-4 rounded-lg ${theme.container} bg-opacity-20`}>
      {!hideTitle && <h4 className="text-md font-semibold mb-3">{playerName}</h4>}
      <div className="relative">
        {/* Regular moves grid */}
        <div className="grid grid-cols-2 gap-2 relative">
          {Object.entries(moves).map(([moveName, move]) => (
            <MoveButton
              key={moveName}
              moveName={moveName}
              move={move}
              onAttack={onAttack}
              isDisabled={isDisabled}
              battleStatus={battleStatus}
              getMoveColor={getMoveColor}
            />
          ))}

          {/* Struggle button - appears when all moves are exhausted */}
          {allMovesExhausted && (
            <StruggleButton
              onAttack={onAttack}
              isDisabled={isDisabled}
              battleStatus={battleStatus}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default PlayerMoves;
