import React from "react";
import PlayerMoves from "./PlayerMoves";
import { BattleTurn } from "../../utils/interefaces";
import EnhancedBattleLog from "./EnhancedBattleLog";

interface BattleInterfaceProps {
  challengerMoves: { [key: string]: any };
  accepterMoves: { [key: string]: any };
  onAttack: (moveName: string) => void;
  isDisabled: boolean;
  battleStatus: string;
  theme: any;
  getMoveColor: (moveName: string, move: any) => string;
  battleTurns: BattleTurn[];
  showBattleLog: boolean;
  onToggleBattleLog: () => void;
  challengerName: string;
  accepterName: string;
}

/**
 * BattleInterface Component
 * 
 * This component creates the bottom section of the battle page with a three-column layout:
 * - Left: Challenger's moves
 * - Center: Battle log (longer and more prominent)
 * - Right: Accepter's moves
 * 
 * This replaces the previous BattleMoves component to provide a more integrated
 * battle interface that includes the battle log prominently in the center.
 */
const BattleInterface: React.FC<BattleInterfaceProps> = ({
  challengerMoves,
  accepterMoves,
  onAttack,
  isDisabled,
  battleStatus,
  theme,
  getMoveColor,
  battleTurns,
  showBattleLog,
  onToggleBattleLog,
  challengerName,
  accepterName,
}) => {
  return (
    <div className="w-full flex flex-col justify-end">
      {/* Three-column layout: Challenger Moves | Battle Log | Accepter Moves */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 h-72">
        <h2 className="sr-only">Battle Interface</h2>
        
        {/* Left Column: Challenger Moves - Redesigned for condensed buttons */}
        <div className={`${theme.container} border ${theme.border} backdrop-blur-md rounded-lg px-3 py-2.5 h-72 overflow-hidden flex flex-col`}>
          <h3 className={`text-sm font-bold ${theme.text} mb-1 px-1`}>
            {challengerName}'s Moves
          </h3>
          <div className="flex-1 overflow-y-auto pr-0.5 pb-0.5">
            <PlayerMoves
              playerName={challengerName}
              moves={challengerMoves}
              onAttack={onAttack}
              isDisabled={isDisabled}
              battleStatus={battleStatus}
              theme={theme}
              getMoveColor={getMoveColor}
              hideTitle={true}
            />
          </div>
        </div>

        {/* Center Column: Enhanced Battle Log */}
        <div className={`${theme.container} border ${theme.border} backdrop-blur-md rounded-lg p-2 h-56 overflow-y-hidden`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={`text-base font-bold ${theme.text}`}>Battle Log</h3>
            <button
              onClick={onToggleBattleLog}
              className={`px-3 py-1 rounded text-sm font-medium transition-all duration-200 ${
                showBattleLog
                  ? `${theme.accent} text-white`
                  : `${theme.container} border ${theme.border} ${theme.text} hover:${theme.accent} hover:text-white`
              }`}
            >
              {showBattleLog ? "Hide" : "Show"}
            </button>
          </div>
          
          {showBattleLog ? (
            <div className="h-[calc(100%-36px)]">
              <EnhancedBattleLog 
                turns={battleTurns}
                challengerName={challengerName}
                accepterName={accepterName}
                theme={theme}
              />
            </div>
          ) : (
            <div className={`h-52 flex items-center justify-center ${theme.text} opacity-50`}>
              <p>Battle log is hidden. Click "Show" to view battle history.</p>
            </div>
          )}
        </div>

        {/* Right Column: Accepter Moves - Redesigned for condensed buttons */}
        <div className={`${theme.container} border ${theme.border} backdrop-blur-md rounded-lg px-3 py-2.5 h-72 overflow-hidden flex flex-col`}>
          <h3 className={`text-sm font-bold ${theme.text} mb-1 px-1`}>
            {accepterName}'s Moves
          </h3>
          <div className="flex-1 overflow-y-auto pr-0.5 pb-0.5">
            <PlayerMoves
              playerName={accepterName}
              moves={accepterMoves}
              onAttack={() => {}} // Accepter moves are display-only
              isDisabled={true}
              battleStatus={battleStatus}
              theme={theme}
              getMoveColor={getMoveColor}
              hideTitle={true}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BattleInterface;
