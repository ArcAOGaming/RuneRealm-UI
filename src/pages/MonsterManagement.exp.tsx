// Experience Bar Section
<div className="col-span-2">
  <div className="flex justify-between mb-1">
    <span className={`${theme.text} text-sm`}>Experience</span>
    <span className={`${theme.text} text-sm`}>{monster.exp}/{getFibonacciExp(monster.level)}</span>
  </div>
  <div className="w-full bg-gray-200 rounded-full h-2.5">
    <div 
      className="bg-purple-600 h-2.5 rounded-full" 
      style={{ width: `${Math.min(100, (monster.exp / getFibonacciExp(monster.level)) * 100)}%` }}
    ></div>
  </div>
</div>

// Play Button Cost Section
<div className="flex flex-wrap gap-2 max-h-[210px] overflow-y-auto">
  <div className={`px-3 py-1 rounded-full flex items-center gap-2 ${berryBalance >= activities.play.cost.amount ? 'bg-gray-700/50 text-black font-medium' : 'bg-gray-800/50 text-gray-400 border-2 border-red-500/70 shadow-[0_0_10px_-3px_rgba(239,68,68,0.6)]'}`}>
    <img src={`${Gateway}${assetBalances.find(a => a.info.processId === activities.play.cost.token)?.info.logo}`} 
         alt="Berry" className="w-4 h-4 rounded-full" />
    <span>-{activities.play.cost.amount}</span>
  </div>
  <div className={`px-3 py-1.5 rounded-full ${monster.energy >= activities.play.energyCost ? 'bg-blue-500/30 text-black font-medium' : 'bg-gray-800/50 text-gray-400 border-2 border-red-500/70 shadow-[0_0_10px_-3px_rgba(239,68,68,0.6)]'}`}>
    -{activities.play.energyCost} Energy
  </div>
</div>

// Mission Button Cost Section
<div className="flex flex-wrap gap-2 max-h-[210px] overflow-y-auto">
  <div className={`px-3 py-1 rounded-full flex items-center gap-2 ${missionFuelBalance >= activities.mission.cost.amount ? 'bg-gray-700/50 text-black font-medium' : 'bg-gray-800/50 text-gray-400 border-2 border-red-500/70 shadow-[0_0_10px_-3px_rgba(239,68,68,0.6)]'}`}>
    <img src={`${Gateway}${assetBalances.find(a => a.info.processId === activities.mission.cost.token)?.info.logo}`} 
         alt="TRUNK" className="w-4 h-4 rounded-full" />
    <span>-{activities.mission.cost.amount}</span>
  </div>
  <div className={`px-3 py-1.5 rounded-full ${monster.energy >= activities.mission.energyCost ? 'bg-blue-500/30 text-black font-medium' : 'bg-gray-800/50 text-gray-400 border-2 border-red-500/70 shadow-[0_0_10px_-3px_rgba(239,68,68,0.6)]'}`}>
    -{activities.mission.energyCost} Energy
  </div>
  <div className={`px-3 py-1.5 rounded-full ${monster.happiness >= activities.mission.happinessCost ? 'bg-yellow-500/30 text-black font-medium' : 'bg-gray-800/50 text-gray-400 border-2 border-red-500/70 shadow-[0_0_10px_-3px_rgba(239,68,68,0.6)]'}`}>
    -{activities.mission.happinessCost} Happy
  </div>
</div>
