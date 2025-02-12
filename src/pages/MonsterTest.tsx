import React, { useState } from 'react';
import MonsterSpriteView from '../components/MonsterSpriteView';
import { currentTheme } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';
import Header from '../components/Header';
import Footer from '../components/Footer';

const monsters = [
  '0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0',
  'p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc',
  'wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ',
  'Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks'
];

const animations = [
  'walkRight',
  'walkLeft',
  'walkUp',
  'walkDown',
  'attack1',
  'attack2'
] as const;

const MonsterTest: React.FC = () => {
  const { darkMode, setDarkMode } = useWallet();
  const theme = currentTheme(darkMode);
  const [currentAnimations, setCurrentAnimations] = useState<Record<string, typeof animations[number] | undefined>>({});

  const handleAnimationClick = (monsterId: string, animation: typeof animations[number]) => {
    setCurrentAnimations(prev => ({
      ...prev,
      [monsterId]: animation
    }));

    // Clear animation after 1 second
    setTimeout(() => {
      setCurrentAnimations(prev => ({
        ...prev,
        [monsterId]: undefined
      }));
    }, 1000);
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
          <h1 className="text-3xl font-bold mb-8">Monster Animation Test</h1>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {monsters.map((monsterId, index) => (
              <div key={monsterId} className={`p-6 rounded-xl ${theme.container} border ${theme.border}`}>
                <h2 className="text-xl font-bold mb-4">Monster {index + 1}</h2>
                
                <div className="flex justify-center mb-6">
                  <div className="relative">
                    <MonsterSpriteView
                      sprite={monsterId}
                      currentAnimation={currentAnimations[monsterId]}
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  {animations.map(animation => (
                    <button
                      key={animation}
                      onClick={() => handleAnimationClick(monsterId, animation)}
                      className={`px-4 py-2 rounded-lg font-medium transition-all duration-300 
                        ${theme.buttonBg} ${theme.buttonHover}
                        ${currentAnimations[monsterId] === animation ? 'ring-2 ring-blue-500' : ''}`}
                    >
                      {animation}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};

export default MonsterTest;
