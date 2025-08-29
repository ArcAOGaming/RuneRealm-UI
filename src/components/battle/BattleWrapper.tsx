import React from 'react';
import { ActiveBattle as NewActiveBattle, MonsterStats, MonsterState } from '../../utils/interefaces';
import type { BattleParticipant } from '../../utils/aoHelpers';
import BattleScene from './BattleScene';
import BattleStats from './BattleStats';
import { Theme } from '../../constants/theme';

interface BattleWrapperProps {
  battle: NewActiveBattle;
  theme: Theme;
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

const BattleWrapper: React.FC<BattleWrapperProps> = ({
  battle,
  theme,
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
  // Convert challenger/accepter to player/opponent for attack animation
  const convertedAttackAnimation = attackAnimation ? {
    attacker: (attackAnimation.attacker === 'challenger' ? 'challenger' : 'accepter') as 'challenger' | 'accepter',
    moveName: attackAnimation.moveName
  } : null;

  return (
    <>
      <BattleScene
        challenger={battle.challenger}
        accepter={battle.accepter}
        playerAnimation={playerAnimation}
        opponentAnimation={opponentAnimation}
        onPlayerAnimationComplete={onPlayerAnimationComplete}
        onOpponentAnimationComplete={onOpponentAnimationComplete}
        attackAnimation={convertedAttackAnimation}
        shieldRestoring={shieldRestoring}
        showEndOfRound={showEndOfRound}
        onAttackComplete={onAttackComplete}
        onShieldComplete={onShieldComplete}
        onRoundComplete={onRoundComplete}
      />
      <BattleStats battle={battle} theme={theme} />
    </>
  );
};

export default BattleWrapper;
