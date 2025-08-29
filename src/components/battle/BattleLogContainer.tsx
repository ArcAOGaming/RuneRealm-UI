import React from 'react';
import { BattleTurn } from '../../utils/interefaces';
import BattleLog from './BattleLog';
import BattleLogToggle from './BattleLogToggle';

interface BattleLogContainerProps {
  turns: BattleTurn[];
  isOpen: boolean;
  onToggle: () => void;
  theme: any;
  playerName: string;
  opponentName: string;
}

const BattleLogContainer: React.FC<BattleLogContainerProps> = ({ 
  turns, 
  isOpen, 
  onToggle, 
  theme,
  playerName,
  opponentName 
}) => {
  return (
    <>
      {/* Battle Log Toggle */}
      <BattleLogToggle
        turns={turns}
        isOpen={isOpen}
        onToggle={onToggle}
        theme={theme}
      />

      {/* Battle Log */}
      <BattleLog
        turns={turns}
        isOpen={isOpen}
        onClose={onToggle}
        playerName={playerName}
        opponentName={opponentName}
      />
    </>
  );
};

export default BattleLogContainer;
