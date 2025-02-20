import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import { getFactionOptions, FactionOptions, ProfileInfo, getProfileInfo, getUserMonster, MonsterStats } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { Gateway } from '../constants/Constants';
import Header from '../components/Header';
import LoadingAnimation from '../components/LoadingAnimation';
import Footer from '../components/Footer';
import { ProfileCard } from '../components/ProfileCard';
import { ProfileDetail } from '../components/ProfileDetail';

interface FactionMember {
  id: string;
  level: number;
}

interface MemberWithProfile extends FactionMember {
  profile: ProfileInfo | null;
  monster: MonsterStats | null;
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
  const { darkMode, setDarkMode } = useWallet();
  const [faction, setFaction] = useState<FactionWithProfiles | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<MemberWithProfile | null>(null);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, ProfileInfo>>({});
  const [memberMonsters, setMemberMonsters] = useState<Record<string, MonsterStats | null>>({});
  const theme = currentTheme(darkMode);

  const factionMap = {
    'air': 'Sky Nomads',
    'water': 'Aqua Guardians',
    'fire': 'Inferno Blades',
    'rock': 'Stone Titans'
  };

  useEffect(() => {
    const loadFactionData = async () => {
      try {
        const factions = await getFactionOptions();
        const factionName = factionMap[factionId as keyof typeof factionMap];
        const foundFaction = factions.find(f => f.name === factionName);
        
        if (!foundFaction) {
          navigate('/factions');
          return;
        }

        // Set initial faction data with type conversion
        const typedFaction: FactionWithProfiles = {
          name: foundFaction.name,
          description: foundFaction.description,
          mascot: foundFaction.mascot,
          perks: foundFaction.perks,
          members: foundFaction.members,
          averageLevel: foundFaction.averageLevel,
          memberCount: Number(foundFaction.memberCount),
          monsterCount: Number(foundFaction.monsterCount),
          totalTimesFed: Number(foundFaction.totalTimesFed),
          totalTimesPlay: Number(foundFaction.totalTimesPlay),
          totalTimesMission: Number(foundFaction.totalTimesMission)
        };
        setFaction(typedFaction);
        setIsLoading(false);

        // Load profiles and monsters one by one
        for (const member of foundFaction.members) {
          try {
            // Load profile with caching
            console.log(`[FactionDetailPage] Fetching profile for member: ${member.id}`);
            const profile = await getProfileInfo(member.id, true); // Enable caching
            console.log(`[FactionDetailPage] Profile received for ${member.id}:`, profile);
            
            if (profile && !Array.isArray(profile)) {
              setMemberProfiles(prev => ({
                ...prev,
                [member.id]: profile
              }));
            }

            // Load monster with caching
            console.log(`[FactionDetailPage] Fetching monster for member: ${member.id}`);
            const monster = await getUserMonster({ address: member.id }, true); // Enable caching
            console.log(`[FactionDetailPage] Monster received for ${member.id}:`, monster);
            
            setMemberMonsters(prev => ({
              ...prev,
              [member.id]: monster
            }));
          } catch (error) {
            console.error(`[FactionDetailPage] Error loading data for ${member.id}:`, error);
          }
        }
      } catch (error) {
        console.error('Error loading faction data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadFactionData();
  }, [factionId, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingAnimation />
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
        onDarkModeToggle={() => setDarkMode(!darkMode)}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 max-h-[600px] overflow-y-auto px-1">
                {faction.members.map((member, index) => {
                  const profile = memberProfiles[member.id];
                  const monster = memberMonsters[member.id];
                  return (
                    <ProfileCard
                      key={index}
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
