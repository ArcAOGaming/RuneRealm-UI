import React, { useState } from 'react';
import { currentTheme } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';
import { bulkImportAddresses } from '../utils/aoHelpers';

const AdminBulkUnlock: React.FC = () => {
  const { darkMode, triggerRefresh } = useWallet();
  const [addresses, setAddresses] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const theme = currentTheme(darkMode);

  const [result, setResult] = useState<{ successful: number; failed: number } | null>(null);

  const handleBulkUnlock = async () => {
    setIsProcessing(true);
    setResult(null);
    try {
      const addressList = addresses.split('\n').map(addr => addr.trim()).filter(Boolean);
      const response = await bulkImportAddresses({
        function: "BulkImportAddresses",
        addresses: addressList
      }, triggerRefresh);
      setResult(response);
      if (response.successful > 0) {
        setAddresses(''); // Clear the textarea on success
      }
    } catch (error) {
      console.error('Error processing bulk unlock:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={`p-4 rounded-lg ${theme.container} border ${theme.border}`}>
      <h3 className={`text-lg font-bold mb-4 ${theme.text}`}>Bulk Unlock Access</h3>
      <textarea
        value={addresses}
        onChange={(e) => setAddresses(e.target.value)}
        placeholder="Enter wallet addresses (one per line)"
        className={`w-full h-32 px-4 py-2 mb-4 rounded-lg border ${theme.border} ${theme.container} ${theme.text}`}
      />
      {result && (
        <div className={`mb-4 ${theme.text}`}>
          <p>Successfully unlocked: {result.successful}</p>
          <p>Failed to unlock: {result.failed}</p>
        </div>
      )}
      <button
        onClick={handleBulkUnlock}
        disabled={isProcessing || !addresses.trim()}
        className={`px-6 py-2 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} ${(isProcessing || !addresses.trim()) ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isProcessing ? 'Processing...' : 'Process Bulk Unlock'}
      </button>
    </div>
  );
};

export default AdminBulkUnlock;
