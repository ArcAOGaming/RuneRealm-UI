import React, { useEffect } from 'react';

interface BattleStatusProps {
  attackAnimation: {
    attacker: 'player' | 'opponent';
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

const BattleStatus: React.FC<BattleStatusProps> = ({
  attackAnimation,
  shieldRestoring,
  showEndOfRound,
  onAttackComplete,
  onShieldComplete,
  onRoundComplete,
  playerMonsterName,
  opponentMonsterName,
}): JSX.Element | null => {
  useEffect(() => {
    if (attackAnimation) {
      const timer = setTimeout(onAttackComplete, 2000);
      return () => clearTimeout(timer);
    }
  }, [attackAnimation, onAttackComplete]);

  useEffect(() => {
    if (shieldRestoring) {
      const timer = setTimeout(onShieldComplete, 2000);
      return () => clearTimeout(timer);
    }
  }, [shieldRestoring, onShieldComplete]);

  useEffect(() => {
    if (showEndOfRound) {
      const timer = setTimeout(onRoundComplete, 3000);
      return () => clearTimeout(timer);
    }
  }, [showEndOfRound, onRoundComplete]);

  if (!attackAnimation && !shieldRestoring && !showEndOfRound) {
    return null;
  }

  return (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-40 pointer-events-none w-3/5">
      <div className="bg-black bg-opacity-75 rounded-lg px-4 py-2 text-center">
        {attackAnimation && (
          <div className={`text-2xl font-bold ${attackAnimation.attacker === 'player' ? 'text-blue-500' : 'text-red-500'} transform scale-100 animate-[pulse_2s_ease-in-out_infinite] text-center`}>
            {attackAnimation.attacker === 'player' ? playerMonsterName : opponentMonsterName} using {attackAnimation.moveName}...
          </div>
        )}
        {shieldRestoring && (
          <div className="text-2xl font-bold text-blue-500 transform scale-100 animate-[pulse_2s_ease-in-out_infinite] text-center">
            Shields Restoring...
          </div>
        )}
        {showEndOfRound && (
          <div className="text-2xl font-bold text-yellow-500 transform scale-100 animate-[pulse_2s_ease-in-out_infinite] text-center">
            End of Round
          </div>
        )}
      </div>
    </div>
  );
};

export default BattleStatus;
