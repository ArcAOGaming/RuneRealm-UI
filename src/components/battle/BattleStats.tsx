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
    attack: battle.challenger.attack,
    defense: battle.challenger.defense,
    speed: battle.challenger.speed
  });
  
  const prevOpponentStats = useRef<StatValues>({
    attack: battle.accepter.attack,
    defense: battle.accepter.defense,
    speed: battle.accepter.speed
  });

  useEffect(() => {
    // Update previous values after animations complete
    const timer = setTimeout(() => {
      prevPlayerStats.current = {
        attack: battle.challenger.attack,
        defense: battle.challenger.defense,
        speed: battle.challenger.speed
      };
      prevOpponentStats.current = {
        attack: battle.accepter.attack,
        defense: battle.accepter.defense,
        speed: battle.accepter.speed
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
            <span className="font-bold text-3xl leading-tight">{battle.challenger.name}</span>
            <span className="text-xl opacity-75 leading-tight">Level {battle.challenger.level}</span>
          </div>
          <span className={`font-medium text-3xl ${getStatClassName(battle.challenger.attack, prevPlayerStats.current.attack)}`}>
            ⚔️ {battle.challenger.attack}
          </span>
          <span className={`font-medium text-3xl ${getStatClassName(battle.challenger.defense, prevPlayerStats.current.defense)}`}>
            🛡️ {battle.challenger.defense}
          </span>
          <span className={`font-medium text-3xl ${getStatClassName(battle.challenger.speed, prevPlayerStats.current.speed)}`}>
            ⚡ {battle.challenger.speed}
          </span>
        </div>
        <div className="flex items-center gap-8 text-right">
          <span className={`font-medium text-3xl ${getStatClassName(battle.accepter.attack, prevOpponentStats.current.attack)}`}>
            ⚔️ {battle.accepter.attack}
          </span>
          <span className={`font-medium text-3xl ${getStatClassName(battle.accepter.defense, prevOpponentStats.current.defense)}`}>
            🛡️ {battle.accepter.defense}
          </span>
          <span className={`font-medium text-3xl ${getStatClassName(battle.accepter.speed, prevOpponentStats.current.speed)}`}>
            ⚡ {battle.accepter.speed}
          </span>
          <div className="flex flex-col items-end justify-center">
            <span className="font-bold text-3xl leading-tight">{battle.accepter.name}</span>
            <span className="text-xl opacity-75 leading-tight">Level {battle.accepter.level}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BattleStats;
