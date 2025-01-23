import React, { useState } from 'react';
import { currentTheme } from '../constants/theme';

interface StatAllocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (stats: { attack: number; defense: number; speed: number; health: number }) => void;
  darkMode: boolean;
}

const StatAllocationModal: React.FC<StatAllocationModalProps> = ({ isOpen, onClose, onConfirm, darkMode }) => {
  const [stats, setStats] = useState({
    attack: 0,
    defense: 0,
    speed: 0,
    health: 0
  });

  const [remainingPoints, setRemainingPoints] = useState(10);
  const theme = currentTheme(darkMode);

  const handleStatChange = (stat: keyof typeof stats, value: number) => {
    // Calculate how many points this change would use
    const pointDiff = value - stats[stat];
    
    // Check if we have enough remaining points and not exceeding max per stat
    if (remainingPoints - pointDiff >= 0 && value <= 5 && value >= 0) {
      setStats(prev => ({
        ...prev,
        [stat]: value
      }));
      setRemainingPoints(prev => prev - pointDiff);
    }
  };

  const handleConfirm = () => {
    onConfirm(stats);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={`${theme.bg} ${theme.border} border rounded-xl p-6 max-w-md w-full shadow-lg`}>
        <h2 className={`text-2xl font-bold mb-4 ${theme.text}`}>Level Up!</h2>
        <p className={`mb-4 ${theme.text}`}>
          Distribute your stat points ({remainingPoints} remaining)
        </p>

        <div className="space-y-4">
          {Object.entries(stats).map(([stat, value]) => (
            <div key={stat} className="flex items-center justify-between">
              <span className={`${theme.text} capitalize`}>{stat}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleStatChange(stat as keyof typeof stats, value - 1)}
                  className={`${theme.buttonBg} ${theme.buttonHover} w-8 h-8 rounded-full`}
                  disabled={value <= 0}
                >
                  -
                </button>
                <span className={`${theme.text} w-8 text-center`}>{value}</span>
                <button
                  onClick={() => handleStatChange(stat as keyof typeof stats, value + 1)}
                  className={`${theme.buttonBg} ${theme.buttonHover} w-8 h-8 rounded-full`}
                  disabled={value >= 5 || remainingPoints === 0}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-4 mt-6">
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-lg ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={remainingPoints > 0}
            className={`px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white ${remainingPoints > 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatAllocationModal;
