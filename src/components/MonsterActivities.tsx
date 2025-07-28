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
import { Zap } from 'lucide-react';

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
  
  // Use monster from props if provided, otherwise from context
  const monster = monsterProp || contextMonster;
  
  // Use activities directly from props - must be provided
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
        
        // Trigger return animation for return actions
        if (canReturn && onTriggerReturn) {
          console.log(`[MonsterActivities] Return action completed, triggering return animation for ${actionType}`);
          onTriggerReturn();
        }
        
        // Trigger healing effect after feed process completes successfully
        if (actionType === 'FEED' && onEffectTrigger) {
          const healingEffects = ['Small Heal', 'Medium Heal', 'Large Heal', 'Full Heal'];
          const randomHeal = healingEffects[Math.floor(Math.random() * healingEffects.length)];
          console.log(`[MonsterActivities] Feed completed successfully, triggering healing effect: ${randomHeal}`);
          onEffectTrigger(randomHeal);
        }
        
        // Then schedule the forced monster data refresh after delay
        console.log(`[MonsterActivities] ${actionType} completed, scheduling monster refresh`);
        refreshMonsterAfterActivity();
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
  // Detect if we're in compact mode
  const isCompact = className?.includes('compact-mode');

  return (
    <div className={`activities-section bg-gradient-to-br from-slate-50 to-slate-100 ${isCompact ? 'p-3 rounded-2xl' : 'p-6 rounded-3xl'} ${className}`}>
      <div className={isCompact ? 'flex flex-col' : 'max-w-4xl mx-auto'}>
        {/* Header */}
        <div className={`flex items-center gap-3 ${isCompact ? 'mb-4' : 'mb-8'}`}>
          <div className={`${isCompact ? 'p-1.5' : 'p-2'} bg-gradient-to-r from-orange-400 to-yellow-400 rounded-xl`}>
            <Zap className={`${isCompact ? 'w-4 h-4' : 'w-6 h-6'} text-white`} />
          </div>
          <h1 className={`${isCompact ? 'text-xl' : 'text-3xl'} font-bold text-slate-800`}>Activities</h1>
        </div>

        {/* Activities Grid */}
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${isCompact ? 'mb-3 flex-1' : 'gap-6 mb-8'}`}>
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
            { icon: "✨", text: `+${activities.feed.energyGain} Energy`, color: "green-500" }
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
            { icon: "⚔️", text: "GLORY", color: "purple-500" } // Updated reward text
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
            { icon: "✨", text: "+LOOT", color: "blue-500" } // Updated reward text
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
