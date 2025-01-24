import React, { useEffect, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getAssetBalances, AssetBalance } from '../utils/aoHelpers';
import { currentTheme } from '../constants/theme';
import { Gateway } from '../constants/Constants';

const Inventory: React.FC = () => {
  const { wallet, darkMode } = useWallet();
  const [assetBalances, setAssetBalances] = useState<AssetBalance[]>([]);
  const theme = currentTheme(darkMode);

  useEffect(() => {
    if (wallet?.address) {
      loadAssetBalances();
    }
  }, [wallet?.address]);

  const loadAssetBalances = async () => {
    try {
      const balances = await getAssetBalances(wallet);
      console.log('Current asset balances:', balances);
      setAssetBalances(balances);
    } catch (error) {
      console.error('Error loading asset balances:', error);
    }
  };

  if (!wallet?.address) return null;

  return (
    <div className={`fixed right-4 top-32 w-64 p-4 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
      <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>Inventory</h2>
      <div className="space-y-3">
        {assetBalances.map((asset) => (
          <div key={asset.info.processId} className={`flex justify-between items-center ${theme.text}`}>
            <div className="flex items-center gap-2">
              <img 
                src={`${Gateway}${asset.info.logo}`}
                alt={asset.info.name}
                className="w-6 h-6 object-cover rounded-full"
              />
              <span>{asset.info.ticker}:</span>
            </div>
            <span className="font-bold">{asset.balance}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Inventory;
