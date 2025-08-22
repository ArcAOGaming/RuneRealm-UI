import React, { useState } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { currentTheme } from '../../constants/theme';
import Header from '../../components/ui/Header';
import CacheViewer from './CacheViewer';
import SpriteDebugger from './SpriteDebugger';
import MonsterDebugger from './MonsterDebugger';
import LootboxDebugger from './LootboxDebugger';
import DryRunDebugger from './DryRunDebugger';

type DebugSection = 'cache' | 'sprites' | 'monster' | 'lootboxes' | 'dryruns';

interface DebugSectionInfo {
  id: DebugSection;
  name: string;
  description: string;
  component: React.ComponentType;
}

const debugSections: DebugSectionInfo[] = [
  {
    id: 'cache',
    name: 'Cache',
    description: 'View and manage all local storage cache entries with expandable viewer',
    component: CacheViewer,
  },
  {
    id: 'sprites',
    name: 'Sprites',
    description: 'Interactive monster sprite testing and debugging',
    component: SpriteDebugger,
  },
  {
    id: 'monster',
    name: 'Monster',
    description: 'Display monster object and all its fields from MonsterContext',
    component: MonsterDebugger,
  },
  {
    id: 'lootboxes',
    name: 'Lootboxes',
    description: 'Lootbox debugging tools (coming soon)',
    component: LootboxDebugger,
  },
  {
    id: 'dryruns',
    name: 'Dry Runs',
    description: 'Dry run testing utilities (coming soon)',
    component: DryRunDebugger,
  },
];

const DebugPage: React.FC = () => {
  const { darkMode, setDarkMode } = useWallet();
  const [activeSection, setActiveSection] = useState<DebugSection>('cache');
  const theme = currentTheme(darkMode);

  const ActiveComponent = debugSections.find(section => section.id === activeSection)?.component || CacheViewer;

  return (
    <div className={`min-h-screen ${theme.bg}`}>
      <Header 
        theme={theme} 
        darkMode={darkMode} 
        onDarkModeToggle={() => setDarkMode(!darkMode)}
      />
      
      <div className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className={`text-4xl font-bold ${theme.text} mb-2`}>Debug Console</h1>
          <p className={`${theme.text} opacity-70`}>Development tools and debugging utilities</p>
        </div>

        {/* Mode Toggle */}
        <div className="mb-6">
          <div className={`${theme.container} border ${theme.border} rounded-lg p-4`}>
            <h2 className={`text-lg font-semibold ${theme.text} mb-3`}>Debug Mode</h2>
            <div className="flex flex-wrap gap-2">
              {debugSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`px-4 py-2 rounded-md font-medium transition-all duration-200 ${
                    activeSection === section.id
                      ? `bg-${theme.primary.replace('text-', '').replace('[', '').replace(']', '')} text-white shadow-lg`
                      : `${theme.buttonBg} ${theme.text} opacity-70 ${theme.buttonHover}`
                  }`}
                >
                  {section.name}
                </button>
              ))}
            </div>
            
            {/* Section Description */}
            <div className={`mt-3 p-3 ${theme.buttonBg} rounded-lg`}>
              <p className={`${theme.text} opacity-70 text-sm`}>
                {debugSections.find(section => section.id === activeSection)?.description}
              </p>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className={`${theme.container} border ${theme.border} rounded-lg p-6`}>
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
};

export default DebugPage;
