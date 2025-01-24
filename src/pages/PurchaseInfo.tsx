import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { purchaseAccess, TokenOption } from '../utils/aoHelpers';
import { useWallet } from '../hooks/useWallet';
import { currentTheme } from '../constants/theme';
import accessTicketImg from '../assets/access-ticket.png';
import PurchaseModal from '../components/PurchaseModal';
import Confetti from 'react-confetti';
import Header from '../components/Header';
import Inventory from '../components/Inventory';

const PurchaseInfo: React.FC = () => {
  const { wallet, walletStatus, darkMode, connectWallet, setDarkMode } = useWallet();
  const theme = currentTheme(darkMode);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // Initial load of wallet status
  useEffect(() => {
    if (wallet?.address) {
      connectWallet(true); // Force check on initial load
    }
  }, []);

  // Regular updates without forcing
  useEffect(() => {
    if (wallet?.address) {
      connectWallet(); // Use cached status for updates
    }
  }, [wallet?.address]);

  const handlePurchase = async (selectedToken: TokenOption) => {
    try {
      await purchaseAccess(selectedToken);
      setShowConfetti(true);
      setShowPurchaseModal(false);
      setTimeout(() => {
        setShowConfetti(false);
        connectWallet(true); // Force check after purchase
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
        showBackButton={false}
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
        {/* Main Content */}
        <div className={`max-w-4xl mx-auto ${theme.container} rounded-2xl shadow-2xl p-6 border ${theme.border}`}>
          <div className="text-center mb-8">
            <img 
              src={accessTicketImg} 
              alt="Eternal Pass Ticket" 
              className="w-32 h-32 mx-auto mb-4"
            />
            <h1 className={`text-4xl font-bold mb-4 ${theme.text}`}>Rune Realm Eternal Pass</h1>
            <p className={`text-xl ${theme.text} opacity-90 max-w-2xl mx-auto`}>
              Begin your journey as a legendary monster hunter in Rune Realm. Customize your character's appearance,
              join elite factions, and earn exclusive rewards in this epic adventure.
            </p>
            <p className={`mt-4 text-lg ${theme.text} opacity-80 max-w-2xl mx-auto`}>
              Your character's appearance can be customized at any time, making your presence in Rune Realm truly unique.
            </p>
          </div>

          {/* Purchase Section */}
          <div className="mt-8">
            {wallet?.address ? (
              <>
                {!walletStatus?.isUnlocked && (
                  <div className="flex justify-center mt-8">
                    <button
                      onClick={() => setShowPurchaseModal(true)}
                      className="relative px-8 py-4 text-xl font-bold rounded-lg transform hover:scale-105 transition-all duration-300 overflow-hidden"
                      style={{
                        backgroundColor: '#1a1a1a',
                        color: '#FFD700',
                        border: '2px solid #FFD700',
                        boxShadow: '0 0 20px #FFD700, 0 0 35px #FFD700, inset 0 0 5px rgba(255, 215, 0, 0.3)',
                        animation: 'pulseGold 2s infinite',
                      }}
                    >
                      <div
                        className="absolute inset-0 opacity-20"
                        style={{
                          background: 'linear-gradient(45deg, transparent, #FFD700, transparent)',
                          backgroundSize: '200% 200%',
                          animation: 'shimmerGold 3s linear infinite'
                        }}
                      />
                      <div className="relative z-10 flex items-center gap-2">
                        <span className="animate-pulse text-2xl" style={{ color: '#FFC800' }}>✨</span>
                        <span className="tracking-wider" style={{ textShadow: '0 0 5px rgba(255, 215, 0, 0.5)' }}>Unlock Access Now</span>
                        <span className="animate-pulse text-2xl" style={{ color: '#FFC800' }}>✨</span>
                      </div>
                      <div
                        className="absolute inset-0 rounded-lg"
                        style={{
                          border: '1px solid rgba(255, 215, 0, 0.2)',
                          animation: 'borderPulse 2s infinite',
                        }}
                      />
                      <style>
                        {`
                          @keyframes shimmerGold {
                            0% { background-position: -200% 0; }
                            100% { background-position: 200% 0; }
                          }
                          @keyframes pulseGold {
                            0%, 100% { box-shadow: 0 0 20px #FFD700, 0 0 35px #FFD700, inset 0 0 5px rgba(255, 215, 0, 0.3); }
                            50% { box-shadow: 0 0 30px #FFD700, 0 0 45px #FFD700, inset 0 0 5px rgba(255, 215, 0, 0.4); }
                          }
                          @keyframes borderPulse {
                            0%, 100% { opacity: 0.2; transform: scale(1); }
                            50% { opacity: 0.4; transform: scale(1.02); }
                          }
                          button:hover {
                            box-shadow: 0 0 35px #FFD700, 0 0 50px #FFD700, inset 0 0 5px rgba(255, 215, 0, 0.5);
                          }
                        `}
                      </style>
                    </button>
                  </div>
                )}
                {showPurchaseModal && (
                  <PurchaseModal
                    isOpen={showPurchaseModal}
                    onClose={() => setShowPurchaseModal(false)}
                    onPurchase={handlePurchase}
                    contractName="Eternal Pass"
                  />
                )}
                <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
                  <Link
                    to="/customize"
                    className={`px-6 py-3 rounded-xl text-lg font-medium transition-all duration-300 transform hover:scale-105
                      ${theme.buttonBg} ${theme.buttonHover} ${theme.text} 
                      backdrop-blur-md shadow-lg hover:shadow-xl border ${theme.border}`}
                  >
                    {walletStatus?.isUnlocked ? 'Set Up Your Sprite' : 'View Sprite Creator'}
                  </Link>
                  <Link
                    to="/factions"
                    className={`px-6 py-3 rounded-xl text-lg font-medium transition-all duration-300 transform hover:scale-105
                      ${theme.buttonBg} ${theme.buttonHover} ${theme.text} 
                      backdrop-blur-md shadow-lg hover:shadow-xl border ${theme.border}`}
                  >
                    {walletStatus?.isUnlocked ? 'Choose Your Faction' : 'View Factions'}
                  </Link>
                  <Link
                    to="/monsters"
                    className={`px-6 py-3 rounded-xl text-lg font-medium transition-all duration-300 transform hover:scale-105
                      ${theme.buttonBg} ${theme.buttonHover} ${theme.text} 
                      backdrop-blur-md shadow-lg hover:shadow-xl border ${theme.border}`}
                  >
                    {walletStatus?.isUnlocked ? 'Manage Your Monster' : 'View Monsters'}
                  </Link>
                  <Link
                    to="/daily-checkin"
                    className={`px-6 py-3 rounded-xl text-lg font-medium transition-all duration-300 transform hover:scale-105
                      ${theme.buttonBg} ${theme.buttonHover} ${theme.text} 
                      backdrop-blur-md shadow-lg hover:shadow-xl border ${theme.border}`}
                  >
                    Daily Check-in
                  </Link>
                </div>
                {walletStatus?.isUnlocked && (
                  <div className="mt-8">
                    <Inventory />
                  </div>
                )}
              </>
            ) : (
              <div className={`text-center ${theme.text} opacity-80`}>
                Please connect your wallet to continue
              </div>
            )}
          </div>

          {/* Benefits Section */}
          <div className="mt-16">
            <h2 className={`text-2xl font-bold mb-6 text-center ${theme.text}`}>Premium Benefits</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <BenefitCard
                title="Monster Hunting"
                description="Join elite monster hunting expeditions"
                icon="🗡️"
                theme={theme}
              />
              <BenefitCard
                title="Join Factions"
                description="Align with powerful factions and unlock their secrets"
                icon="⚔️"
                theme={theme}
              />
              <BenefitCard
                title="Daily Rewards"
                description="Complete daily tasks for exclusive rewards"
                icon="🎁"
                theme={theme}
              />
              <BenefitCard
                title="Character Customization"
                description="Create and modify your unique character anytime"
                icon="🎨"
                theme={theme}
              />
              <BenefitCard
                title="Exclusive Access"
                description="Get early access to new features and events"
                icon="🔑"
                theme={theme}
              />
              <BenefitCard
                title="Premium Items"
                description="Access to premium items and equipment"
                icon="💎"
                theme={theme}
              />
              <BenefitCard
                title="Community Events"
                description="Participate in exclusive community events"
                icon="🎉"
                theme={theme}
              />
              <BenefitCard
                title="Future Updates"
                description="Access to all future expansions"
                icon="🚀"
                theme={theme}
              />
            </div>
          </div>

          {/* FAQ Section */}
          <div className="mt-16">
            <h2 className={`text-2xl font-bold mb-6 text-center ${theme.text}`}>FAQ</h2>
            <div className="space-y-4">
              <FAQItem
                question="What is the Eternal Pass?"
                answer="The Eternal Pass is your premium access to Rune Realm, unlocking exclusive features like faction membership, daily rewards, character customization, and much more. It's a one-time purchase for lifetime access."
                theme={theme}
              />
              <FAQItem
                question="Can I change my character's appearance later?"
                answer="Yes! You can customize your character's appearance at any time. Your Eternal Pass gives you unlimited access to the character customization feature."
                theme={theme}
              />
              <FAQItem
                question="What are factions?"
                answer="Factions are elite monster hunting groups in Rune Realm. Each has unique benefits, quests, and rewards. With the Eternal Pass, you can join these exclusive factions and participate in their activities."
                theme={theme}
              />
              <FAQItem
                question="How do I get started?"
                answer="Simply connect your Arweave wallet and purchase the Eternal Pass. Once purchased, you'll have immediate access to all premium features including character customization and faction membership."
                theme={theme}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface BenefitCardProps {
  title: string;
  description: string;
  icon: string;
  theme: any;
}

const BenefitCard: React.FC<BenefitCardProps> = ({ title, description, icon, theme }) => (
  <div className={`p-4 rounded-xl bg-[#814E33]/20 border border-[#F4860A]/30 hover:bg-[#814E33]/30 transition-all duration-300`}>
    <div className="flex flex-col items-center text-center">
      <div className="text-2xl mb-2">{icon}</div>
      <h3 className={`text-sm font-bold mb-1 ${theme.text}`}>{title}</h3>
      <p className={`text-xs ${theme.text} opacity-80`}>{description}</p>
    </div>
  </div>
);

interface FAQItemProps {
  question: string;
  answer: string;
  theme: any;
}

const FAQItem: React.FC<FAQItemProps> = ({ question, answer, theme }) => (
  <div className={`p-4 rounded-xl bg-[#814E33]/20 border border-[#F4860A]/30`}>
    <h3 className={`text-lg font-bold mb-2 ${theme.text}`}>{question}</h3>
    <p className={`${theme.text} opacity-80`}>{answer}</p>
  </div>
);

export default PurchaseInfo;
