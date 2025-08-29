import React from 'react';
import { ActiveBattle as NewActiveBattle, BattleTurn } from '../../utils/interefaces';

interface BattleLogToggleProps {
  turns: BattleTurn[];
  isOpen: boolean;
  onToggle: () => void;
  theme: any;
}

const BattleLogToggle: React.FC<BattleLogToggleProps> = ({ turns, isOpen, onToggle, theme }) => {
  if (isOpen) return null;
  
  return (
    <div style={{ top: '25vh' }} className="fixed left-4 z-50">
      <button
        onClick={onToggle}
        className={`px-4 py-2 rounded-lg font-bold transition-all duration-300 
          ${theme.buttonBg} ${theme.buttonHover} ${theme.text} flex items-center gap-2`}
      >
        <span>Battle Log</span>
        <span className="text-sm">({turns.length} turns)</span>
      </button>
    </div>
  );
};

export default BattleLogToggle;
