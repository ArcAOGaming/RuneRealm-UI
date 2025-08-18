import React, { useState } from 'react';
import { MonsterStats, executeActivity, message } from '../utils/aoHelpers';
import { ActivityCard } from './ActivityCard';
import { Theme } from '../constants/theme';
import { createDataItemSigner } from '../config/aoConnection';
import { TARGET_BATTLE_PID, SupportedAssetId, AdminSkinChanger } from '../constants/Constants';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import { useTokens } from '../contexts/TokenContext';
import { useMonster } from '../contexts/MonsterContext';

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
  monster?: MonsterStats;
  activities?: Activities;
  theme: Theme;
  className?: string;
  onEffectTrigger?: (effect: string) => void;
  onTriggerReturn?: () => void;
}

const MonsterActivities: React.FC<MonsterActivitiesProps> = ({
  monster: monsterProp,
  activities: activitiesProp,
  theme,
  className = '',
  onEffectTrigger,
  onTriggerReturn
}) => {
  const navigate = useNavigate();
  const { triggerRefresh, wallet } = useWallet();
  const { tokenBalances, refreshAllTokens } = useTokens();
  const { monster: contextMonster, formatTimeRemaining, calculateProgress, refreshMonsterAfterActivity } = useMonster();

  const monster = monsterProp || contextMonster;
  const activities = activitiesProp!;

  const [isFeeding, setIsFeeding] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isInBattle, setIsInBattle] = useState(false);
  const [isOnMission, setIsOnMission] = useState(false);

  // No monster data available
  if (!monster) {
    return (
      <div className={`activities-section ${theme.container} rounded-lg p-4 ${className}`}>
        <p className={`${theme.text}`}>Loading monster data...</p>
      </div>
    );
  }

  // Calculate if any activity is complete (timeUp is true)
  const timeUp = monster.status.type !== 'Home' &&
    monster.status.until_time &&
    Date.now() > monster.status.until_time;

  // Get token balances from token context
  const berryBalance = tokenBalances[activities.feed.cost.token as SupportedAssetId]?.balance || 0;
  const fuelBalance = tokenBalances[activities.battle.cost.token as SupportedAssetId]?.balance || 0;

  // Calculate if monster can feed
  const canFeed = monster.status.type === 'Home' && berryBalance >= activities.feed.cost.amount;

  // --- Button Text Logic ---
  let feedButtonText = "Feed";
  if (isFeeding) {
    feedButtonText = "Feeding...";
  }

  let playButtonText = "Play";
  if (isPlaying) {
    playButtonText = monster.status.type === 'Play' && timeUp ? "Returning..." : "Playing...";
  } else if (monster.status.type === 'Play') {
    playButtonText = timeUp ? "Return" : "Playing...";
  }

  let battleButtonText = "Battle";
  if (isInBattle) {
    battleButtonText = monster.status.type === 'Battle' && timeUp ? "Returning..." : "Battling...";
  } else if (monster.status.type === 'Battle') {
    battleButtonText = timeUp ? "Return" : "Battling...";
  }

  let missionButtonText = "Explore";
  if (isOnMission) {
    missionButtonText = monster.status.type === 'Mission' && timeUp ? "Returning..." : "Exploring...";
  } else if (monster.status.type === 'Mission') {
    missionButtonText = timeUp ? "Return" : "Exploring...";
  }

  // Check if all requirements are met for each activity
  const canPlay = (monster.status.type === 'Home' &&
    berryBalance >= activities.play.cost.amount &&
    monster.energy >= activities.play.energyCost) ||
    (monster.status.type === 'Play' && timeUp);

  const canMission = (monster.status.type === 'Home' &&
    fuelBalance >= activities.mission.cost.amount &&
    monster.energy >= activities.mission.energyCost &&
    monster.happiness >= activities.mission.happinessCost) ||
    (monster.status.type === 'Mission' && timeUp);

  const isBattleTime = monster.status.type === 'Battle';
  const canReturn = isBattleTime && Date.now() > monster.status.until_time;
  const canBattle = (monster.status.type === 'Home' &&
    fuelBalance >= activities.battle.cost.amount &&
    monster.energy >= activities.battle.energyCost &&
    monster.happiness >= activities.battle.happinessCost) ||
    (monster.status.type === 'Battle' && canReturn);

  // Handle feed monster
  const monsterInteraction = async (actionType) => {
    if (!monster) return;

    const actionKey = actionType.toLowerCase();
    const config = activities[actionKey];
    const targetProcessId = AdminSkinChanger;

    const isCurrentAction = monster.status.type.toLowerCase() === actionKey;
    const canReturn = isCurrentAction && Date.now() > monster.status.until_time;

    const asset = tokenBalances[config.cost.token as SupportedAssetId];

    if (!canReturn && (!asset || asset.balance < config.cost.amount)) {
      console.error(`Not enough resources for action: ${actionType}`, {
        token: config.cost.token,
        asset,
        currentBalance: asset?.balance || 0,
        required: config.cost.amount
      });
      return;
    }

    try {
      if (actionType === 'FEED') setIsFeeding(true);
      else if (actionType === 'PLAY') setIsPlaying(true);
      else if (actionType === 'BATTLE') setIsInBattle(true);
      else if (actionType === 'MISSION') setIsOnMission(true);

      if (!wallet) {
        console.error('No wallet connected');
        return;
      }
      const signer = await createDataItemSigner(wallet);

      await message({
        process: canReturn ? targetProcessId : config.cost.token,
        tags: canReturn ? [
          { name: "Action", value: `ReturnFrom-${actionType}` }
        ] : [
          { name: "Action", value: "Transfer" },
          { name: "Quantity", value: config.cost.amount.toString() },
          { name: "Recipient", value: targetProcessId },
          { name: "X-Action", value: actionType }
        ],
        signer,
        data: ""
      }, () => {
        // First trigger the regular refresh
        triggerRefresh();

        // Then schedule the forced monster data refresh after delay
        console.log(`[MonsterActivities] ${actionType} completed, scheduling monster refresh`);
        refreshMonsterAfterActivity();

        if (canReturn && onTriggerReturn) {
          onTriggerReturn();
        }
        if (actionType === 'FEED' && onEffectTrigger) {
          const healingEffects = ['Small Heal', 'Medium Heal', 'Large Heal', 'Full Heal'];
          const randomHeal = healingEffects[Math.floor(Math.random() * healingEffects.length)];
          onEffectTrigger(randomHeal);
        }
      });
      //executeActivity(signer,actionType,canReturn,config.cost.token,config.cost.amount.toString())

      if (actionType === 'BATTLE' && !canReturn) navigate('/battle');

      refreshAllTokens();

    } catch (error) {
      console.error(`Error handling ${actionType}:`, error);
    } finally {
      if (actionType === 'FEED') setIsFeeding(false);
      else if (actionType === 'PLAY') setIsPlaying(false);
      else if (actionType === 'BATTLE') setIsInBattle(false);
      else if (actionType === 'MISSION') setIsOnMission(false);
    }
  };

  return (
    <div className={`activities-section ${theme.container} p-2 rounded-xl ${className} h-full xl:h-fit`}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <h1 className={`text-lg font-bold ${theme.text} mb-1 shrink-0`}>Activities</h1>

        {/* Activities Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 p-1 -mx-1">
          <ActivityCard
            title="Feed"
            buttonText={feedButtonText}
            badge="INSTANT"
            badgeColor="yellow"
            gradientFrom="yellow-400"
            gradientTo="orange-500"
            tokenLogo={tokenBalances[activities.feed.cost.token as SupportedAssetId]?.info.logo}
            tokenBalance={berryBalance}
            tokenRequired={activities.feed.cost.amount}
            costs={[]}
            rewards={[
              { icon: "⚡", text: `+${activities.feed.energyGain} Energy`, color: "green-500" }
            ]}
            onAction={() => monsterInteraction('FEED')}
            isLoading={isFeeding}
            isDisabled={!canFeed}
            theme={theme}
            highlightSelectable={!isFeeding && canFeed}
          />

          <ActivityCard
            title="Play"
            buttonText={playButtonText}
            badge={`${Math.round(activities.play.duration / 60000)}m`}
            badgeColor="green"
            gradientFrom="green-400"
            gradientTo="emerald-500"
            tokenLogo={tokenBalances[activities.play.cost.token as SupportedAssetId]?.info.logo}
            tokenBalance={berryBalance}
            tokenRequired={activities.play.cost.amount}
            costs={[
              { icon: "⚡", text: `-${activities.play.energyCost} Energy`, isAvailable: monster.energy >= (activities.play.energyCost || 0) }
            ]}
            rewards={[
              { icon: "💝", text: `+${activities.play.happinessGain} Happy`, color: "pink-500" }
            ]}
            onAction={() => monsterInteraction('PLAY')}
            isLoading={isPlaying || (monster.status.type === 'Play' && !timeUp)}
            isDisabled={!canPlay || (monster.status.type !== 'Home' && (monster.status.type !== 'Play' || (monster.status.type === 'Play' && !timeUp)))}
            theme={theme}
            highlightSelectable={!isPlaying && canPlay}
          />

          <ActivityCard
            title="Battle"
            buttonText={battleButtonText}
            badge="ARENA"
            badgeColor="red"
            gradientFrom="red-400"
            gradientTo="purple-500"
            tokenLogo={tokenBalances[activities.battle.cost.token as SupportedAssetId]?.info.logo}
            tokenBalance={fuelBalance}
            tokenRequired={activities.battle.cost.amount}
            costs={[
              { icon: "⚡", text: `-${activities.battle.energyCost} Energy`, isAvailable: monster.energy >= (activities.battle.energyCost || 0) },
              { icon: "💝", text: `-${activities.battle.happinessCost} Happy`, isAvailable: monster.happiness >= (activities.battle.happinessCost || 0) }
            ]}
            rewards={[
              { icon: "⚔️", text: "GLORY", color: "purple-500" }
            ]}
            onAction={() => monsterInteraction('BATTLE')}
            isLoading={isInBattle || (monster.status.type === 'Battle' && !timeUp)}
            isDisabled={!canBattle || (monster.status.type !== 'Home' && (monster.status.type !== 'Battle' || (monster.status.type === 'Battle' && !timeUp)))}
            theme={theme}
            highlightSelectable={!isInBattle && canBattle}
          />

          <ActivityCard
            title="Explore"
            buttonText={missionButtonText}
            badge={`${Math.round(activities.mission.duration / 3600000)}h`}
            badgeColor="blue"
            gradientFrom="blue-400"
            gradientTo="indigo-500"
            tokenLogo={tokenBalances[activities.mission.cost.token as SupportedAssetId]?.info.logo}
            tokenBalance={fuelBalance}
            tokenRequired={activities.mission.cost.amount}
            costs={[
              { icon: "⚡", text: `-${activities.mission.energyCost} Energy`, isAvailable: monster.energy >= (activities.mission.energyCost || 0) },
              { icon: "💝", text: `-${activities.mission.happinessCost} Happy`, isAvailable: monster.happiness >= (activities.mission.happinessCost || 0) }
            ]}
            rewards={[
              { icon: "💰", text: "+LOOT", color: "blue-500" }
            ]}
            onAction={() => monsterInteraction('MISSION')}
            isLoading={isOnMission || (monster.status.type === 'Mission' && !timeUp)}
            isDisabled={!canMission || (monster.status.type !== 'Home' && (monster.status.type !== 'Mission' || (monster.status.type === 'Mission' && !timeUp)))}
            theme={theme}
            highlightSelectable={!isOnMission && canMission}
          />
        </div>
      </div>
    </div>
  );
};

export default MonsterActivities;
