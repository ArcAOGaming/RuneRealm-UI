import React from 'react';
import { currentTheme } from '../../constants/theme';
import { useWallet } from '../../contexts/WalletContext';

const DryRunDebugger: React.FC = () => {
  const { darkMode } = useWallet();
  const theme = currentTheme(darkMode);

  return (
    <div className="space-y-6">
      <div className={theme.text}>
        <h2 className="text-2xl font-bold mb-4">Dry Run Debugger</h2>
        <p className="opacity-80 mb-6">
          Dry run testing utilities for simulating game actions without affecting real data.
          This section will contain tools for testing game mechanics in a safe environment.
        </p>
      </div>

      {/* Coming Soon Card */}
      <div className={`${theme.container} border ${theme.border} rounded-lg p-8 text-center`}>
        <div className={`text-6xl mb-4 opacity-40`}>🧪</div>
        <h3 className={`text-xl font-semibold ${theme.text} mb-2`}>Coming Soon</h3>
        <p className={`${theme.text} opacity-60 mb-4`}>
          Dry run testing utilities are currently under development.
        </p>
        <div className={`${theme.text} opacity-40 text-sm`}>
          Future features will include:
          <ul className="mt-2 space-y-1">
            <li>• Battle simulation without consequences</li>
            <li>• Monster stat modification testing</li>
            <li>• Activity outcome prediction</li>
            <li>• Transaction simulation</li>
            <li>• State rollback capabilities</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default DryRunDebugger;
