import React from 'react';
import { BattleTurn } from '../utils/aoHelpers';
import Inventory from './Inventory';
import BattleLogContainer from './BattleLogContainer';

interface BattleOverlaysProps {
  turns: BattleTurn[];
  showBattleLog: boolean;
  onToggleBattleLog: () => void;
  theme: any;
  playerName: string;
  opponentName: string;
}

const BattleOverlays: React.FC<BattleOverlaysProps> = ({ 
  turns, 
  showBattleLog, 
  onToggleBattleLog, 
  theme,
  playerName,
  opponentName
}) => {
  return (
    <>
      {/* Inventory */}
      <div className="fixed right-4 top-32">
        <Inventory />
      </div>

      {/* Battle Log */}
      <BattleLogContainer
        turns={turns}
        isOpen={showBattleLog}
        onToggle={onToggleBattleLog}
        theme={theme}
        playerName={playerName}
        opponentName={opponentName}
      />
    </>
  );
};

export default BattleOverlays;
