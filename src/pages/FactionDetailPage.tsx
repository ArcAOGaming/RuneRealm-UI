import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import { getFactionOptions, FactionOptions } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { Gateway, ACTIVITY_POINTS } from '../constants/Constants';
import Header from '../components/Header';
import LoadingAnimation from '../components/LoadingAnimation';
import Footer from '../components/Footer';

export const FactionDetailPage: React.FC = () => {
  const { factionId } = useParams();
  const navigate = useNavigate();
  const { darkMode, setDarkMode } = useWallet();
  const [faction, setFaction] = useState<FactionOptions | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
        
        setFaction(foundFaction);
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
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center mb-6">
            <button 
              onClick={() => navigate('/factions')}
              className={`mr-4 px-4 py-2 rounded-lg ${theme.buttonBg} ${theme.buttonHover}`}
            >
              ← Back
            </button>
            <h1 className="text-3xl font-bold">{faction.name}</h1>
          </div>

          <div className={`grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
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

            <div className="space-y-6">
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
                      {faction.averageLevel ? Math.round(faction.averageLevel * 10) / 10 : 0}
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

              <div className={`p-6 rounded-lg ${theme.container} bg-opacity-50`}>
                <h2 className="text-2xl font-bold mb-4">Members</h2>
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full">
                    <thead className={`sticky top-0 ${theme.container}`}>
                      <tr>
                        <th className="text-left py-2">ID</th>
                        <th className="text-right py-2">Level</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {faction.members.map((member, index) => (
                        <tr key={index}>
                          <td className="py-2">{member.id}</td>
                          <td className="text-right py-2">{member.level}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer darkMode={darkMode} />
    </div>
  );
};
