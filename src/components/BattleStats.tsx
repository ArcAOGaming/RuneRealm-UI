import React, { useEffect, useRef } from 'react';
import { ActiveBattle } from '../utils/aoHelpers';
import { Theme } from '../constants/theme';
import styles from './BattleStats.module.css';

interface BattleStatsProps {
  battle: ActiveBattle;
  theme: Theme;
}

interface StatValues {
  attack: number;
  defense: number;
  speed: number;
}

const BattleStats: React.FC<BattleStatsProps> = ({ battle, theme }) => {
  const prevPlayerStats = useRef<StatValues>({
    attack: battle.player.attack,
    defense: battle.player.defense,
    speed: battle.player.speed
  });
  
  const prevOpponentStats = useRef<StatValues>({
    attack: battle.opponent.attack,
    defense: battle.opponent.defense,
    speed: battle.opponent.speed
  });

  useEffect(() => {
    // Update previous values after animations complete
    const timer = setTimeout(() => {
      prevPlayerStats.current = {
        attack: battle.player.attack,
        defense: battle.player.defense,
        speed: battle.player.speed
      };
      prevOpponentStats.current = {
        attack: battle.opponent.attack,
        defense: battle.opponent.defense,
        speed: battle.opponent.speed
      };
    }, 500);

    return () => clearTimeout(timer);
  }, [battle]);

  const getStatClassName = (current: number, previous: number) => {
    if (current > previous) {
      return styles.statIncrease;
    } else if (current < previous) {
      return styles.statDecrease;
    }
    return '';
  };

  return (
    <div className={`absolute top-0 left-0 right-0 py-4 px-6 ${theme.container} bg-opacity-90 backdrop-blur-sm z-10`}>
      <div className="flex justify-between items-center text-2xl">
        <div className="flex items-center gap-8">
          <div className="flex flex-col items-start justify-center">
            <span className="font-bold text-3xl leading-tight">{battle.player.name}</span>
            <span className="text-xl opacity-75 leading-tight">Level {battle.player.level}</span>
          </div>
          <span className={`font-medium text-3xl ${getStatClassName(battle.player.attack, prevPlayerStats.current.attack)}`}>
            ⚔️ {battle.player.attack}
          </span>
          <span className={`font-medium text-3xl ${getStatClassName(battle.player.defense, prevPlayerStats.current.defense)}`}>
            🛡️ {battle.player.defense}
          </span>
          <span className={`font-medium text-3xl ${getStatClassName(battle.player.speed, prevPlayerStats.current.speed)}`}>
            ⚡ {battle.player.speed}
          </span>
        </div>
        <div className="flex items-center gap-8 text-right">
          <span className={`font-medium text-3xl ${getStatClassName(battle.opponent.attack, prevOpponentStats.current.attack)}`}>
            ⚔️ {battle.opponent.attack}
          </span>
          <span className={`font-medium text-3xl ${getStatClassName(battle.opponent.defense, prevOpponentStats.current.defense)}`}>
            🛡️ {battle.opponent.defense}
          </span>
          <span className={`font-medium text-3xl ${getStatClassName(battle.opponent.speed, prevOpponentStats.current.speed)}`}>
            ⚡ {battle.opponent.speed}
          </span>
          <div className="flex flex-col items-end justify-center">
            <span className="font-bold text-3xl leading-tight">{battle.opponent.name}</span>
            <span className="text-xl opacity-75 leading-tight">Level {battle.opponent.level}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BattleStats;
