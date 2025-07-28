import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useBattle } from '../../contexts/BattleContext';

interface BattleStatusProps {
  theme: any;
  isReturningFromBattleDirect: boolean;
  onReturnFromBattleClick: () => void;
}

export const BattleStatus: React.FC<BattleStatusProps> = ({
  theme,
  isReturningFromBattleDirect,
  onReturnFromBattleClick
}) => {
  const { battleManagerInfo, activeBattle } = useBattle();
  const navigate = useNavigate();

  // Determine battle status
  const getBattleStatus = () => {
    if (activeBattle) {
      return 'In Battle';
    } else if (battleManagerInfo.battlesRemaining > 0) {
      return 'Ready to Battle';
    } else {
      // Check if this is a proper battle response with 0 battles (user still in battle mode)
      // vs no data found when querying (user not in battle mode)
      if (battleManagerInfo.wins > 0 || battleManagerInfo.losses > 0) {
        return 'Return from Battle';
      } else {
        return 'No Battles Remaining';
      }
    }
  };

  const battleStatus = getBattleStatus();

  return (
    <div className={`p-6 rounded-xl ${theme.container} bg-opacity-50 border ${theme.border}`}>
      <h2 className="text-2xl font-semibold mb-4 flex items-center">
        🛡️ Battle Status
      </h2>
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="font-semibold">Current Status:</span>
          <span className={`font-bold px-3 py-1 rounded-full text-sm ${
            activeBattle ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' : 
            battleManagerInfo.battlesRemaining > 0 ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 
            battleStatus === 'Return from Battle' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
            'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
          }`}>
            {battleStatus}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-semibold">Battles Remaining:</span>
          <span className="font-bold text-lg">{battleManagerInfo.battlesRemaining}</span>
        </div>
        
        {/* Not in battle mode - redirect to monster page */}
        {battleManagerInfo.battlesRemaining === 0 && !activeBattle && battleStatus === 'No Battles Remaining' && (
          <div className="space-y-3">
            <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-2 rounded">⚠️ You are not currently in battle mode.</p>
            <button
              onClick={() => navigate('/monsters')}
              className="w-full px-4 py-3 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
            >
              🐲 Go to Monster Page to Enter Battle
            </button>
          </div>
        )}
        
        {/* Ready to battle - show appropriate action */}
        {battleStatus === 'Ready to Battle' && (
          <div className="space-y-3">
            <p className="text-green-500 text-sm bg-green-50 dark:bg-green-900/20 p-2 rounded">✅ You are in battle mode with {battleManagerInfo.battlesRemaining} {battleManagerInfo.battlesRemaining === 1 ? 'battle' : 'battles'} remaining!</p>
            <button
              onClick={onReturnFromBattleClick}
              disabled={isReturningFromBattleDirect}
              className={`w-full px-4 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 ${isReturningFromBattleDirect ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isReturningFromBattleDirect ? '🔄 Ending Battle Session...' : '🏃‍♂️ End Battle Session Early'}
            </button>
          </div>
        )}
        
        {/* Battle session complete - return from battle */}
        {battleStatus === 'Return from Battle' && (
          <div className="space-y-3">
            <p className="text-blue-500 text-sm bg-blue-50 dark:bg-blue-900/20 p-2 rounded">🏁 Battle session complete! Return your monster to collect rewards.</p>
            <button
              onClick={onReturnFromBattleClick}
              disabled={isReturningFromBattleDirect}
              className={`w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 ${isReturningFromBattleDirect ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isReturningFromBattleDirect ? '🔄 Returning...' : '🏆 Return from Battle'}
            </button>
          </div>
        )}
        
        {/* In active battle - continue or end early */}
        {activeBattle && (
          <div className="space-y-3">
            <p className="text-orange-500 text-sm bg-orange-50 dark:bg-orange-900/20 p-2 rounded">⚔️ You are currently in an active battle!</p>
            <button
              onClick={() => navigate('/battle/active')}
              className="w-full px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
            >
              🎯 Continue Active Battle
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
