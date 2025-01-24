import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { currentTheme } from '../constants/theme';
import Header from '../components/Header';
import PurchaseModal from '../components/PurchaseModal';
import { purchaseAccess, TokenOption } from '../utils/aoHelpers';
import Confetti from 'react-confetti';

const DailyCheckin: React.FC = () => {
  const { wallet, walletStatus, darkMode, connectWallet, setDarkMode } = useWallet();
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const theme = currentTheme(darkMode);

  const handlePurchase = async (selectedToken: TokenOption) => {
    try {
      await purchaseAccess(selectedToken);
      setShowConfetti(true);
      setShowPurchaseModal(false);
      setTimeout(() => {
        setShowConfetti(false);
        connectWallet(true);
      }, 5000);
    } catch (error) {
      console.error('Purchase failed:', error);
      throw error;
    }
  };

  return (
    <div className={`min-h-screen ${theme.bg} ${theme.text}`}>
      <Header
        theme={theme}
        darkMode={darkMode}
        onDarkModeToggle={() => setDarkMode(!darkMode)}
      />
      {showConfetti && (
        <Confetti
          width={window.innerWidth}
          height={window.innerHeight}
          recycle={false}
          numberOfPieces={500}
          gravity={0.3}
        />
      )}
      <div className="container mx-auto px-4 py-8">
        <div className={`max-w-4xl mx-auto ${theme.container} rounded-2xl shadow-2xl p-6 border ${theme.border}`}>
          <h1 className={`text-3xl font-bold mb-6 text-center ${theme.text}`}>Daily Check-in</h1>
          
          {!wallet?.address ? (
            <div className={`text-center ${theme.text} opacity-80`}>
              Please connect your wallet to continue
            </div>
          ) : !walletStatus?.isUnlocked ? (
            <div className="text-center">
              <p className={`mb-6 ${theme.text} opacity-80`}>
                Purchase the Eternal Pass to access daily check-in rewards
              </p>
              <button
                onClick={() => setShowPurchaseModal(true)}
                className="relative px-8 py-4 text-xl font-bold rounded-lg transform hover:scale-105 transition-all duration-300 overflow-hidden"
                style={{
                  backgroundColor: '#1a1a1a',
                  color: '#FFD700',
                  border: '2px solid #FFD700',
                  boxShadow: '0 0 20px #FFD700, 0 0 35px #FFD700, inset 0 0 5px rgba(255, 215, 0, 0.3)',
                }}
              >
                <span>Unlock Access Now</span>
              </button>
            </div>
          ) : (
            <div>
              {walletStatus?.faction ? (
                <div className={`p-4 rounded-xl ${theme.container} border ${theme.border} mb-8`}>
                  <h2 className={`text-2xl font-bold mb-4 ${theme.text}`}>Your Faction: {walletStatus.faction}</h2>
                  {/* Daily rewards content will go here */}
                  <div className={`text-center ${theme.text} opacity-80`}>
                    Daily check-in rewards coming soon!
                  </div>
                </div>
              ) : (
                <div className={`text-center ${theme.text} opacity-80`}>
                  Please join a faction to access daily check-in rewards
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {showPurchaseModal && (
        <PurchaseModal
          isOpen={showPurchaseModal}
          onClose={() => setShowPurchaseModal(false)}
          onPurchase={handlePurchase}
          contractName="Eternal Pass"
        />
      )}
    </div>
  );
};

export default DailyCheckin;
