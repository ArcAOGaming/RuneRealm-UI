import React, { useState } from 'react';
import { currentTheme } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';

const AdminRemoveUser: React.FC = () => {
  const { darkMode } = useWallet();
  const [address, setAddress] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const theme = currentTheme(darkMode);

  const handleRemoveUser = async () => {
    if (!address.trim()) return;
    
    setIsProcessing(true);
    try {
      // TODO: Implement user removal logic
      console.log('Processing user removal for:', address);
    } catch (error) {
      console.error('Error removing user:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={`p-4 rounded-lg ${theme.container} border ${theme.border}`}>
      <h3 className={`text-lg font-bold mb-4 ${theme.text}`}>Remove User</h3>
      <div className="flex gap-4">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter wallet address"
          className={`flex-1 px-4 py-2 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
        />
        <button
          onClick={handleRemoveUser}
          disabled={isProcessing || !address.trim()}
          className={`px-6 py-2 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} ${(isProcessing || !address.trim()) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isProcessing ? 'Processing...' : 'Remove User'}
        </button>
      </div>
    </div>
  );
};

export default AdminRemoveUser;
