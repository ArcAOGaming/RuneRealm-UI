import React, { useState } from 'react';
import { MonsterStats, executeActivity, message } from '../utils/aoHelpers';
import { ActivityCard } from './ActivityCard';
import { Theme } from '../constants/theme';
import { createDataItemSigner } from '../config/aoConnection';
import { TARGET_BATTLE_PID, SupportedAssetId } from '../constants/Constants';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import { useTokens } from '../context/TokenContext';

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
  theme: Theme;
  className?: string;
}

const MonsterActivities: React.FC<MonsterActivitiesProps> = ({
  monster,
  activities,
  theme,
  className = ''
}) => {
  const navigate = useNavigate();
  const { triggerRefresh } = useWallet();
  const { tokenBalances, refreshAllTokens } = useTokens();
  const [isFeeding, setIsFeeding] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isInBattle, setIsInBattle] = useState(false);
  const [isOnMission, setIsOnMission] = useState(false);
  
  // Calculate if any activity is complete (timeUp is true)
  const timeUp = monster.status.type !== 'Home' && 
                monster.status.until_time && 
                Date.now() > monster.status.until_time;
  
  // Get token balances from token context
  const berryBalance = tokenBalances[activities.feed.cost.token as SupportedAssetId]?.balance || 0;
  const fuelBalance = tokenBalances[activities.battle.cost.token as SupportedAssetId]?.balance || 0;
  
  // Calculate if monster can feed
  const canFeed = monster.status.type === 'Home' && berryBalance >= activities.feed.cost.amount;
  
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
    const targetProcessId = 'j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI';
  
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
  
      const signer = await createDataItemSigner(window.arweaveWallet);
  
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
      }, triggerRefresh);
      //executeActivity(signer,actionType,canReturn,config.cost.token,config.cost.amount.toString())
  
      if (actionType === 'BATTLE' && !canReturn) navigate('/battle');
  
      refreshAllTokens();
  
    } catch (error) {
      console.error(`Error handling ${actionType}:`, error);
    } finally {
      if (actionType === 'FEED') setIsFeeding(false);
      else if (actionType === 'Play') setIsPlaying(false);
      else if (actionType === 'Battle') setIsInBattle(false);
      else if (actionType === 'Mission') setIsOnMission(false);
    }
  };
  return (
    <div className={`activities-section ${theme.container} rounded-lg p-4 ${className}`}>
      <h3 className={`text-xl font-bold mb-2 ${theme.text}`}>Activities</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <ActivityCard
          title="Feed"
          badge="INSTANT"
          badgeColor="yellow"
          gradientFrom="yellow-400"
          gradientTo="orange-500"
          tokenLogo={tokenBalances[activities.feed.cost.token as SupportedAssetId]?.info.logo}
          tokenBalance={berryBalance}
          tokenRequired={activities.feed.cost.amount}
          costs={[]}
          rewards={[
            { icon: "✨", text: `+${activities.feed.energyGain} Energy`, color: "green-500" }
          ]}
          onAction={() => monsterInteraction('FEED')}
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
          tokenLogo={tokenBalances[activities.play.cost.token as SupportedAssetId]?.info.logo}
          tokenBalance={berryBalance}
          tokenRequired={activities.play.cost.amount}
          costs={[
            { icon: "⚡", text: `-${activities.play.energyCost} Energy`, isAvailable: monster.energy >= activities.play.energyCost }
          ]}
          rewards={[
            { icon: "💝", text: `+${activities.play.happinessGain} Happy`, color: "pink-500" }
          ]}
          onAction={() => monsterInteraction('PLAY')}
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
          tokenLogo={tokenBalances[activities.battle.cost.token as SupportedAssetId]?.info.logo}
          tokenBalance={fuelBalance}
          tokenRequired={activities.battle.cost.amount}
          costs={[
            { icon: "⚡", text: `-${activities.battle.energyCost} Energy`, isAvailable: monster.energy >= activities.battle.energyCost },
            { icon: "💝", text: `-${activities.battle.happinessCost} Happy`, isAvailable: monster.happiness >= activities.battle.happinessCost }
          ]}
          rewards={[
            { icon: "⚔️", text: "4 Battles", color: "purple-500" }
          ]}
          onAction={() => monsterInteraction('BATTLE')}
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
          tokenLogo={tokenBalances[activities.mission.cost.token as SupportedAssetId]?.info.logo}
          tokenBalance={fuelBalance}
          tokenRequired={activities.mission.cost.amount}
          costs={[
            { icon: "⚡", text: `-${activities.mission.energyCost} Energy`, isAvailable: monster.energy >= activities.mission.energyCost },
            { icon: "💝", text: `-${activities.mission.happinessCost} Happy`, isAvailable: monster.happiness >= activities.mission.happinessCost }
          ]}
          rewards={[
            { icon: "✨", text: "+1 EXP", color: "blue-500" }
          ]}
          onAction={() => monsterInteraction('MISSION')}
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
