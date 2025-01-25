import React from 'react';
import { useWallet } from '../hooks/useWallet';
import CheckInButton from '../components/CheckInButton';
import OfferingStats from '../components/OfferingStats';
import Confetti from 'react-confetti';
import { currentTheme } from '../constants/theme';
import Header from '../components/Header';
import Footer from '../components/Footer';
import PurchaseModal from '../components/PurchaseModal';
import { purchaseAccess, TokenOption } from '../utils/aoHelpers';

const DailyCheckin: React.FC = () => {
  const { walletStatus, darkMode, setDarkMode, connectWallet } = useWallet();
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = React.useState(false);
  const [showConfetti, setShowConfetti] = React.useState(false);
  const theme = currentTheme(darkMode);

  const handlePurchase = async (selectedToken: TokenOption) => {
    try {
      await purchaseAccess(selectedToken);
      setShowConfetti(true);
      setIsPurchaseModalOpen(false);
      setTimeout(() => {
        setShowConfetti(false);
        connectWallet();
      }, 5000);
    } catch (error) {
      console.error('Purchase failed:', error);
      throw error;
    }
  };

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        {showConfetti && (
          <Confetti
            width={window.innerWidth}
            height={window.innerHeight}
            recycle={false}
            numberOfPieces={500}
            gravity={0.3}
          />
        )}

        <Header
          theme={theme}
          darkMode={darkMode}
          onDarkModeToggle={() => setDarkMode(!darkMode)}
        />

        <PurchaseModal
          isOpen={isPurchaseModalOpen}
          onClose={() => setIsPurchaseModalOpen(false)}
          onPurchase={handlePurchase}
          contractName="Eternal Pass"
        />

        <div className={`container mx-auto px-6 py-8 flex-1 ${theme.text}`}>
          <div className="max-w-4xl mx-auto">
            <h1 className={`text-3xl font-bold mb-8 ${theme.text}`}>Daily Check-in</h1>

            {!walletStatus?.isUnlocked ? (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md text-center`}>
                <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>Unlock Access</h2>
                <p className={`mb-6 ${theme.text}`}>Purchase an Eternal Pass to access daily check-ins and rewards!</p>
                <button
                  onClick={() => setIsPurchaseModalOpen(true)}
                  className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                >
                  Purchase Access
                </button>
              </div>
            ) : !walletStatus?.faction ? (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md text-center`}>
                <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>Join a Faction First</h2>
                <p className={`mb-6 ${theme.text}`}>You need to join a faction before you can start daily check-ins!</p>
                <a
                  href="/faction"
                  className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                >
                  Choose Your Faction
                </a>
              </div>
            ) : (
              <div className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className={`text-2xl font-bold ${theme.text}`}>Your Faction</h2>
                    <p className={`text-xl mt-2 ${theme.text}`}>{walletStatus.faction}</p>
                  </div>
                </div>
              <div className="space-y-6">
                <div className={`p-4 rounded-lg ${theme.container} border ${theme.border}`}>
                  <h3 className={`text-lg font-bold mb-4 ${theme.text}`}>Daily Check-in</h3>
                  <div className="flex justify-center">
                    <CheckInButton />
                  </div>
                </div>
                <OfferingStats />
              </div>
              </div>
            )}
          </div>
        </div>
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};

export default DailyCheckin;
