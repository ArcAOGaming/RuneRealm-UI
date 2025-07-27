import React, { useRef, useEffect } from 'react';
import { BattleTurn } from '../../utils/interefaces';

interface EnhancedBattleLogProps {
  turns: BattleTurn[];
  challengerName: string;
  accepterName: string;
  theme: any;
}

/**
 * EnhancedBattleLog Component
 * 
 * Displays battle turns grouped by round with overlapping messages for better storytelling.
 * Each round shows both challenger and accepter actions side-by-side with visual distinction.
 * 
 * Features:
 * - Groups turns into rounds (pairs of challenger/accepter actions)
 * - Side-specific styling and positioning
 * - Condensed view with overlapping messages
 * - Auto-scrolls to latest turn
 */
const EnhancedBattleLog: React.FC<EnhancedBattleLogProps> = ({
  turns,
  challengerName,
  accepterName,
  theme
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Group turns into rounds (pairs of turns)
  const rounds = [];
  for (let i = 0; i < turns.length; i += 2) {
    const round = {
      number: Math.floor(i / 2) + 1,
      challengerTurn: turns[i]?.attacker === 'challenger' ? turns[i] : turns[i + 1],
      accepterTurn: turns[i]?.attacker === 'accepter' ? turns[i] : turns[i + 1]
    };
    rounds.push(round);
  }

  // Auto-scroll to bottom when turns update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  // Helper to render move effect icons with values
  const renderMoveEffects = (turn: BattleTurn) => {
    if (!turn) return null;
    
    return (
      <div className="flex flex-wrap gap-x-2 gap-y-1 justify-start w-full">
        {/* Damage effects */}
        {(turn.healthDamage > 0 || turn.shieldDamage > 0) && (
          <div className="inline-flex items-center gap-0.5 text-[10px]">
            <span className="text-xs">💥</span>
            <div className="inline-flex items-center">
              <span>{turn.healthDamage + turn.shieldDamage}</span>
              {turn.superEffective && <span className="text-yellow-300">⭐</span>}
              {turn.notEffective && <span className="text-gray-400">💫</span>}
            </div>
          </div>
        )}
        
        {/* Health damage */}
        {turn.healthDamage > 0 && (
          <div className="inline-flex items-center gap-0.5 text-[10px]">
            <span className="text-xs">❤️</span>
            <span className="text-red-400">-{turn.healthDamage}</span>
          </div>
        )}
        
        {/* Shield damage */}
        {turn.shieldDamage > 0 && (
          <div className="inline-flex items-center gap-0.5 text-[10px]">
            <span className="text-xs">🛡️</span>
            <span className="text-blue-400">-{turn.shieldDamage}</span>
          </div>
        )}
        
        {/* Missed attack */}
        {turn.missed && (
          <div className="inline-flex items-center gap-0.5 text-[10px]">
            <span className="text-xs">❌</span>
            <span>Miss</span>
          </div>
        )}
        
        {/* Stat changes - rendered inline */}
        {turn.statsChanged && Object.values(turn.statsChanged).some(val => val !== 0) && (
          <>
            {turn.statsChanged.attack !== 0 && (
              <div className="inline-flex items-center gap-0.5 text-[10px]">
                <span className="text-xs">💪</span>
                <span className={turn.statsChanged.attack > 0 ? "text-green-400" : "text-red-400"}>
                  {turn.statsChanged.attack > 0 ? '+' : ''}{turn.statsChanged.attack}
                </span>
              </div>
            )}
            
            {turn.statsChanged.speed !== 0 && (
              <div className="inline-flex items-center gap-0.5 text-[10px]">
                <span className="text-xs">⚡</span>
                <span className={turn.statsChanged.speed > 0 ? "text-green-400" : "text-red-400"}>
                  {turn.statsChanged.speed > 0 ? '+' : ''}{turn.statsChanged.speed}
                </span>
              </div>
            )}
            
            {turn.statsChanged.defense !== 0 && (
              <div className="inline-flex items-center gap-0.5 text-[10px]">
                <span className="text-xs">🛡️</span>
                <span className={turn.statsChanged.defense > 0 ? "text-green-400" : "text-red-400"}>
                  {turn.statsChanged.defense > 0 ? '+' : ''}{turn.statsChanged.defense}
                </span>
              </div>
            )}
            
            {turn.statsChanged.health !== 0 && (
              <div className="inline-flex items-center gap-0.5 text-[10px]">
                <span className="text-xs">❤️</span>
                <span className={turn.statsChanged.health > 0 ? "text-green-400" : "text-red-400"}>
                  {turn.statsChanged.health > 0 ? '+' : ''}{turn.statsChanged.health}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // Render a move message
  const renderMoveMessage = (turn: BattleTurn, isChallenger: boolean) => {
    if (!turn) return null;
    
    const moveColorClass = isChallenger 
      ? 'border-blue-500/30 bg-blue-500/10' 
      : 'border-red-500/30 bg-red-500/10';
    
    const playerName = isChallenger ? challengerName : accepterName;
    const textColorClass = isChallenger ? 'text-blue-400' : 'text-red-400';
    const alignClass = isChallenger ? 'items-start text-left' : 'items-end text-right';
    
    return (
      <div className={`px-2 py-1.5 rounded-lg border ${moveColorClass} w-full backdrop-blur-sm shadow-sm flex flex-col ${alignClass}`}>
        <div className="flex items-center justify-between w-full mb-1">
          <span className={`font-bold text-xs ${textColorClass} ${isChallenger ? '' : 'order-2'}`}>
            {playerName}
          </span>
          <span className={`text-[10px] ${theme.textSecondary} ${isChallenger ? 'order-2' : ''}`}>
            {turn.moveName}
          </span>
        </div>
        
        {renderMoveEffects(turn)}
      </div>
    );
  };

  if (turns.length === 0) {
    return (
      <div className={`h-full flex items-center justify-center ${theme.textSecondary}`}>
        <p className="text-sm">Battle has not started yet.<br/>Make your first move!</p>
      </div>
    );
  }

  return (
    <div 
      ref={scrollRef}
      className="h-full overflow-y-auto pr-1 space-y-6 pb-1"
    >
      {rounds.map((round) => {
        // Determine which player moved first in this round
        const challengerFirst = round.challengerTurn && (!round.accepterTurn || 
          (round.challengerTurn && round.accepterTurn && 
            rounds.indexOf(round) * 2 === turns.indexOf(round.challengerTurn)));
            
        return (
          <div key={`round-${round.number}`} className="relative mb-3 pb-1 border-b border-gray-700/30 last:border-b-0">
            {/* Combined round header and separator */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-center z-10">
              <span className={`px-2 text-xs font-medium ${theme.textSecondary} bg-gray-800`}>
                Round {round.number}
              </span>
            </div>
            
            {/* Round content with side-by-side messages */}
            <div className="flex w-full pt-3">
              {/* Challenger's move (left side) */}
              <div className={`w-1/2 pr-1 ${challengerFirst ? '' : 'pt-4'}`}>
                {round.challengerTurn ? (
                  renderMoveMessage(round.challengerTurn, true)
                ) : (
                  <div className="h-4"></div>
                )}
              </div>
              
              {/* Accepter's move (right side) */}
              <div className={`w-1/2 pl-1 ${!challengerFirst ? '' : 'pt-4'}`}>
                {round.accepterTurn ? (
                  renderMoveMessage(round.accepterTurn, false)
                ) : (
                  <div className="h-4"></div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      
      {/* Extra space at bottom for better scrolling */}
      
      {/* Extra space at bottom for better scrolling */}
      <div className="h-4"></div>
    </div>
  );
};

export default EnhancedBattleLog;
