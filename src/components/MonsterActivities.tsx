import React from 'react';
import { MonsterStats } from '../utils/aoHelpers';
import { ActivityCard } from './ActivityCard';
import { Theme } from '../constants/theme';

interface Asset {
  info: {
    processId: string;
    name: string;
    ticker: string;
    logo?: string;
  };
  balance: number;
}

interface ActivityConfig {
  cost: {
    token: string;
    amount: number;
  };
  energyCost?: number;
  happinessCost?: number;
  energyGain?: number;
  happinessGain?: number;
  duration?: number;
}

interface Activities {
  feed: ActivityConfig;
  play: ActivityConfig;
  battle: ActivityConfig;
  mission: ActivityConfig;
}

interface MonsterActivitiesProps {
  monster: MonsterStats;
  activities: Activities;
  assetBalances: Asset[];
  theme: Theme;
  berryBalance: number;
  fuelBalance: number;
  canFeed: boolean;
  canPlay: boolean;
  canBattle: boolean;
  canMission: boolean;
  isFeeding: boolean;
  isPlaying: boolean;
  isInBattle: boolean;
  isOnMission: boolean;
  timeUp: boolean;
  canReturn: boolean;
  handleFeedMonster: () => void;
  handlePlayMonster: () => void;
  handleBattle: () => void;
  handleMission: () => void;
  className?: string;
}

const MonsterActivities: React.FC<MonsterActivitiesProps> = ({
  monster,
  activities,
  assetBalances,
  theme,
  berryBalance,
  fuelBalance,
  canFeed,
  canPlay,
  canBattle,
  canMission,
  isFeeding,
  isPlaying,
  isInBattle,
  isOnMission,
  timeUp,
  canReturn,
  handleFeedMonster,
  handlePlayMonster,
  handleBattle,
  handleMission,
  className = ''
}) => {
  return (
    <div className={`activities-section ${theme.container} rounded-lg p-4 ${className}`}>
      <h3 className={`text-xl font-bold mb-2 ${theme.text}`}>Activities</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <ActivityCard
          title="Feed"
          badge="INSTANT"
          badgeColor="yellow"
          gradientFrom="yellow-400"
          gradientTo="orange-500"
          tokenLogo={assetBalances.find(a => a.info.processId === activities.feed.cost.token)?.info.logo}
          tokenBalance={berryBalance}
          tokenRequired={activities.feed.cost.amount}
          costs={[]}
          rewards={[
            { icon: "✨", text: `+${activities.feed.energyGain} Energy`, color: "green-500" }
          ]}
          onAction={handleFeedMonster}
          isLoading={isFeeding}
          isDisabled={!canFeed}
          actionText="Feed"
          loadingText="Feeding..."
          theme={theme}
          highlightSelectable={true}
        />

        <ActivityCard
          title="Play"
          badge={`${activities.play.duration / 60000}m`}
          badgeColor="green"
          gradientFrom="green-400"
          gradientTo="emerald-500"
          tokenLogo={assetBalances.find(a => a.info.processId === activities.play.cost.token)?.info.logo}
          tokenBalance={berryBalance}
          tokenRequired={activities.play.cost.amount}
          costs={[
            { icon: "⚡", text: `-${activities.play.energyCost} Energy`, isAvailable: monster.energy >= activities.play.energyCost }
          ]}
          rewards={[
            { icon: "💝", text: `+${activities.play.happinessGain} Happy`, color: "pink-500" }
          ]}
          onAction={handlePlayMonster}
          isLoading={isPlaying}
          isDisabled={!canPlay || (monster.status.type !== 'Home' && monster.status.type !== 'Play')}
          actionText={(monster.status.type === 'Play' && timeUp) ? 'Return from Play' : 'Play'}
          loadingText="Playing..."
          theme={theme}
          highlightSelectable={true}
        />

        <ActivityCard
          title="Battle"
          badge="ARENA"
          badgeColor="red"
          gradientFrom="red-400"
          gradientTo="purple-500"
          tokenLogo={assetBalances.find(a => a.info.processId === activities.battle.cost.token)?.info.logo}
          tokenBalance={fuelBalance}
          tokenRequired={activities.battle.cost.amount}
          costs={[
            { icon: "⚡", text: `-${activities.battle.energyCost} Energy`, isAvailable: monster.energy >= activities.battle.energyCost },
            { icon: "💝", text: `-${activities.battle.happinessCost} Happy`, isAvailable: monster.happiness >= activities.battle.happinessCost }
          ]}
          rewards={[
            { icon: "⚔️", text: "4 Battles", color: "purple-500" }
          ]}
          onAction={handleBattle}
          isLoading={isInBattle}
          isDisabled={!canBattle || (monster.status.type !== 'Home' && monster.status.type !== 'Battle')}
          actionText={(monster.status.type === 'Battle' && canReturn) ? 'Return from Battle' : 'Start Battle'}
          loadingText="In Battle..."
          theme={theme}
          highlightSelectable={true}
        />

        <ActivityCard
          title="Mission"
          badge={`${activities.mission.duration / 3600000}h`}
          badgeColor="blue"
          gradientFrom="blue-400"
          gradientTo="indigo-500"
          tokenLogo={assetBalances.find(a => a.info.processId === activities.mission.cost.token)?.info.logo}
          tokenBalance={fuelBalance}
          tokenRequired={activities.mission.cost.amount}
          costs={[
            { icon: "⚡", text: `-${activities.mission.energyCost} Energy`, isAvailable: monster.energy >= activities.mission.energyCost },
            { icon: "💝", text: `-${activities.mission.happinessCost} Happy`, isAvailable: monster.happiness >= activities.mission.happinessCost }
          ]}
          rewards={[
            { icon: "✨", text: "+1 EXP", color: "blue-500" }
          ]}
          onAction={handleMission}
          isLoading={isOnMission}
          isDisabled={!canMission || (monster.status.type !== 'Home' && monster.status.type !== 'Mission')}
          actionText={(monster.status.type === 'Mission' && timeUp) ? 'Return from Mission' : 'Start Mission'}
          loadingText="On Mission..."
          theme={theme}
          highlightSelectable={true}
        />
      </div>
    </div>
  );
};

export default MonsterActivities;
