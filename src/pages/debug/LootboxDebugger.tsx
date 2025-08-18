import React from 'react';
import { currentTheme } from '../../constants/theme';
import { useWallet } from '../../contexts/WalletContext';

const LootboxDebugger: React.FC = () => {
  const { darkMode } = useWallet();
  const theme = currentTheme(darkMode);

  return (
    <div className="space-y-6">
      <div className={theme.text}>
        <h2 className="text-2xl font-bold mb-4">Lootbox Debugger</h2>
        <p className="opacity-80 mb-6">
          Lootbox debugging tools and utilities. This section will contain tools for testing 
          lootbox mechanics, drop rates, and reward distributions.
        </p>
      </div>

      {/* Coming Soon Card */}
      <div className={`${theme.container} border ${theme.border} rounded-lg p-8 text-center`}>
        <div className={`text-6xl mb-4 opacity-40`}>📦</div>
        <h3 className={`text-xl font-semibold ${theme.text} mb-2`}>Coming Soon</h3>
        <p className={`${theme.text} opacity-60 mb-4`}>
          Lootbox debugging tools are currently under development.
        </p>
        <div className={`${theme.text} opacity-40 text-sm`}>
          Future features will include:
          <ul className="mt-2 space-y-1">
            <li>• Lootbox drop rate testing</li>
            <li>• Reward distribution analysis</li>
            <li>• Rarity probability debugging</li>
            <li>• Mock lootbox opening simulation</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default LootboxDebugger;
