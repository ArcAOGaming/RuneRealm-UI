import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWallet } from '../../contexts/WalletContext';
import { getFactionOptions, FactionOptions, ProfileInfo, getProfileInfo, getUserMonster, MonsterStats } from '../../utils/aoHelpers';
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

export const FactionDetailPage: React.FC = () => {
  const { factionId } = useParams();
  const navigate = useNavigate();
  const { wallet, darkMode, setDarkMode, refreshTrigger } = useWallet();
  const [faction, setFaction] = useState<FactionWithProfiles | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<MemberWithProfile | null>(null);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, ProfileInfo>>({});
  const [memberMonsters, setMemberMonsters] = useState<Record<string, MonsterStats | null>>({});
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
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

    // Set loading states
    const newLoadingStates = { ...loadingStates };
    membersToLoad.forEach(member => {
      newLoadingStates[member.id] = true;
    });
    setLoadingStates(newLoadingStates);

    // Load each member's data individually and update as they come in
    membersToLoad.forEach(async (member) => {
      try {
        // Update loading state for this member
        setLoadingStates(prev => ({ ...prev, [member.id]: true }));

        // Load profile and monster in parallel
        const [profile, monster] = await Promise.all([
          getProfileInfo(member.id, true).catch(() => null),
          getUserMonster({ address: member.id }, true).catch(() => null)
        ]);

        // Update state with the loaded data
        if (profile) {
          setMemberProfiles(prev => ({
            ...prev,
            [member.id]: profile
          }));
        }

        setMemberMonsters(prev => ({
          ...prev,
          [member.id]: monster
        }));
      } catch (error) {
        console.error(`Error loading data for ${member.id}:`, error);
      } finally {
        // Clear loading state for this member
        setLoadingStates(prev => ({
          ...prev,
          [member.id]: false
        }));
      }
    });

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
        const factions = await getFactionOptions(wallet);
        
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
  }, [factionId, navigate, refreshTrigger]);

  // Load more members when currentPage changes
  useEffect(() => {
    if (currentPage > 1 && sortedMembers.length > 0) {
      loadMemberData(sortedMembers, currentPage);
    }
  }, [currentPage]);

  if (isLoading) {
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
    <div className={`min-h-screen flex flex-col ${theme.bg}`}>
      <Header
        theme={theme}
        darkMode={darkMode}
      />
      
      <div className={`container mx-auto px-6 py-8 flex-1 ${theme.text}`}>
        <div className="max-w-[1920px] mx-auto">
          <div className="flex items-center mb-6">
            <button 
              onClick={() => navigate('/factions')}
              className={`mr-4 px-4 py-2 rounded-lg ${theme.buttonBg} ${theme.buttonHover}`}
            >
              ← Back
            </button>
            <h1 className="text-3xl font-bold">{faction.name}</h1>
          </div>

          <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md space-y-8`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                {faction.mascot && (
                  <img
                    src={`${Gateway}${faction.mascot}`}
                    alt={`${faction.name} Mascot`}
                    className="w-full rounded-lg object-contain mb-4 max-h-[400px]"
                  />
                )}
                <div className="space-y-4">
                  <h2 className="text-2xl font-bold mb-2">Description</h2>
                  <p className="text-lg">{faction.description}</p>
                  <div>
                    <h3 className="text-xl font-bold mb-2">Perks</h3>
                    <ul className="space-y-2">
                      {faction.perks.map((perk, index) => (
                        <li key={index} className="flex items-start">
                          <span className="mr-2 text-blue-400">•</span>
                          <span>{perk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <div className={`p-6 rounded-lg ${theme.container} bg-opacity-50`}>
                <h2 className="text-2xl font-bold mb-4">Faction Statistics</h2>
                <div className="grid grid-cols-2 gap-y-4">
                  <div>
                    <div className="text-sm opacity-70">Members</div>
                    <div className="text-xl font-bold">{faction.memberCount}</div>
                  </div>
                  <div>
                    <div className="text-sm opacity-70">Monsters</div>
                    <div className="text-xl font-bold">{faction.monsterCount}</div>
                  </div>
                  <div>
                    <div className="text-sm opacity-70">Average Level</div>
                    <div className="text-xl font-bold">
                      {typeof faction.averageLevel === 'number' ? Math.round(faction.averageLevel * 10) / 10 : 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm opacity-70">Total Times Fed</div>
                    <div className="text-xl font-bold">{faction.totalTimesFed}</div>
                  </div>
                  <div>
                    <div className="text-sm opacity-70">Total Times Played</div>
                    <div className="text-xl font-bold">{faction.totalTimesPlay}</div>
                  </div>
                  <div>
                    <div className="text-sm opacity-70">Total Missions</div>
                    <div className="text-xl font-bold">{faction.totalTimesMission}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`p-6 rounded-lg ${theme.container} bg-opacity-50`}>
              <h2 className="text-2xl font-bold mb-4">Members</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 max-h-[600px] overflow-y-auto px-1">
                  {faction.members.slice(0, currentPage * ITEMS_PER_PAGE).map((member, index) => {
                    const profile = memberProfiles[member.id];
                    const monster = memberMonsters[member.id];
                    const isLoading = loadingStates[member.id] === true;
                    
                    if (isLoading) {
                      return (
                        <div 
                          key={`${member.id}-${index}`}
                          className="relative bg-gray-800 bg-opacity-50 rounded-lg p-4 h-48 flex items-center justify-center"
                        >
                          <div className="absolute inset-0 bg-black bg-opacity-50 rounded-lg flex items-center justify-center">
                            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <ProfileCard
                        key={`${member.id}-${index}`}
                        profile={{
                          ProfileImage: profile?.Profile?.ProfileImage,
                          UserName: profile?.Profile?.UserName || 'Unknown',
                          DisplayName: profile?.Profile?.DisplayName || 'Unknown',
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
                    );
                  })}
                </div>
                {hasMore && (
                  <div className="flex justify-center">
                    <button
                      onClick={loadMoreMembers}
                      disabled={isLoadingMore}
                      className={`px-6 py-2 rounded-lg ${theme.buttonBg} ${theme.buttonHover} disabled:opacity-50`}
                    >
                      {isLoadingMore ? 'Loading...' : 'Load More'}
                    </button>
                  </div>
                )}
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

      <Footer darkMode={darkMode} />
    </div>
  );
};
