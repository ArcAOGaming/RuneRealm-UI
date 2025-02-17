import React, { useState, useEffect } from 'react';
import MonsterSpriteView from './MonsterSpriteView';
import { MonsterStats } from '../utils/aoHelpers';
import BattleStatus from './BattleStatus';
import { BATTLE_POSITIONS } from '../constants/Constants';

interface BattleSceneProps {
  player: MonsterStats;
  opponent: MonsterStats;
  playerAnimation?: 'walkRight' | 'walkLeft' | 'walkUp' | 'walkDown' | 'attack1' | 'attack2';
  opponentAnimation?: 'walkRight' | 'walkLeft' | 'walkUp' | 'walkDown' | 'attack1' | 'attack2';
  onPlayerAnimationComplete?: () => void;
  onOpponentAnimationComplete?: () => void;
  attackAnimation: {
    attacker: 'player' | 'opponent';
    moveName: string;
  } | null;
  shieldRestoring: boolean;
  showEndOfRound: boolean;
  onAttackComplete: () => void;
  onShieldComplete: () => void;
  onRoundComplete: () => void;
}

const BattleScene: React.FC<BattleSceneProps> = ({
  player,
  opponent,
  playerAnimation,
  opponentAnimation,
  onPlayerAnimationComplete,
  onOpponentAnimationComplete,
  attackAnimation,
  shieldRestoring,
  showEndOfRound,
  onAttackComplete,
  onShieldComplete,
  onRoundComplete
}) => {
  const [playerPosition, setPlayerPosition] = useState<'home' | 'attack'>('home');
  const [opponentPosition, setOpponentPosition] = useState<'home' | 'attack'>('home');

  // Update positions based on animations
  useEffect(() => {
    if (playerAnimation === 'walkRight') {
      setPlayerPosition('attack');
    } else if (playerAnimation === 'walkLeft') {
      setPlayerPosition('home');
    }
  }, [playerAnimation]);

  useEffect(() => {
    if (opponentAnimation === 'walkRight') {
      setOpponentPosition('attack');
    } else if (opponentAnimation === 'walkLeft') {
      setOpponentPosition('home');
    }
  }, [opponentAnimation]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-lg">
      {/* Background */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/src/assets/backgrounds/1.png)' }}
      />
      
      {/* Player Monster */}
      <div 
        className="absolute bottom-[15%] transition-all duration-[750ms] ease-in-out"
        style={{ 
          left: playerPosition === 'attack' ? BATTLE_POSITIONS.ATTACK_OFFSET : BATTLE_POSITIONS.HOME_OFFSET
        }}
      >
        {/* Stats Display */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 w-40">
          {/* Shield Bar */}
          <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden relative">
            <div 
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${(player.shield / player.defense) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-bold">
              {player.shield}/{player.defense}
            </div>
          </div>
          {/* Health Bar */}
          <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden relative">
            <div 
              className="h-full bg-red-500 transition-all duration-500"
              style={{ width: `${(player.healthPoints / (player.health * 10)) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-bold">
              {player.healthPoints}/{player.health * 10}
            </div>
          </div>
        </div>
        
        {/* Monster Sprite */}
        <MonsterSpriteView
          sprite={player.sprite}
          currentAnimation={playerAnimation}
          onAnimationComplete={onPlayerAnimationComplete}
        />
      </div>
      
      {/* Opponent Monster */}
      <div 
        className="absolute bottom-[15%] transition-all duration-[750ms] ease-in-out"
        style={{ 
          right: opponentPosition === 'attack' ? BATTLE_POSITIONS.ATTACK_OFFSET : BATTLE_POSITIONS.HOME_OFFSET
        }}
      >
        {/* Stats Display */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 w-40">
          {/* Shield Bar */}
          <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden relative">
            <div 
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${(opponent.shield / opponent.defense) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-bold">
              {opponent.shield}/{opponent.defense}
            </div>
          </div>
          {/* Health Bar */}
          <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden relative">
            <div 
              className="h-full bg-red-500 transition-all duration-500"
              style={{ width: `${(opponent.healthPoints / (opponent.health * 10)) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-bold">
              {opponent.healthPoints}/{opponent.health * 10}
            </div>
          </div>
        </div>
        
        {/* Monster Sprite */}
        <MonsterSpriteView
          sprite={opponent.sprite}
          currentAnimation={opponentAnimation}
          onAnimationComplete={onOpponentAnimationComplete}
          isOpponent
        />
      </div>

      {/* Battle Status Overlay */}
      <BattleStatus
        attackAnimation={attackAnimation}
        shieldRestoring={shieldRestoring}
        showEndOfRound={showEndOfRound}
        onAttackComplete={onAttackComplete}
        onShieldComplete={onShieldComplete}
        onRoundComplete={onRoundComplete}
        playerMonsterName={player.name}
        opponentMonsterName={opponent.name}
      />
    </div>
  );
};

export default BattleScene;
