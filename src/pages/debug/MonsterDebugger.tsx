import React, { useState } from 'react';
import { useMonster } from '../../contexts/MonsterContext';
import { currentTheme } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import { getUserInfo } from '../../utils/aoHelpers';
import { UserInfo } from '../../utils/interefaces';
import { MonsterCardDisplay } from '../../components/MonsterCardDisplay';

const MonsterDebugger: React.FC = () => {
  // Don't automatically load monster context data - make it search-only
  const { darkMode } = useWallet();
  const theme = currentTheme(darkMode);
  
  // Wallet search functionality
  const [walletAddress, setWalletAddress] = useState('');
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  
  const handleSearch = async () => {
    if (!walletAddress) return;
    
    setIsSearching(true);
    setSearchError(null);
    try {
      const info = await getUserInfo(walletAddress);
      setUserInfo(info);
    } catch (error) {
      console.error('Error fetching user info:', error);
      setSearchError('Failed to fetch user information. Please check the wallet address.');
      setUserInfo(null);
    } finally {
      setIsSearching(false);
    }
  };
  
  const clearSearch = () => {
    setWalletAddress('');
    setUserInfo(null);
    setSearchError(null);
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  const renderObjectFields = (obj: any, title: string) => {
    if (!obj) {
      return (
        <div className={`${theme.container} border ${theme.border} rounded-lg p-4 mb-4`}>
          <h3 className={`text-lg font-semibold ${theme.text} mb-2`}>{title}</h3>
          <p className={`${theme.text} opacity-60`}>No data available</p>
        </div>
      );
    }

    return (
      <div className={`${theme.container} border ${theme.border} rounded-lg p-4 mb-4`}>
        <h3 className={`text-lg font-semibold ${theme.text} mb-3`}>{title}</h3>
        <div className="space-y-2">
          {Object.entries(obj).map(([key, value]) => (
            <div key={key} className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className={`font-medium ${theme.primary}`}>
                {key}:
              </div>
              <div className={`md:col-span-2 ${theme.text} font-mono text-sm break-all`}>
                {formatValue(value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className={theme.text}>
        <h2 className="text-2xl font-bold mb-4">Monster Object Debugger</h2>
        <p className="opacity-80 mb-6">
          Search for any user by wallet address to view their monster data and debug the structure.
          Enter a wallet address below to get started.
        </p>
      </div>

      {/* Wallet Search Section */}
      <div className={`${theme.container} border ${theme.border} rounded-lg p-4 mb-6`}>
        <h3 className={`text-lg font-semibold ${theme.text} mb-3`}>Search User by Wallet</h3>
        <div className="flex gap-4 mb-4">
          <input
            type="text"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="Enter wallet address"
            className={`flex-1 px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
          />
          <button
            onClick={handleSearch}
            disabled={isSearching || !walletAddress}
            className={`px-6 py-2 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} ${(isSearching || !walletAddress) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
          {(userInfo || searchError) && (
            <button
              onClick={clearSearch}
              className={`px-4 py-2 rounded-lg font-medium transition-all duration-300 bg-red-600 hover:bg-red-700 text-white`}
            >
              Clear
            </button>
          )}
        </div>
        
        {searchError && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {searchError}
          </div>
        )}
      </div>

      {/* Searched User Information */}
      {userInfo && (
        <div className={`${theme.container} border ${theme.border} rounded-lg p-4 mb-6`}>
          <h3 className={`text-lg font-semibold ${theme.text} mb-4`}>Searched User Information</h3>
          
          {/* Account Status */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h4 className={`text-md font-semibold ${theme.text} mb-2`}>Account Status</h4>
              <div className={`space-y-1 text-sm ${theme.text}`}>
                <p>Wallet: {walletAddress}</p>
                <p>Eternal Pass: {userInfo.isUnlocked ? 'Yes' : 'No'}</p>
                <p>Faction: {userInfo.faction || 'None'}</p>
                <p>Custom Skin: {userInfo.skin ? 'Yes' : 'No'}</p>
                <p>Has Monster: {userInfo.monster ? 'Yes' : 'No'}</p>
              </div>
            </div>
            
            {/* Monster Card Display */}
            {userInfo.monster && (
              <div>
                <h4 className={`text-md font-semibold ${theme.text} mb-2`}>Monster Card</h4>
                <div className="flex justify-center">
                  <MonsterCardDisplay 
                    monster={userInfo.monster}
                    darkMode={darkMode}
                    className="max-w-sm"
                  />
                </div>
              </div>
            )}
          </div>
          
          {/* Searched User Monster Object */}
          {userInfo.monster && renderObjectFields(userInfo.monster, `Searched User's Monster Object (${walletAddress})`)}
        </div>
      )}

      {/* Instructions when no search performed */}
      {!userInfo && !searchError && (
        <div className={`${theme.container} border ${theme.border} rounded-lg p-8 text-center`}>
          <div className={`text-6xl mb-4 opacity-40`}>🔍</div>
          <h3 className={`text-xl font-semibold ${theme.text} mb-2`}>Ready to Search</h3>
          <p className={`${theme.text} opacity-60`}>
            Enter a wallet address above to view that user's monster data and debug information.
          </p>
        </div>
      )}
    </div>
  );
};

export default MonsterDebugger;
