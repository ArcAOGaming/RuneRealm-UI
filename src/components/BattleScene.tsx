import React, { useState, useEffect } from 'react';
import MonsterSpriteView from './MonsterSpriteView';
import { MonsterStats } from '../utils/aoHelpers';
import BattleStatus from './BattleStatus';
import { BATTLE_POSITIONS } from '../constants/Constants';

interface BattleSceneProps {
  challenger: MonsterStats;
  accepter: MonsterStats;
  playerAnimation?: 'walkRight' | 'walkLeft' | 'walkUp' | 'walkDown' | 'attack1' | 'attack2';
  opponentAnimation?: 'walkRight' | 'walkLeft' | 'walkUp' | 'walkDown' | 'attack1' | 'attack2';
  onPlayerAnimationComplete?: () => void;
  onOpponentAnimationComplete?: () => void;
  attackAnimation: {
    attacker: 'challenger' | 'accepter';
    moveName: string;
  } | null;
  shieldRestoring: boolean;
  showEndOfRound: boolean;
  onAttackComplete: () => void;
  onShieldComplete: () => void;
  onRoundComplete: () => void;
}

const BattleScene: React.FC<BattleSceneProps> = ({
  challenger,
  accepter,
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
        className="absolute inset-0 bg-contain bg-center bg-no-repeat"
        style={{ 
          backgroundImage: `url(${new URL('../assets/backgrounds/1.png', import.meta.url).href})`,
          backgroundColor: '#1a1a2e' // Fallback color for areas not covered by background
        }}
      />
      
      {/* Player Monster */}
      <div 
        className="absolute bottom-[15%] transition-all duration-[750ms] ease-in-out"
        style={{ 
          left: playerPosition === 'attack' ? BATTLE_POSITIONS.ATTACK_OFFSET : BATTLE_POSITIONS.HOME_OFFSET,
          width: 'min(20vw, 200px)',
          height: 'min(20vw, 200px)',
          minWidth: '120px',
          minHeight: '120px'
        }}
      >
        {/* Stats Display */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 w-40">
          {/* Shield Bar */}
          <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden relative">
            <div 
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${(challenger.shield / challenger.defense) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-bold">
              {challenger.shield}/{challenger.defense}
            </div>
          </div>
          {/* Health Bar */}
          <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden relative">
            <div 
              className="h-full bg-red-500 transition-all duration-500"
              style={{ width: `${(challenger.healthPoints / (challenger.health * 10)) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-bold">
              {challenger.healthPoints}/{challenger.health * 10}
            </div>
          </div>
        </div>
        
        {/* Monster Sprite */}
        <div className="w-full h-full">
          <MonsterSpriteView
            sprite={challenger.sprite}
            currentAnimation={playerAnimation}
            onAnimationComplete={onPlayerAnimationComplete}
            containerWidth={200}
            containerHeight={200}
          />
        </div>
      </div>
      
      {/* Opponent Monster */}
      <div 
        className="absolute bottom-[15%] transition-all duration-[750ms] ease-in-out"
        style={{ 
          right: opponentPosition === 'attack' ? BATTLE_POSITIONS.ATTACK_OFFSET : BATTLE_POSITIONS.HOME_OFFSET,
          width: 'min(20vw, 200px)',
          height: 'min(20vw, 200px)',
          minWidth: '120px',
          minHeight: '120px'
        }}
      >
        {/* Stats Display */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 w-40">
          {/* Shield Bar */}
          <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden relative">
            <div 
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${(accepter.shield / accepter.defense) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-bold">
              {accepter.shield}/{accepter.defense}
            </div>
          </div>
          {/* Health Bar */}
          <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden relative">
            <div 
              className="h-full bg-red-500 transition-all duration-500"
              style={{ width: `${(accepter.healthPoints / (accepter.health * 10)) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-bold">
              {accepter.healthPoints}/{accepter.health * 10}
            </div>
          </div>
        </div>
        
        {/* Monster Sprite */}
        <div className="w-full h-full">
          <MonsterSpriteView
            sprite={accepter.sprite}
            currentAnimation={opponentAnimation}
            onAnimationComplete={onOpponentAnimationComplete}
            isOpponent
            containerWidth={200}
            containerHeight={200}
          />
        </div>
      </div>

      {/* Battle Status Overlay */}
      <BattleStatus
        attackAnimation={attackAnimation}
        shieldRestoring={shieldRestoring}
        showEndOfRound={showEndOfRound}
        onAttackComplete={onAttackComplete}
        onShieldComplete={onShieldComplete}
        onRoundComplete={onRoundComplete}
        playerMonsterName={"Player 1's  " +challenger.name}
        opponentMonsterName={"Player 2's  " + accepter.name}
      />
    </div>
  );
};

export default BattleScene;
