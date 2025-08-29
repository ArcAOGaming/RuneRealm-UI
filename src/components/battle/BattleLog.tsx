import React from 'react';
import { BattleTurn } from '../../utils/interefaces';

interface BattleLogProps {
  turns: BattleTurn[];
  isOpen: boolean;
  onClose: () => void;
  playerName: string;
  opponentName: string;
}


const BattleLog: React.FC<BattleLogProps> = ({ turns, isOpen, onClose, playerName, opponentName }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed left-4 w-[400px] rounded-xl bg-gray-800 border border-gray-700 backdrop-blur-md shadow-lg z-50" style={{ top: '25vh' }}>
      <div className="flex justify-between items-center p-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Battle Log</h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      <div className="overflow-y-auto p-3" style={{ maxHeight: '400px' }}>
        <div className="flex flex-col space-y-4 w-full">
          {turns.map((turn, index) => (
            <div
              key={index}
              className={`flex ${turn.attacker === 'challenger' ? 'justify-end' : 'justify-start'} w-full`}
            >
              <div
                className={`max-w-[80%] p-4 rounded-lg ${
                  turn.attacker === 'challenger'
                    ? 'bg-blue-500/90 ml-auto rounded-br-none'
                    : 'bg-red-500/90 mr-auto rounded-bl-none'
                } text-white backdrop-blur-sm shadow-md`}
              >
                <div className="font-medium mb-2 text-lg">
                  {turn.attacker === 'challenger' ? `🦸‍♂️ ${playerName}` : `👾 ${opponentName}`} used {turn.move}
                </div>
                <div className="space-y-2 text-md">
                  {(turn.healthDamage > 0 || turn.shieldDamage > 0) && (
                    <div className="flex items-center gap-2">
                      <span className="text-xl">💥</span>
                      <span>
                        {turn.healthDamage + turn.shieldDamage} total damage
                        {turn.superEffective && <span className="ml-1 text-yellow-300">⭐ Super Effective!</span>}
                        {turn.notEffective && <span className="ml-1 text-gray-300">💫 Not Very Effective...</span>}
                      </span>
                    </div>
                  )}
                  {turn.healthDamage > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xl">⚔️</span>
                      <span>{turn.healthDamage} damage dealt</span>
                    </div>
                  )}
                  {turn.shieldDamage > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🛡️</span>
                      <span>{turn.shieldDamage} shield damage</span>
                    </div>
                  )}
                  {turn.missed && (
                    <div className="flex items-center gap-2">
                      <span className="text-xl">❌</span>
                      <span>Attack missed!</span>
                    </div>
                  )}
                  {turn.statsChanged && (
                    <div className="space-y-2">
                      {turn.statsChanged.attack && (
                        <div className="flex items-center gap-2">
                          <span className="text-xl">💪</span>
                          <span>{turn.statsChanged.attack > 0 ? '+' : ''}{turn.statsChanged.attack} attack</span>
                        </div>
                      )}
                      {turn.statsChanged.speed && (
                        <div className="flex items-center gap-2">
                          <span className="text-xl">⚡</span>
                          <span>{turn.statsChanged.speed > 0 ? '+' : ''}{turn.statsChanged.speed} speed</span>
                        </div>
                      )}
                      {turn.statsChanged.defense && (
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🛡️</span>
                          <span>{turn.statsChanged.defense > 0 ? '+' : ''}{turn.statsChanged.defense} defense</span>
                        </div>
                      )}
                      {turn.statsChanged.health && (
                        <div className="flex items-center gap-2">
                          <span className="text-xl">❤️</span>
                          <span>{turn.statsChanged.health > 0 ? '+' : ''}{turn.statsChanged.health} health</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BattleLog;
