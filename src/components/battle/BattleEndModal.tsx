import React from 'react';
import { useBattle } from '../../contexts/BattleContext';

interface BattleEndModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isForfeiting: boolean; // true for early end, false for clean end
  isReturningFromBattleDirect: boolean;
  theme: any;
}

export const BattleEndModal: React.FC<BattleEndModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isForfeiting,
  isReturningFromBattleDirect,
  theme
}) => {
  const { battleManagerInfo } = useBattle();

  if (!isOpen) return null;

  // Get congratulatory message based on win rate
  const getCongratulatoryMessage = () => {
    const totalBattles = battleManagerInfo.wins + battleManagerInfo.losses;
    if (totalBattles === 0) return "Thanks for participating!";
    
    const winRate = (battleManagerInfo.wins / totalBattles) * 100;
    
    if (winRate > 50) {
      return "🎉 Congratulations! Excellent performance!";
    } else if (winRate === 50) {
      return "👍 Fair try! You're getting the hang of it!";
    } else {
      return "💪 Better luck next time! Keep practicing!";
    }
  };

  const title = isForfeiting ? "Forfeit Remaining Battles?" : "Battle Session Complete! 🏁";
  
  const message = isForfeiting ? (
    <div>
      <p>You still have <span className="font-bold text-orange-500">{battleManagerInfo.battlesRemaining} {battleManagerInfo.battlesRemaining === 1 ? 'battle' : 'battles'}</span> remaining in your current session.</p>
      <p className="mt-2">If you return your monster from battle now, you will forfeit these remaining battles.</p>
      <p className="mt-2">Are you sure you want to continue?</p>
      
      {/* Battle Stats for Forfeit */}
      <div className="mt-6">
        <h4 className="text-lg font-bold mb-4 text-center">Current Session Stats</h4>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className={`p-4 rounded-lg ${theme.container} bg-opacity-40 border ${theme.border}`}>
            <div className="text-2xl mb-1">🏆</div>
            <p className="text-sm font-medium">Wins</p>
            <p className="text-xl font-bold text-green-500">{battleManagerInfo.wins}</p>
          </div>
          <div className={`p-4 rounded-lg ${theme.container} bg-opacity-40 border ${theme.border}`}>
            <div className="text-2xl mb-1">💀</div>
            <p className="text-sm font-medium">Losses</p>
            <p className="text-xl font-bold text-red-500">{battleManagerInfo.losses}</p>
          </div>
          <div className={`p-4 rounded-lg ${theme.container} bg-opacity-40 border ${theme.border}`}>
            <div className="text-2xl mb-1">📈</div>
            <p className="text-sm font-medium">Win Rate</p>
            <p className="text-xl font-bold">
              {battleManagerInfo.wins + battleManagerInfo.losses > 0
                ? (
                    <span className={`${
                      Math.round((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100) >= 70 ? 'text-green-500' :
                      Math.round((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100) >= 50 ? 'text-yellow-500' :
                      'text-red-500'
                    }`}>
                      {Math.round((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100)}%
                    </span>
                  )
                : <span className="text-gray-500">N/A</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  ) : (
    <div className="text-center">
      <div className="mb-6">
        <h4 className="text-lg font-bold mb-4">{getCongratulatoryMessage()}</h4>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className={`p-4 rounded-lg ${theme.container} bg-opacity-40 border ${theme.border}`}>
            <div className="text-2xl mb-1">🏆</div>
            <p className="text-sm font-medium">Wins</p>
            <p className="text-xl font-bold text-green-500">{battleManagerInfo.wins}</p>
          </div>
          <div className={`p-4 rounded-lg ${theme.container} bg-opacity-40 border ${theme.border}`}>
            <div className="text-2xl mb-1">💀</div>
            <p className="text-sm font-medium">Losses</p>
            <p className="text-xl font-bold text-red-500">{battleManagerInfo.losses}</p>
          </div>
          <div className={`p-4 rounded-lg ${theme.container} bg-opacity-40 border ${theme.border}`}>
            <div className="text-2xl mb-1">📈</div>
            <p className="text-sm font-medium">Win Rate</p>
            <p className="text-xl font-bold">
              {battleManagerInfo.wins + battleManagerInfo.losses > 0
                ? (
                    <span className={`${
                      Math.round((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100) >= 70 ? 'text-green-500' :
                      Math.round((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100) >= 50 ? 'text-yellow-500' :
                      'text-red-500'
                    }`}>
                      {Math.round((battleManagerInfo.wins / (battleManagerInfo.wins + battleManagerInfo.losses)) * 100)}%
                    </span>
                  )
                : <span className="text-gray-500">N/A</span>}
            </p>
          </div>
        </div>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        Your monster will now return from battle and you can start a new battle session anytime.
      </p>
    </div>
  );

  const confirmText = isForfeiting 
    ? "Yes, Return Monster" 
    : (isReturningFromBattleDirect ? '🔄 Returning...' : '🏆 Confirm Return');
  
  const cancelText = isForfeiting ? "Cancel" : "Stay in Battle";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className={`${theme.container} border-2 ${theme.border} rounded-xl shadow-2xl p-8 w-full max-w-lg relative z-10 transform transition-all duration-300 scale-100 animate-in fade-in zoom-in`} style={{
        backdropFilter: 'blur(20px)',
        backgroundColor: theme.container.includes('bg-white') ? 'rgba(255, 255, 255, 0.95)' : 'rgba(31, 41, 55, 0.95)'
      }}>
        <h3 className="text-2xl font-bold mb-6 text-center">{title}</h3>
        <div className="mb-8 text-center">{message}</div>
        <div className="flex gap-4 justify-center">
          <button
            onClick={onClose}
            className={`px-6 py-3 rounded-xl border-2 ${theme.border} hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300 font-semibold min-w-[120px]`}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-xl transition-all duration-300 font-semibold min-w-[120px] shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
