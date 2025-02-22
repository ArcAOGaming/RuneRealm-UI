import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { currentTheme } from '../constants/theme';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { adminReturnFromBattle } from '../utils/aoHelpers';

export const AdminPage: React.FC = () => {
  const { wallet, darkMode, setDarkMode } = useWallet();
  const [targetWallet, setTargetWallet] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const theme = currentTheme(darkMode);

  const handleReturnFromBattle = async () => {
    if (!targetWallet) {
      setMessage('Please enter a wallet address');
      return;
    }

    try {
      setIsLoading(true);
      setMessage('Processing...');
      
      const success = await adminReturnFromBattle(targetWallet);
      
      if (success) {
        setMessage('Successfully returned user from battle');
        setTargetWallet(''); // Clear input on success
      } else {
        setMessage('Failed to return user from battle');
      }
    } catch (error) {
      console.error('Error returning from battle:', error);
      setMessage(error instanceof Error ? error.message : 'Failed to return user from battle');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col ${theme.bg}`}>
      <Header
        theme={theme}
        darkMode={darkMode}
      />
      
      <div className={`container mx-auto px-6 py-8 flex-1 ${theme.text}`}>
        <div className="max-w-4xl mx-auto">
          <h1 className={`text-3xl font-bold mb-8 ${theme.text}`}>Admin Panel</h1>
          
          {/* Battle Management Section */}
          <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md mb-8`}>
            <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>Battle Management</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Return User from Battle
                </label>
                <div className="flex gap-4">
                  <input
                    type="text"
                    value={targetWallet}
                    onChange={(e) => setTargetWallet(e.target.value)}
                    placeholder="Enter wallet address"
                    className={`flex-1 px-4 py-2 rounded-lg bg-opacity-20 ${theme.container} border ${theme.border}`}
                    disabled={isLoading}
                  />
                  <button
                    onClick={handleReturnFromBattle}
                    disabled={isLoading}
                    className={`px-6 py-2 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} disabled:opacity-50`}
                  >
                    {isLoading ? 'Processing...' : 'Return from Battle'}
                  </button>
                </div>
                {message && (
                  <p className={`mt-2 text-sm ${message.includes('Success') ? 'text-green-500' : 'text-red-500'}`}>
                    {message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <Footer darkMode={darkMode} />
    </div>
  );
};

export default AdminPage;
