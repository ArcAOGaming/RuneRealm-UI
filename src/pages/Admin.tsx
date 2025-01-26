import React, { useState, useEffect } from 'react';
import { getUserInfo, UserInfo, setUserStats, MonsterStatsUpdate, getFactionOptions, FactionOptions, adjustAllMonsters, SUPPORTED_ASSETS } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';
import Header from '../components/Header';
import { Gateway } from '../constants/Constants';
import AdminBulkUnlock from '../components/AdminBulkUnlock';
import AdminRemoveUser from '../components/AdminRemoveUser';

const Admin: React.FC = () => {
  const { darkMode, setDarkMode, triggerRefresh } = useWallet();
  const [walletAddress, setWalletAddress] = useState('');
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editedStats, setEditedStats] = useState<MonsterStatsUpdate>({});
  const [factions, setFactions] = useState<FactionOptions[]>([]);
  const theme = currentTheme(darkMode);

  useEffect(() => {
    const loadFactions = async () => {
      try {
        const options = await getFactionOptions();
        setFactions(options);
      } catch (error) {
        console.error('Error loading factions:', error);
      }
    };
    loadFactions();
  }, []);

  const handleSearch = async () => {
    if (!walletAddress) return;
    
    setIsLoading(true);
    try {
      const info = await getUserInfo(walletAddress);
      setUserInfo(info);
    } catch (error) {
      console.error('Error fetching user info:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMonsterStats = () => {
    if (!userInfo?.monster) return null;

    const monster = userInfo.monster;
    const maxStatValue = 5 + (monster.level * 5);

    return (
      <div className="mt-6">
        <h3 className={`text-xl font-bold mb-4 ${theme.text}`}>Monster Stats</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <img 
              src={`${Gateway}${monster.image}`}
              alt={monster.name}
              className="w-64 h-64 object-cover rounded-lg mb-4"
            />
            <h4 className={`text-lg font-bold ${theme.text}`}>{monster.name}</h4>
            <p className={`${theme.text}`}>Level {monster.level}</p>
          </div>
          
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className={`${theme.text} text-sm`}>Energy</span>
                <span className={`${theme.text} text-sm`}>{monster.energy}/100</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full" 
                  style={{ width: `${monster.energy}%` }}
                ></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className={`${theme.text} text-sm`}>Happiness</span>
                <span className={`${theme.text} text-sm`}>{monster.happiness}/100</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-pink-600 h-2.5 rounded-full" 
                  style={{ width: `${monster.happiness}%` }}
                ></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className={`${theme.text} text-sm`}>Experience</span>
                <span className={`${theme.text} text-sm`}>{monster.exp}/{maxStatValue}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-purple-600 h-2.5 rounded-full" 
                  style={{ width: `${Math.min((monster.exp / maxStatValue) * 100, 100)}%` }}
                ></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className={`${theme.text} p-2 rounded bg-opacity-20 ${theme.container}`}>
                <span className="font-semibold">Attack:</span> {monster.attack}/{maxStatValue}
              </div>
              <div className={`${theme.text} p-2 rounded bg-opacity-20 ${theme.container}`}>
                <span className="font-semibold">Defense:</span> {monster.defense}/{maxStatValue}
              </div>
              <div className={`${theme.text} p-2 rounded bg-opacity-20 ${theme.container}`}>
                <span className="font-semibold">Speed:</span> {monster.speed}/{maxStatValue}
              </div>
              <div className={`${theme.text} p-2 rounded bg-opacity-20 ${theme.container}`}>
                <span className="font-semibold">Health:</span> {monster.health}/{maxStatValue}
              </div>
            </div>

            <div className="mt-4">
              <h4 className={`text-lg font-bold mb-2 ${theme.text}`}>Status</h4>
              <div className={`${theme.text} p-2 rounded bg-opacity-20 ${theme.container}`}>
                <p>Current Status: {monster.status.type}</p>
                {monster.status.type !== 'Home' && (
                  <>
                    <p>Since: {new Date(monster.status.since).toLocaleString()}</p>
                    <p>Until: {new Date(monster.status.until_time).toLocaleString()}</p>
                    {userInfo.activityStatus.isPlayComplete && monster.status.type === 'Play' && (
                      <p className="text-green-500">Play Complete - Ready to Return</p>
                    )}
                    {userInfo.activityStatus.isMissionComplete && monster.status.type === 'Mission' && (
                      <p className="text-green-500">Mission Complete - Ready to Return</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header
          theme={theme}
          darkMode={darkMode}
          onDarkModeToggle={() => setDarkMode(!darkMode)}
        />
        
        <div className={`container mx-auto px-6 py-8 flex-1 ${theme.text}`}>
          <div className="max-w-4xl mx-auto">
            <h1 className={`text-3xl font-bold mb-8 ${theme.text}`}>Admin Panel</h1>
            
            {/* Admin Tools Section */}
            <div className={`flex flex-col gap-4 p-4 ${theme.container} border ${theme.border}`}>
              <AdminBulkUnlock />
              <AdminRemoveUser />
              <div>
                <button
                  onClick={async () => {
                    try {
                      const success = await adjustAllMonsters(triggerRefresh);
                      if (success) {
                        alert('Successfully adjusted all monsters');
                      }
                    } catch (error) {
                      console.error('Error adjusting monsters:', error);
                      alert('Failed to adjust monsters');
                    }
                  }}
                  className={`w-full px-6 py-2 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                >
                  Adjust All Monsters
                </button>
              </div>
            </div>

            <div className="mt-8">
              <h2 className={`text-2xl font-bold mb-4 ${theme.text}`}>User Management</h2>
              <div className="flex gap-4 mb-8">
                <input
                  type="text"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  placeholder="Enter wallet address"
                  className={`flex-1 px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                />
                <button
                  onClick={handleSearch}
                  disabled={isLoading || !walletAddress}
                  className={`px-6 py-2 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} ${(isLoading || !walletAddress) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isLoading ? 'Searching...' : 'Search'}
                </button>
              </div>
            </div>

            {userInfo && (
              <>
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border}`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <h3 className={`text-xl font-bold mb-4 ${theme.text}`}>Account Status</h3>
                    <div className="space-y-2">
                      <p>Eternal Pass: {userInfo.isUnlocked ? 'Yes' : 'No'}</p>
                      <p>Faction: {userInfo.faction || 'None'}</p>
                      <p>Custom Skin: {userInfo.skin ? 'Yes' : 'No'}</p>
                      <p>Has Monster: {userInfo.monster ? 'Yes' : 'No'}</p>
                    </div>
                  </div>
                </div>

                {renderMonsterStats()}

                {/* Identity and Status Section */}
                {userInfo.monster && (
                  <div className={`mt-8 p-6 rounded-xl ${theme.container} border ${theme.border}`}>
                    <h3 className={`text-xl font-bold mb-4 ${theme.text}`}>Identity & Status</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Faction</label>
                        <select
                          value={editedStats.faction ?? userInfo.faction ?? ''}
                          onChange={(e) => {
                            const selectedFaction = factions.find(f => f.name === e.target.value);
                            setEditedStats({
                              ...editedStats,
                              faction: e.target.value,
                              image: selectedFaction?.mascot
                            });
                          }}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        >
                          <option value="">Select Faction</option>
                          {factions.map(faction => (
                            <option key={faction.name} value={faction.name}>{faction.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Monster Image</label>
                        <select
                          value={editedStats.image ?? userInfo.monster.image}
                          onChange={(e) => setEditedStats({
                            ...editedStats,
                            image: e.target.value
                          })}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        >
                          {factions.map(faction => (
                            <option key={faction.mascot} value={faction.mascot}>{faction.name} Mascot</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Monster Name</label>
                        <input
                          type="text"
                          value={editedStats.name ?? userInfo.monster.name}
                          onChange={(e) => setEditedStats({
                            ...editedStats,
                            name: e.target.value
                          })}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        />
                      </div>
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Status Type</label>
                        <select
                          value={editedStats.status?.type ?? userInfo.monster.status.type}
                          onChange={(e) => {
                            const now = Date.now();
                            setEditedStats({
                              ...editedStats,
                              status: {
                                type: e.target.value as 'Home' | 'Play' | 'Mission',
                                since: now,
                                until_time: now + (e.target.value === 'Play' ? 15 * 60 * 1000 : 60 * 60 * 1000)
                              }
                            });
                          }}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        >
                          <option value="Home">Home</option>
                          <option value="Play">Play</option>
                          <option value="Mission">Mission</option>
                        </select>
                      </div>
                      {editedStats.status && editedStats.status.type !== 'Home' && (
                        <>
                          <div>
                            <label className={`block mb-2 ${theme.text}`}>Since (Unix Timestamp)</label>
                            <input
                              type="number"
                              value={editedStats.status.since}
                              onChange={(e) => setEditedStats({
                                ...editedStats,
                                status: {
                                  ...editedStats.status!,
                                  since: parseInt(e.target.value)
                                }
                              })}
                              className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                            />
                          </div>
                          <div>
                            <label className={`block mb-2 ${theme.text}`}>Until (Unix Timestamp)</label>
                            <input
                              type="number"
                              value={editedStats.status.until_time}
                              onChange={(e) => setEditedStats({
                                ...editedStats,
                                status: {
                                  ...editedStats.status!,
                                  until_time: parseInt(e.target.value)
                                }
                              })}
                              className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Activities Adjustment Section */}
                {userInfo.monster && (
                  <div className={`mt-8 p-6 rounded-xl ${theme.container} border ${theme.border}`}>
                    <h3 className={`text-xl font-bold mb-4 ${theme.text}`}>Adjust Monster Activities</h3>
                    
                    {/* Mission Activity */}
                    <div className="mb-6">
                      <h4 className={`text-lg font-semibold mb-3 ${theme.text}`}>Mission Activity</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Token</label>
                          <select
                            value={editedStats.activities?.mission?.cost?.token ?? userInfo.monster.activities.mission.cost.token}
                            onChange={(e) => setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                mission: {
                                  ...editedStats.activities?.mission,
                                  cost: {
                                    ...editedStats.activities?.mission?.cost,
                                    token: e.target.value
                                  }
                                }
                              }
                            })}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          >
                            {SUPPORTED_ASSETS.map(asset => (
                              <option key={asset} value={asset}>{asset}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Amount</label>
                          <input
                            type="number"
                            value={editedStats.activities?.mission?.cost?.amount ?? userInfo.monster.activities.mission.cost.amount}
                            onChange={(e) => setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                mission: {
                                  ...editedStats.activities?.mission,
                                  cost: {
                                    ...editedStats.activities?.mission?.cost,
                                    amount: parseInt(e.target.value)
                                  }
                                }
                              }
                            })}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          />
                        </div>
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Duration (ms)</label>
                          <input
                            type="number"
                            value={editedStats.activities?.mission?.duration ?? userInfo.monster.activities.mission.duration}
                          onChange={(e) => {
                            const currentMission = userInfo.monster.activities.mission;
                            setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                mission: {
                                  cost: editedStats.activities?.mission?.cost ?? currentMission.cost,
                                  duration: parseInt(e.target.value),
                                  energyCost: editedStats.activities?.mission?.energyCost ?? currentMission.energyCost,
                                  happinessCost: editedStats.activities?.mission?.happinessCost ?? currentMission.happinessCost
                                }
                              }
                            });
                          }}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          />
                        </div>
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Energy Cost</label>
                          <input
                            type="number"
                            value={editedStats.activities?.mission?.energyCost ?? userInfo.monster.activities.mission.energyCost}
                          onChange={(e) => {
                            const currentMission = userInfo.monster.activities.mission;
                            setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                mission: {
                                  cost: editedStats.activities?.mission?.cost ?? currentMission.cost,
                                  duration: editedStats.activities?.mission?.duration ?? currentMission.duration,
                                  energyCost: parseInt(e.target.value),
                                  happinessCost: editedStats.activities?.mission?.happinessCost ?? currentMission.happinessCost
                                }
                              }
                            });
                          }}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          />
                        </div>
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Happiness Cost</label>
                          <input
                            type="number"
                            value={editedStats.activities?.mission?.happinessCost ?? userInfo.monster.activities.mission.happinessCost}
                          onChange={(e) => {
                            const currentMission = userInfo.monster.activities.mission;
                            setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                mission: {
                                  cost: editedStats.activities?.mission?.cost ?? currentMission.cost,
                                  duration: editedStats.activities?.mission?.duration ?? currentMission.duration,
                                  energyCost: editedStats.activities?.mission?.energyCost ?? currentMission.energyCost,
                                  happinessCost: parseInt(e.target.value)
                                }
                              }
                            });
                          }}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Play Activity */}
                    <div className="mb-6">
                      <h4 className={`text-lg font-semibold mb-3 ${theme.text}`}>Play Activity</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Token</label>
                          <select
                            value={editedStats.activities?.play?.cost?.token ?? userInfo.monster.activities.play.cost.token}
                            onChange={(e) => setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                play: {
                                  ...editedStats.activities?.play,
                                  cost: {
                                    ...editedStats.activities?.play?.cost,
                                    token: e.target.value
                                  }
                                }
                              }
                            })}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          >
                            {SUPPORTED_ASSETS.map(asset => (
                              <option key={asset} value={asset}>{asset}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Amount</label>
                          <input
                            type="number"
                            value={editedStats.activities?.play?.cost?.amount ?? userInfo.monster.activities.play.cost.amount}
                            onChange={(e) => setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                play: {
                                  ...editedStats.activities?.play,
                                  cost: {
                                    ...editedStats.activities?.play?.cost,
                                    amount: parseInt(e.target.value)
                                  }
                                }
                              }
                            })}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          />
                        </div>
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Duration (ms)</label>
                          <input
                            type="number"
                            value={editedStats.activities?.play?.duration ?? userInfo.monster.activities.play.duration}
                          onChange={(e) => {
                            const currentPlay = userInfo.monster.activities.play;
                            setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                play: {
                                  cost: editedStats.activities?.play?.cost ?? currentPlay.cost,
                                  duration: parseInt(e.target.value),
                                  energyCost: editedStats.activities?.play?.energyCost ?? currentPlay.energyCost,
                                  happinessGain: editedStats.activities?.play?.happinessGain ?? currentPlay.happinessGain
                                }
                              }
                            });
                          }}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          />
                        </div>
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Energy Cost</label>
                          <input
                            type="number"
                            value={editedStats.activities?.play?.energyCost ?? userInfo.monster.activities.play.energyCost}
                          onChange={(e) => {
                            const currentPlay = userInfo.monster.activities.play;
                            setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                play: {
                                  cost: editedStats.activities?.play?.cost ?? currentPlay.cost,
                                  duration: editedStats.activities?.play?.duration ?? currentPlay.duration,
                                  energyCost: parseInt(e.target.value),
                                  happinessGain: editedStats.activities?.play?.happinessGain ?? currentPlay.happinessGain
                                }
                              }
                            });
                          }}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          />
                        </div>
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Happiness Gain</label>
                          <input
                            type="number"
                            value={editedStats.activities?.play?.happinessGain ?? userInfo.monster.activities.play.happinessGain}
                          onChange={(e) => {
                            const currentPlay = userInfo.monster.activities.play;
                            setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                play: {
                                  cost: editedStats.activities?.play?.cost ?? currentPlay.cost,
                                  duration: editedStats.activities?.play?.duration ?? currentPlay.duration,
                                  energyCost: editedStats.activities?.play?.energyCost ?? currentPlay.energyCost,
                                  happinessGain: parseInt(e.target.value)
                                }
                              }
                            });
                          }}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Feed Activity */}
                    <div className="mb-6">
                      <h4 className={`text-lg font-semibold mb-3 ${theme.text}`}>Feed Activity</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Token</label>
                          <select
                            value={editedStats.activities?.feed?.cost?.token ?? userInfo.monster.activities.feed.cost.token}
                            onChange={(e) => setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                feed: {
                                  ...editedStats.activities?.feed,
                                  cost: {
                                    ...editedStats.activities?.feed?.cost,
                                    token: e.target.value
                                  }
                                }
                              }
                            })}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          >
                            {SUPPORTED_ASSETS.map(asset => (
                              <option key={asset} value={asset}>{asset}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Amount</label>
                          <input
                            type="number"
                            value={editedStats.activities?.feed?.cost?.amount ?? userInfo.monster.activities.feed.cost.amount}
                            onChange={(e) => setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                feed: {
                                  ...editedStats.activities?.feed,
                                  cost: {
                                    ...editedStats.activities?.feed?.cost,
                                    amount: parseInt(e.target.value)
                                  }
                                }
                              }
                            })}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          />
                        </div>
                        <div>
                          <label className={`block mb-2 ${theme.text}`}>Energy Gain</label>
                          <input
                            type="number"
                            value={editedStats.activities?.feed?.energyGain ?? userInfo.monster.activities.feed.energyGain}
                          onChange={(e) => {
                            const currentFeed = userInfo.monster.activities.feed;
                            setEditedStats({
                              ...editedStats,
                              activities: {
                                ...editedStats.activities,
                                feed: {
                                  cost: editedStats.activities?.feed?.cost ?? currentFeed.cost,
                                  energyGain: parseInt(e.target.value)
                                }
                              }
                            });
                          }}
                            className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Stats Adjustment Section */}
                {userInfo.monster && (
                  <div className={`mt-8 p-6 rounded-xl ${theme.container} border ${theme.border}`}>
                    <h3 className={`text-xl font-bold mb-4 ${theme.text}`}>Adjust Monster Stats</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Level</label>
                        <input
                          type="number"
                          value={editedStats.level ?? userInfo.monster.level}
                          onChange={(e) => setEditedStats({
                            ...editedStats,
                            level: parseInt(e.target.value)
                          })}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        />
                      </div>
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Experience</label>
                        <input
                          type="number"
                          value={editedStats.exp ?? userInfo.monster.exp}
                          onChange={(e) => setEditedStats({
                            ...editedStats,
                            exp: parseInt(e.target.value)
                          })}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        />
                      </div>
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Attack</label>
                        <input
                          type="number"
                          value={editedStats.attack ?? userInfo.monster.attack}
                          onChange={(e) => setEditedStats({
                            ...editedStats,
                            attack: parseInt(e.target.value)
                          })}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        />
                      </div>
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Defense</label>
                        <input
                          type="number"
                          value={editedStats.defense ?? userInfo.monster.defense}
                          onChange={(e) => setEditedStats({
                            ...editedStats,
                            defense: parseInt(e.target.value)
                          })}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        />
                      </div>
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Speed</label>
                        <input
                          type="number"
                          value={editedStats.speed ?? userInfo.monster.speed}
                          onChange={(e) => setEditedStats({
                            ...editedStats,
                            speed: parseInt(e.target.value)
                          })}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        />
                      </div>
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Health</label>
                        <input
                          type="number"
                          value={editedStats.health ?? userInfo.monster.health}
                          onChange={(e) => setEditedStats({
                            ...editedStats,
                            health: parseInt(e.target.value)
                          })}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        />
                      </div>
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Energy</label>
                        <input
                          type="number"
                          value={editedStats.energy ?? userInfo.monster.energy}
                          onChange={(e) => setEditedStats({
                            ...editedStats,
                            energy: parseInt(e.target.value)
                          })}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        />
                      </div>
                      <div>
                        <label className={`block mb-2 ${theme.text}`}>Happiness</label>
                        <input
                          type="number"
                          value={editedStats.happiness ?? userInfo.monster.happiness}
                          onChange={(e) => setEditedStats({
                            ...editedStats,
                            happiness: parseInt(e.target.value)
                          })}
                          className={`w-full px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
                        />
                      </div>
                    </div>
                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={async () => {
                          setIsUpdating(true);
                          try {
                            const success = await setUserStats(walletAddress, editedStats, triggerRefresh);
                            if (success) {
                              const info = await getUserInfo(walletAddress);
                              setUserInfo(info);
                              setEditedStats({});
                            }
                          } catch (error) {
                            console.error('Error updating stats:', error);
                          } finally {
                            setIsUpdating(false);
                          }
                        }}
                        disabled={isUpdating || Object.keys(editedStats).length === 0}
                        className={`px-6 py-2 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} ${(isUpdating || Object.keys(editedStats).length === 0) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {isUpdating ? 'Updating...' : 'Update Stats'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Admin;
