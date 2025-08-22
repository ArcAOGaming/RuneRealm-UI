import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWallet } from '../../contexts/WalletContext';
import { useFaction } from '../../contexts/FactionContext';
import { ProfileInfo, getProfileInfo, getUserMonster, MonsterStats } from '../../utils/aoHelpers';
import { FactionOptions } from '../../utils/interefaces';
import { currentTheme } from '../../constants/theme';
import { Gateway } from '../../constants/Constants';
import Header from '../../components/Header';
import LoadingAnimation from '../../components/LoadingAnimation';
import Footer from '../../components/Footer';
import { ProfileCard } from '../../components/ProfileCard';
import { ProfileDetail } from '../../components/ProfileDetail';

interface FactionMember {
  id: string;
  level: number;
}

interface MemberWithProfile extends FactionMember {
  profile: ProfileInfo | null;
  monster: MonsterStats | null;
  isLoading?: boolean;
}

interface FactionWithProfiles {
  name: string;
  description: string;
  mascot: string;
  perks: string[];
  memberCount: number;
  monsterCount: number;
  members: FactionMember[];
  averageLevel: number;
  totalTimesFed: number;
  totalTimesPlay: number;
  totalTimesMission: number;
}

// Cache utilities for member data
const MEMBER_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface CachedMemberData {
  profile: ProfileInfo | null;
  monster: MonsterStats | null;
  timestamp: number;
  hasNoMonster?: boolean; // Track if user has no monster to avoid repeated requests
}

const getMemberCacheKey = (memberId: string) => `member-data-${memberId}`;

const getCachedMemberData = (memberId: string): CachedMemberData | null => {
  try {
    const cached = localStorage.getItem(getMemberCacheKey(memberId));
    if (!cached) return null;
    
    const parsedCache = JSON.parse(cached) as CachedMemberData;
    if (!parsedCache.timestamp || Date.now() - parsedCache.timestamp > MEMBER_CACHE_DURATION) {
      localStorage.removeItem(getMemberCacheKey(memberId));
      return null;
    }
    
    return parsedCache;
  } catch (error) {
    console.error(`Error getting cached member data for ${memberId}:`, error);
    return null;
  }
};

const setCachedMemberData = (memberId: string, profile: ProfileInfo | null, monster: MonsterStats | null) => {
  try {
    const cacheData: CachedMemberData = {
      profile,
      monster,
      timestamp: Date.now(),
      hasNoMonster: monster === null
    };
    localStorage.setItem(getMemberCacheKey(memberId), JSON.stringify(cacheData));
  } catch (error) {
    console.error(`Error caching member data for ${memberId}:`, error);
  }
};

export const FactionDetailPage: React.FC = () => {
  const { factionId } = useParams();
  const navigate = useNavigate();
  const { wallet, darkMode, setDarkMode, refreshTrigger } = useWallet();
  const { factions, isLoadingFactions } = useFaction();
  const [faction, setFaction] = useState<FactionWithProfiles | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<MemberWithProfile | null>(null);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, ProfileInfo>>({});
  const [memberMonsters, setMemberMonsters] = useState<Record<string, MonsterStats | null>>({});
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [profileLoadingStates, setProfileLoadingStates] = useState<Record<string, boolean>>({});
  const [monsterLoadingStates, setMonsterLoadingStates] = useState<Record<string, boolean>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortedMembers, setSortedMembers] = useState<FactionMember[]>([]);
  const ITEMS_PER_PAGE = 50;
  const theme = currentTheme(darkMode);

  const factionMap = {
    'air': 'Sky Nomads',
    'water': 'Aqua Guardians',
    'fire': 'Inferno Blades',
    'rock': 'Stone Titans'
  };

  const loadMemberData = async (members: FactionMember[], page: number) => {
    const startIdx = (page - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const membersToLoad = members.slice(startIdx, endIdx);
    
    if (membersToLoad.length === 0) {
      setHasMore(false);
      return;
    }

    // Set loading states for members that aren't cached
    const newLoadingStates = { ...loadingStates };
    const newProfileLoadingStates = { ...profileLoadingStates };
    const newMonsterLoadingStates = { ...monsterLoadingStates };
    const membersToFetch: FactionMember[] = [];
    
    membersToLoad.forEach(member => {
      const cachedData = getCachedMemberData(member.id);
      
      if (cachedData) {
        // Use cached data immediately
        if (cachedData.profile) {
          setMemberProfiles(prev => ({
            ...prev,
            [member.id]: cachedData.profile!
          }));
        }
        
        setMemberMonsters(prev => ({
          ...prev,
          [member.id]: cachedData.monster
        }));
      } else {
        // Mark for fetching
        membersToFetch.push(member);
        newLoadingStates[member.id] = true;
        newProfileLoadingStates[member.id] = true;
        newMonsterLoadingStates[member.id] = true;
      }
    });
    
    setLoadingStates(newLoadingStates);
    setProfileLoadingStates(newProfileLoadingStates);
    setMonsterLoadingStates(newMonsterLoadingStates);

    // Load data for uncached members with individual promise tracking
    const memberPromises = membersToFetch.map(async (member) => {
      // Load profile and monster separately to update UI as each completes
      const profilePromise = getProfileInfo(member.id, true).catch(() => null);
      const monsterPromise = getUserMonster({ address: member.id }, true).catch(() => null);

      // Update profile as soon as it loads
      profilePromise.then(profile => {
        if (profile) {
          setMemberProfiles(prev => ({
            ...prev,
            [member.id]: profile
          }));
        }
        setProfileLoadingStates(prev => ({
          ...prev,
          [member.id]: false
        }));
      });

      // Update monster as soon as it loads
      monsterPromise.then(monster => {
        setMemberMonsters(prev => ({
          ...prev,
          [member.id]: monster
        }));
        setMonsterLoadingStates(prev => ({
          ...prev,
          [member.id]: false
        }));
      });

      try {
        // Wait for both to complete for caching
        const [profile, monster] = await Promise.all([profilePromise, monsterPromise]);
        
        // Cache the results (including null values for "no monster" state)
        setCachedMemberData(member.id, profile, monster);

        return { memberId: member.id, success: true };
      } catch (error) {
        console.error(`Error loading data for ${member.id}:`, error);
        
        // Cache the failed state to avoid repeated requests
        setCachedMemberData(member.id, null, null);
        
        return { memberId: member.id, success: false };
      }
    });

    // Wait for all member data to load and update loading states
    const results = await Promise.allSettled(memberPromises);
    
    const finalLoadingStates = { ...loadingStates };
    results.forEach((result, index) => {
      const memberId = membersToFetch[index].id;
      finalLoadingStates[memberId] = false;
    });
    setLoadingStates(finalLoadingStates);

    // Check if there are more members to load
    setHasMore(endIdx < members.length);
    setIsLoadingMore(false);
  };

  const loadMoreMembers = () => {
    if (isLoadingMore || !hasMore || !faction) return;
    
    setIsLoadingMore(true);
    setCurrentPage(prev => prev + 1);
  };

  useEffect(() => {
    const loadFactionData = async () => {
      try {
        if (!factions || factions.length === 0) {
          setIsLoading(false);
          return;
        }
        
        const factionName = factionMap[factionId as keyof typeof factionMap];
        const foundFaction = factions.find(f => f.name === factionName);
        
        if (!foundFaction) {
          navigate('/factions');
          return;
        }

        // Sort members by level (highest first)
        const sortedMembers = [...foundFaction.members].sort((a, b) => b.level - a.level);
        setSortedMembers(sortedMembers);

        const typedFaction: FactionWithProfiles = {
          name: foundFaction.name,
          description: foundFaction.description,
          mascot: foundFaction.mascot,
          perks: foundFaction.perks,
          members: sortedMembers,
          averageLevel: foundFaction.averageLevel,
          memberCount: typeof foundFaction.memberCount === 'number' ? foundFaction.memberCount : Number(foundFaction.memberCount || 0),
          monsterCount: typeof foundFaction.monsterCount === 'number' ? foundFaction.monsterCount : Number(foundFaction.monsterCount || 0),
          totalTimesFed: typeof foundFaction.totalTimesFed === 'number' ? foundFaction.totalTimesFed : Number(foundFaction.totalTimesFed || 0),
          totalTimesPlay: typeof foundFaction.totalTimesPlay === 'number' ? foundFaction.totalTimesPlay : Number(foundFaction.totalTimesPlay || 0),
          totalTimesMission: typeof foundFaction.totalTimesMission === 'number' ? foundFaction.totalTimesMission : Number(foundFaction.totalTimesMission || 0)
        };
        
        setFaction(typedFaction);
        setIsLoading(false);
        
        // Load first page of members
        await loadMemberData(sortedMembers, 1);
      } catch (error) {
        console.error('Error loading faction data:', error);
        setIsLoading(false);
      }
    };

    loadFactionData();
  }, [factionId, navigate, refreshTrigger, factions]);

  // Load more members when currentPage changes
  useEffect(() => {
    if (currentPage > 1 && sortedMembers.length > 0) {
      loadMemberData(sortedMembers, currentPage);
    }
  }, [currentPage]);

  if (isLoading || isLoadingFactions) {
    return (
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header
          theme={theme}
          darkMode={darkMode}
        />
        <div className="flex-1 flex items-center justify-center">
          <LoadingAnimation />
        </div>
      </div>
    );
  }

  if (!faction) {
    return null;
  }

  return (
    <div className={`h-screen-safe flex flex-col ${theme.bg} overflow-hidden`}>
      <Header
        theme={theme}
        darkMode={darkMode}
      />
      
      <div className={`container mx-auto px-4 sm:px-6 py-2 sm:py-4 flex-1 ${theme.text} overflow-hidden`}>
        <div className="max-w-7xl mx-auto h-full flex flex-col">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-3 sm:mb-4 flex-shrink-0">
            <button 
              onClick={() => navigate('/factions')}
              className={`px-4 py-2 rounded-xl ${theme.buttonBg} ${theme.buttonHover} font-bold transition-all duration-300 hover:scale-105 shadow-lg border border-blue-500/30 flex items-center gap-2`}
            >
              ⬅️ Back to Factions
            </button>
            <div className="relative">
              <h1 className={`text-2xl sm:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent`}>
                ⚔️ {faction.name} ⚔️
              </h1>
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 rounded-lg blur opacity-20 animate-pulse"></div>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-3 sm:gap-4 min-h-0">
            {/* Compact Faction Overview Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 flex-shrink-0">
              {/* Mascot */}
              <div className={`relative p-3 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md overflow-hidden`}>
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10"></div>
                <div className="relative z-10 text-center">
                  {faction.mascot && (
                    <img
                      src={`${Gateway}${faction.mascot}`}
                      alt={`${faction.name} Mascot`}
                      className="w-full rounded-lg object-contain max-h-[120px] shadow-lg border border-blue-500/30 mx-auto"
                    />
                  )}
                </div>
              </div>

              {/* Compact Stats */}
              <div className={`relative p-3 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md overflow-hidden`}>
                <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 via-emerald-500/10 to-teal-500/10"></div>
                <div className="relative z-10">
                  <h3 className="text-base font-bold mb-2 text-green-400 flex items-center gap-2">📊 Stats</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-1.5 text-center">
                      <div className="text-lg font-bold text-blue-400">{faction.memberCount}</div>
                      <div className="text-xs opacity-70">👥 Members</div>
                    </div>
                    <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-1.5 text-center">
                      <div className="text-lg font-bold text-green-400">{faction.monsterCount}</div>
                      <div className="text-xs opacity-70">🐲 Monsters</div>
                    </div>
                    <div className="bg-purple-500/20 border border-purple-500/50 rounded-lg p-1.5 text-center">
                      <div className="text-lg font-bold text-purple-400">
                        {typeof faction.averageLevel === 'number' ? Math.round(faction.averageLevel * 10) / 10 : 0}
                      </div>
                      <div className="text-xs opacity-70">📊 Avg Lv</div>
                    </div>
                    <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-1.5 text-center">
                      <div className="text-lg font-bold text-yellow-400">
                        {(faction.totalTimesFed || 0) + (faction.totalTimesPlay || 0) + (faction.totalTimesMission || 0)}
                      </div>
                      <div className="text-xs opacity-70">🏆 Power</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Compact Description & Perks */}
              <div className={`relative p-3 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md overflow-hidden`}>
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-pink-500/10 to-red-500/10"></div>
                <div className="relative z-10">
                  <h3 className="text-base font-bold mb-2 text-yellow-400 flex items-center gap-2">✨ Perks</h3>
                  <div className="space-y-1.5">
                    {faction.perks.slice(0, 2).map((perk, index) => (
                      <div key={index} className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-1.5">
                        <div className="flex items-start gap-2">
                          <span className="text-yellow-400 text-sm flex-shrink-0">⭐</span>
                          <span className="text-xs opacity-90 leading-tight">{perk}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Members Section */}
            <div className={`relative p-1 rounded-2xl ${theme.container} border-2 ${theme.border} backdrop-blur-md overflow-hidden flex-1 min-h-0`}>
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-pink-500/10"></div>
              <div className="relative z-10 h-full flex flex-col">
                <h2 className="text-xl sm:text-2xl font-bold mb-3 flex items-center gap-2 bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent flex-shrink-0">
                  👥 Faction Warriors ({faction.memberCount})
                </h2>
                
                <div className="flex-1 min-h-0">
                  {/* Members grid - fixed to prevent horizontal scrolling */}
                  <div className="w-full h-full overflow-hidden">
                    <div 
                      className="grid gap-x-4 gap-y-16 h-full overflow-y-auto pr-2 custom-scrollbar"
                      style={{
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gridAutoRows: '250px'
                      }}
                    >
                      {faction.members.slice(0, currentPage * ITEMS_PER_PAGE).map((member, index) => {
                        const profile = memberProfiles[member.id];
                        const monster = memberMonsters[member.id];
                        const isProfileLoading = profileLoadingStates[member.id] === true;
                        const isMonsterLoading = monsterLoadingStates[member.id] === true;
                        const hasAnyData = profile || monster !== undefined;
                        
                        // Show loading only if no data is available yet
                        if (!hasAnyData && (isProfileLoading || isMonsterLoading)) {
                          return (
                            <div 
                              key={`${member.id}-${index}`}
                              className="relative bg-gray-800/30 border border-gray-600/30 rounded-xl p-2 h-full flex items-center justify-center group hover:bg-gray-700/30 transition-all duration-300"
                            >
                              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-xl"></div>
                              <div className="relative z-10 text-center">
                                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                                <div className="text-xs opacity-60">Loading...</div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={`${member.id}-${index}`} className="relative group">
                            <div className="relative overflow-hidden rounded-xl border-2 border-purple-500/30 bg-gradient-to-br from-purple-500/10 to-pink-500/10 hover:from-purple-500/20 hover:to-pink-500/20 transition-all duration-300 hover:scale-105 hover:shadow-xl">
                              <ProfileCard
                                profile={{
                                  ProfileImage: profile?.Profile?.ProfileImage,
                                  UserName: profile?.Profile?.UserName || (isProfileLoading ? 'Loading...' : 'Unknown'),
                                  DisplayName: profile?.Profile?.DisplayName || (isProfileLoading ? 'Loading...' : 'Unknown'),
                                  Description: profile?.Profile?.Description || ''
                                }}
                                address={member.id}
                                onClick={() => setSelectedMember({
                                  ...member,
                                  profile,
                                  monster
                                })}
                                assets={profile?.Assets}
                                monster={monster}
                              />
                              
                              
                              {/* Loading indicators for partial data */}
                              {(isProfileLoading || isMonsterLoading) && (
                                <div className="absolute top-2 right-2 flex gap-1">
                                  {isProfileLoading && (
                                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin bg-black/50 p-1" 
                                         title="Loading profile..."></div>
                                  )}
                                  {isMonsterLoading && (
                                    <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin bg-black/50 p-1" 
                                         title="Loading monster..."></div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  
                  {/* Load more button */}
                  {hasMore && (
                    <div className="flex justify-center pt-2 flex-shrink-0">
                      <button
                        onClick={loadMoreMembers}
                        disabled={isLoadingMore}
                        className={`px-6 py-2 rounded-xl font-bold transition-all duration-300 hover:scale-105 ${theme.buttonBg} ${theme.buttonHover} disabled:opacity-50 shadow-lg hover:shadow-xl border-2 border-purple-500/50 bg-gradient-to-r from-purple-600/20 to-pink-600/20 flex items-center gap-2 text-sm`}
                      >
                        {isLoadingMore ? (
                          <>
                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Loading...
                          </>
                        ) : (
                          <>
                            ⚔️ Load More ⚔️
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {selectedMember && (
        <ProfileDetail
          profile={{
            ProfileImage: selectedMember.profile?.Profile?.ProfileImage || '',
            UserName: selectedMember.profile?.Profile?.UserName || 'Unknown',
            DisplayName: selectedMember.profile?.Profile?.DisplayName || 'Unknown',
            Description: selectedMember.profile?.Profile?.Description || '',
            CoverImage: selectedMember.profile?.Profile?.CoverImage,
            DateCreated: selectedMember.profile?.Profile?.DateCreated,
            DateUpdated: selectedMember.profile?.Profile?.DateUpdated
          }}
          address={selectedMember.id}
          assets={selectedMember.profile?.Assets}
          onClose={() => setSelectedMember(null)}
        />
      )}

    </div>
  );
};
