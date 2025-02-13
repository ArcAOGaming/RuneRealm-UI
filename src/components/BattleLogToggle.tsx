import React from 'react';
import { BattleTurn } from '../utils/aoHelpers';

interface BattleLogToggleProps {
  turns: BattleTurn[];
  isOpen: boolean;
  onToggle: () => void;
  theme: any;
}

const BattleLogToggle: React.FC<BattleLogToggleProps> = ({ turns, isOpen, onToggle, theme }) => {
  return (
    <button
      onClick={onToggle}
      className={`fixed right-4 top-20 px-4 py-2 rounded-lg font-bold transition-all duration-300 
        ${theme.buttonBg} ${theme.buttonHover} ${theme.text} flex items-center gap-2 z-50`}
    >
      <span>Battle Log</span>
      <span className="text-sm">({turns.length} turns)</span>
    </button>
  );
};

export default BattleLogToggle;
