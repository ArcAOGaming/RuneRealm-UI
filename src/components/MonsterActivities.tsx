import React, { useState } from 'react';
import { MonsterStats, message } from '../utils/aoHelpers';
import { ActivityCard } from './ActivityCard';
import { Theme } from '../constants/theme';
import { createDataItemSigner } from '../config/aoConnection';
import { TARGET_BATTLE_PID } from '../constants/Constants';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';

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
  const { assetBalances, triggerRefresh, refreshAssets } = useWallet();
  const [isFeeding, setIsFeeding] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isInBattle, setIsInBattle] = useState(false);
  const [isOnMission, setIsOnMission] = useState(false);
  
  // Calculate if any activity is complete (timeUp is true)
  const timeUp = monster.status.type !== 'Home' && 
                monster.status.until_time && 
                Date.now() > monster.status.until_time;
  
  // Get token balances from wallet context
  const berryBalance = assetBalances.find(a => a.info.processId === activities.feed.cost.token)?.balance || 0;
  const fuelBalance = assetBalances.find(a => a.info.processId === activities.battle.cost.token)?.balance || 0;
  
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
  const handleFeedMonster = async () => {
    if (!monster) return;
    
    const feedConfig = activities.feed.cost;
    console.log('Using berry process ID:', feedConfig.token);

    const asset = assetBalances.find(a => a.info.processId === feedConfig.token);
    console.log('Found asset:', asset);
    if (!asset || asset.balance < feedConfig.amount) {
      console.error('Not enough berries', {
        token: feedConfig.token,
        asset,
        currentBalance: asset?.balance || 0,
        required: feedConfig.amount
      });
      return;
    }

    try {
      setIsFeeding(true);
      console.log('Feeding monster with berry process:', feedConfig.token);
      
      const signer = createDataItemSigner(window.arweaveWallet);
      await message({
        process: feedConfig.token,
        tags: [
          { name: "Action", value: "Transfer" },
          { name: "Quantity", value: feedConfig.amount.toString() },
          { name: "Recipient", value: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI" },
          { name: "X-Action", value: "FEED" }
        ],
        signer,
        data: ""
      }, triggerRefresh);

      refreshAssets();
    } catch (error) {
      console.error('Error feeding monster:', error);
    } finally {
      setIsFeeding(false);
    }
  };

  // Handle play monster
  const handlePlayMonster = async () => {
    if (!monster) return;
    
    const playConfig = activities.play.cost;
    console.log('Using berry process ID:', playConfig.token);

    const isPlaytime = monster.status.type === 'Play';
    const canReturn = isPlaytime && Date.now() > monster.status.until_time;

    if (!canReturn) {
      const asset = assetBalances.find(a => a.info.processId === playConfig.token);
      console.log('Found asset:', asset);
      if (!asset || asset.balance < playConfig.amount) {
        console.error('Not enough berries', {
          token: playConfig.token,
          asset,
          currentBalance: asset?.balance || 0,
          required: playConfig.amount
        });
        return;
      }
    }

    try {
      setIsPlaying(true);
      console.log('Playing with monster');
      
      const signer = createDataItemSigner(window.arweaveWallet);

      if (canReturn) {
        await message({
          process: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI",
          tags: [
            { name: "Action", value: "ReturnFromPlay" }
          ],
          signer,
          data: ""
        }, triggerRefresh);
      } else {
        await message({
          process: playConfig.token,
          tags: [
            { name: "Action", value: "Transfer" },
            { name: "Quantity", value: playConfig.amount.toString() },
            { name: "Recipient", value: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI" },
            { name: "X-Action", value: "Play" }
          ],
          signer,
          data: ""
        }, triggerRefresh);
      }

      refreshAssets();
    } catch (error) {
      console.error('Error with play action:', error);
    } finally {
      setIsPlaying(false);
    }
  };

  // Handle battle
  const handleBattle = async () => {
    if (!monster) return;

    const isBattleTime = monster.status.type === 'Battle';
    const canReturn = isBattleTime && Date.now() > monster.status.until_time;

    try {
      setIsInBattle(true);
      console.log('Handling battle');
      
      const signer = createDataItemSigner(window.arweaveWallet);

      if (canReturn) {
        await message({
          process: TARGET_BATTLE_PID,
          tags: [
            { name: "Action", value: "ReturnFromBattle" }
          ],
          signer,
          data: ""
        }, triggerRefresh);
      } else {
        const battleConfig = activities.battle;
        const fuelAsset = assetBalances.find(a => a.info.processId === battleConfig.cost.token);
        
        if (!fuelAsset || fuelAsset.balance < battleConfig.cost.amount) {
          console.error('Not enough battle fuel');
          return;
        }

        await message({
          process: battleConfig.cost.token,
          tags: [
            { name: "Action", value: "Transfer" },
            { name: "Quantity", value: battleConfig.cost.amount.toString() },
            { name: "Recipient", value: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI" },
            { name: "X-Action", value: "Battle" }
          ],
          signer,
          data: ""
        }, triggerRefresh);

        // Navigate to battle page
        navigate('/battle');
      }

      refreshAssets();
    } catch (error) {
      console.error('Error with battle:', error);
    } finally {
      setIsInBattle(false);
    }
  };

  // Handle mission
  const handleMission = async () => {
    if (!monster) return;

    const isMissionTime = monster.status.type === 'Mission';
    const canReturn = isMissionTime && Date.now() > monster.status.until_time;

    try {
      setIsOnMission(true);
      console.log('Handling mission');
      
      const signer = createDataItemSigner(window.arweaveWallet);

      if (canReturn) {
        await message({
          process: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI",
          tags: [
            { name: "Action", value: "ReturnFromMission" }
          ],
          signer,
          data: ""
        }, triggerRefresh);
      } else {
        const missionConfig = activities.mission;
        const fuelAsset = assetBalances.find(a => a.info.processId === missionConfig.cost.token);
        
        if (!fuelAsset || fuelAsset.balance < missionConfig.cost.amount) {
          console.error('Not enough mission fuel');
          return;
        }

        await message({
          process: missionConfig.cost.token,
          tags: [
            { name: "Action", value: "Transfer" },
            { name: "Quantity", value: missionConfig.cost.amount.toString() },
            { name: "Recipient", value: "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI" },
            { name: "X-Action", value: "Mission" }
          ],
          signer,
          data: ""
        }, triggerRefresh);
      }

      refreshAssets();
    } catch (error) {
      console.error('Error with mission:', error);
    } finally {
      setIsOnMission(false);
    }
  };
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
