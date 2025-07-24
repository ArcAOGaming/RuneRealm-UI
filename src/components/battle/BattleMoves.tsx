import React from "react";
import PlayerMoves from "./PlayerMoves";

interface BattleMovesProps {
  challengerMoves: { [key: string]: any };
  accepterMoves: { [key: string]: any };
  onAttack: (moveName: string) => void;
  isDisabled: boolean;
  battleStatus: string;
  theme: any;
  getMoveColor: (moveName: string, move: any) => string;
}

/**
 * BattleMoves Component
 * 
 * Container component that renders both challenger and accepter moves side by side.
 * Uses a responsive grid layout that stacks on mobile and displays in columns on larger screens.
 * 
 * This component serves as the main interface for players to select their battle moves.
 * It delegates the rendering of individual player moves to the PlayerMoves component.
 * 
 * @param challengerMoves - Object containing challenger's available moves
 * @param accepterMoves - Object containing accepter's available moves
 * @param onAttack - Callback function when any move is selected
 * @param isDisabled - Whether moves should be disabled during animations/updates
 * @param battleStatus - Current battle status (active/ended)
 * @param theme - Theme object for consistent styling
 * @param getMoveColor - Function to determine move button colors based on type
 */
const BattleMoves: React.FC<BattleMovesProps> = ({
  challengerMoves,
  accepterMoves,
  onAttack,
  isDisabled,
  battleStatus,
  theme,
  getMoveColor,
}) => {
  return (
    <div className="mt-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pb-4">
        {/* Challenger's moves */}
        <PlayerMoves
          playerName="Challenger's Moves"
          moves={challengerMoves}
          onAttack={onAttack}
          isDisabled={isDisabled}
          battleStatus={battleStatus}
          theme={theme}
          getMoveColor={getMoveColor}
        />

        {/* Accepter's moves */}
        <PlayerMoves
          playerName="Accepter's Moves"
          moves={accepterMoves}
          onAttack={onAttack}
          isDisabled={isDisabled}
          battleStatus={battleStatus}
          theme={theme}
          getMoveColor={getMoveColor}
        />
      </div>
    </div>
  );
};

export default BattleMoves;
