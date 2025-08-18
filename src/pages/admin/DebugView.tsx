import React from 'react';
import { MonsterDebug } from '../../contexts/MonsterContext';
import { useWallet } from '../../contexts/WalletContext';

const DebugView: React.FC = () => {
  const { wallet, walletStatus, refreshTrigger } = useWallet();
  
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Debug View</h1>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Wallet Information</h2>
        <pre className="bg-gray-900 text-white p-3 rounded-lg overflow-auto">
          {JSON.stringify({
            address: wallet?.address,
            isConnected: !!wallet?.address,
            refreshTrigger,
            walletStatus: {
              isUnlocked: walletStatus?.isUnlocked,
              hasMonster: !!walletStatus?.monster,
              faction: walletStatus?.faction,
              error: walletStatus?.error
            }
          }, null, 2)}
        </pre>
      </div>
      
      <MonsterDebug />
      
      <div className="mt-4">
        <h2 className="text-xl font-semibold mb-2">User Instructions</h2>
        <div className="bg-blue-100 border-l-4 border-blue-500 text-blue-700 p-4 rounded">
          <p>This page displays the monster object and all its fields from the MonsterContext.</p>
          <p className="mt-2">Use this to debug and understand the structure of the monster data in your application.</p>
        </div>
      </div>
    </div>
  );
};

export default DebugView;
