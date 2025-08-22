import React, { useEffect } from 'react';

interface BattleStatusProps {
  attackAnimation: {
    attacker: 'challenger' | 'accepter';
    moveName: string;
  } | null;
  shieldRestoring: boolean;
  showEndOfRound: boolean;
  onAttackComplete: () => void;
  onShieldComplete: () => void;
  onRoundComplete: () => void;
  playerMonsterName: string;
  opponentMonsterName: string;
}

export const BattleStatus: React.FC<BattleStatusProps> = ({
  attackAnimation,
  shieldRestoring,
  showEndOfRound,
  onAttackComplete,
  onShieldComplete,
  onRoundComplete,
  playerMonsterName,
  opponentMonsterName
}) => {
  // Handle attack animation completion
  useEffect(() => {
    if (attackAnimation) {
      const timer = setTimeout(() => {
        onAttackComplete();
      }, 2000); // 2 second attack animation
      return () => clearTimeout(timer);
    }
  }, [attackAnimation, onAttackComplete]);

  // Handle shield restoration completion
  useEffect(() => {
    if (shieldRestoring) {
      const timer = setTimeout(() => {
        onShieldComplete();
      }, 1500); // 1.5 second shield restoration
      return () => clearTimeout(timer);
    }
  }, [shieldRestoring, onShieldComplete]);

  // Handle end of round completion
  useEffect(() => {
    if (showEndOfRound) {
      const timer = setTimeout(() => {
        onRoundComplete();
      }, 3000); // 3 second end of round display
      return () => clearTimeout(timer);
    }
  }, [showEndOfRound, onRoundComplete]);

  if (!attackAnimation && !shieldRestoring && !showEndOfRound) {
    return null;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-white rounded-lg p-6 text-center shadow-lg">
        {attackAnimation && (
          <div className="text-2xl font-bold text-red-600">
            {attackAnimation.attacker === 'challenger' ? playerMonsterName : opponentMonsterName} uses {attackAnimation.moveName}!
          </div>
        )}
        
        {shieldRestoring && (
          <div className="text-2xl font-bold text-blue-600">
            🛡️ Shield Restoring...
          </div>
        )}
        
        {showEndOfRound && (
          <div className="text-2xl font-bold text-purple-600">
            🏁 Round Complete!
          </div>
        )}
      </div>
    </div>
  );
};
