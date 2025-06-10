import { useState, useEffect } from 'react';
import { useWallet } from '../hooks/useWallet';
import LayerSelector from '../components/LayerSelector';
import ExportAndUploadButton from '../services/upload';
import WalkingPreview from '../components/WalkingPreview';
import WarpTransition from '../components/WarpTransition';
import PurchaseModal from '../components/PurchaseModal';
import { currentTheme } from '../constants/theme';
import { SPRITE_CATEGORIES } from '../constants/Constants';
import { ArconnectSigner } from '@ardrive/turbo-sdk/web';
import { TokenOption, purchaseAccess } from '../utils/aoHelpers';
import Confetti from 'react-confetti';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { ArweaveWallet } from '../types/arweave';

interface LayerState {
  style: string;
  color: string;
}

interface Layers {
  [key: string]: LayerState;
}

interface SpriteCustomizerProps {
  onEnter?: () => void;
  darkMode?: boolean;
}

const SpriteCustomizer: React.FC<SpriteCustomizerProps> = ({ onEnter, darkMode: initialDarkMode }) => {
  const [layers, setLayers] = useState<Layers>({});
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [signer, setSigner] = useState<any>(null);
  const [currentSkin, setCurrentSkin] = useState(null);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const { wallet, walletStatus, connectWallet } = useWallet();
  const [darkMode, setDarkMode] = useState(initialDarkMode ?? false);
  
  // Update local darkMode state when the prop changes
  useEffect(() => {
    if (initialDarkMode !== undefined) {
      setDarkMode(initialDarkMode);
    }
  }, [initialDarkMode]);
  const [loading, setLoading] = useState(true);
  const [availableStyles, setAvailableStyles] = useState(SPRITE_CATEGORIES);
  const [contractIcon, setContractIcon] = useState<string | undefined>();
  const [contractName, setContractName] = useState<string | undefined>();
  const [showCelebration, setShowCelebration] = useState(false);
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [showWarp, setShowWarp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);

  const theme = currentTheme(darkMode);

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        
        if (wallet && walletStatus) {
          console.log('SpriteCustomizer: Wallet connected');
          setSigner(new ArconnectSigner(window.arweaveWallet));
          
          // Set contract info if available in walletStatus
          if (walletStatus.contractIcon) {
            setContractIcon(walletStatus.contractIcon);
          }
          if (walletStatus.contractName) {
            setContractName(walletStatus.contractName);
          }
          
          if (walletStatus.currentSkin) {
            console.log('SpriteCustomizer: Current skin found:', walletStatus.currentSkin);
            setCurrentSkin(walletStatus.currentSkin);
            
            if (walletStatus.currentSkin !== "none") {
              setShowPreview(true);
              setShowCustomizer(true);
              if (onEnter) {
                setShowWarp(true);
              }
            }
          }
        }
      } catch (error) {
        console.error('SpriteCustomizer: Error initializing wallet:', error);
      } finally {
        setLoading(false);
      }
    };

    const checkAccess = async () => {
      try {
        if (!wallet) {
          return false;
        }
        return walletStatus?.isUnlocked || false;
      } catch (error) {
        console.error('Error checking access:', error);
        return false;
      }
    };

    init();
    initializeLayers();
  }, [wallet, walletStatus, onEnter, wallet?.address]);

  const initializeLayers = () => {
    const initialLayers: Layers = {};
    availableStyles.forEach(category => {
      initialLayers[category.name] = {
        style: 'None',
        color: '#ffffff'
      };
    });
    setLayers(initialLayers);
    setLoading(false);
  };

  const handleStyleChange = (layerName: string, style: string) => {
    setLayers(prev => ({
      ...prev,
      [layerName]: { ...prev[layerName], style }
    }));
  };

  const handleColorChange = (layerName: string, color: string) => {
    setLayers(prev => ({
      ...prev,
      [layerName]: { ...prev[layerName], color }
    }));
  };

  const handleDarkModeToggle = () => {
    setDarkMode(!darkMode);
  };

  const handleReset = () => {
    initializeLayers();
  };

  const handleConnectWallet = async () => {
    try {
      if (!window.arweaveWallet) {
        throw new Error('ArConnect extension not found');
      }
      await connectWallet();
    } catch (error) {
      console.error('Error connecting wallet:', error);
      throw error;
    }
  };

  const isLoading = !walletStatus;

  const handleExport = () => {
    console.log('Exporting...');
  };

  const handlePurchase = async (selectedToken: TokenOption) => {
    console.log('SpriteCustomizer: Initiating purchase with token:', selectedToken);
    try {
      if (!wallet) {
        await connectWallet();
        return;
      }
      const success = await purchaseAccess(selectedToken);
      if (success) {
        setShowCelebration(true);
        
        // Close the modal quickly
        setTimeout(() => setIsPurchaseModalOpen(false), 2500);
        
        // No need to check status here as the WalletProvider will update the status
        // The parent component can listen to walletStatus changes if needed
        
        // Keep confetti for a bit longer
        setTimeout(() => setShowCelebration(false), 5000);
        console.log('SpriteCustomizer: Purchase and setup successful');
      } else {
        throw new Error('Purchase failed');
      }
    } catch (error) {
      console.error('SpriteCustomizer: Purchase error:', error);
      throw error;
    }
  };

  const getRandomColor = () => {
    // Generate a random hex color
    return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
  };

  const getRandomLayers = (availableStyles: any) => {
    const newLayers: Layers = {};
    
    availableStyles.forEach(category => {
      // Get non-empty options (exclude 'None' if it exists)
      const validOptions = category.options.filter(option => option !== 'None');
      
      if (validOptions.length > 0) {
        // 70% chance to add a layer
        if (Math.random() < 0.7) {
          newLayers[category.name] = {
            style: validOptions[Math.floor(Math.random() * validOptions.length)],
            color: getRandomColor()
          };
        } else {
          // If not adding a layer, set it to 'None'
          newLayers[category.name] = {
            style: 'None',
            color: '#ffffff'
          };
        }
      }
    });
    
    return newLayers;
  };

  const handleRandomize = () => {
    setLayers(getRandomLayers(availableStyles));
  };

  useEffect(() => {
    // Initialize with random layers instead of empty ones
    const loadAssets = async () => {
      try {
        setLoading(true);
        // Wait for a small delay to ensure Phaser is ready
        await new Promise(resolve => setTimeout(resolve, 100));
        setLayers(getRandomLayers(availableStyles));
      } catch (error) {
        console.error('Error loading initial layers:', error);
        setError('Failed to load initial layers');
      } finally {
        setLoading(false);
      }
    };
    
    loadAssets();
  }, [availableStyles]);

  const handleUnlockClick = async () => {
    if (!wallet?.address) {
      await handleConnectWallet();
    } else if (!walletStatus?.isUnlocked) {
      setIsPurchaseModalOpen(true);
    }
  };

  const handleWarpComplete = () => {
    if (onEnter) {
      onEnter();
    }
  };

  const handleSkipClick = () => {
    if (onEnter) {
      setShowWarp(true);
    }
  };

  const handleExportComplete = () => {
    if (onEnter) {
      setShowWarp(true);
    }
  };

  if (isLoading) return <div className={`min-h-screen flex items-center justify-center ${theme.bg} ${theme.text}`}>Loading assets...</div>;
  if (error) return <div className={`min-h-screen flex items-center justify-center ${theme.bg} ${theme.text}`}>Error: {error}</div>;

  return (
    <div className={`min-h-screen flex flex-col ${theme.bg} ${theme.text}`}>
      {showCelebration && (
        <Confetti
          width={windowSize.width}
          height={windowSize.height}
          recycle={false}
          numberOfPieces={500}
          onConfettiComplete={() => setShowCelebration(false)}
        />
      )}
      {/* Main container with gradient background */}
      <div className={`h-screen flex flex-col ${theme.bg}`}>
        <Header
          theme={theme}
          darkMode={darkMode}
          showBackButton={!onEnter}
          onDarkModeToggle={() => setDarkMode(!darkMode)}
        />
        {/* Main content area */}
        <div className={`flex-1 w-full ${theme.container} ${theme.text} shadow-2xl ${theme.border} flex flex-col overflow-hidden`}>
          {/* Content area */}
          <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 h-full overflow-hidden">
            {/* Left column - Controls */}
            <div className="w-full lg:w-1/3 p-2 overflow-y-auto">
              {/* Layer Selection */}
              <div className={`p-4 rounded-xl ${theme.container} border ${theme.border} ${theme.cardBg} ${theme.text}`}>
                <h2 className={`text-lg font-bold mb-4 ${theme.text}`}>Layer Selection</h2>
                <LayerSelector
                  layers={layers}
                  availableStyles={availableStyles}
                  onStyleChange={handleStyleChange}
                  onColorChange={handleColorChange}
                />
              </div>
            </div>

            {/* Right column - Preview */}
            <div className="w-full lg:w-2/3 p-2 flex flex-col gap-4 overflow-y-auto">
              {/* Four Direction Preview */}
              <div className={`p-4 rounded-xl ${theme.container} border ${theme.border} ${theme.cardBg} ${theme.text}`}>
                <h2 className={`text-lg font-bold mb-4 ${theme.text}`}>Character Preview</h2>
                {/* Temporarily hidden 4-way preview - DO NOT REMOVE */}
                {/* <div className="h-[45%] flex items-center justify-center">
                  <FourDirectionView
                    layers={layers}
                    darkMode={darkMode}
                  />
                </div> */}
                <div className="h-[65%] flex items-center justify-center">
                  <WalkingPreview
                    layers={layers}
                    darkMode={darkMode}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Buttons */}
          <div className={`flex gap-3 p-4 flex-shrink-0 ${theme.container} border-t ${theme.border} ${theme.bg}`}>
            {onEnter && (
              <button
                onClick={handleSkipClick}
                className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 
                  ${theme.buttonBg} ${theme.buttonHover} ${theme.text} 
                  backdrop-blur-md shadow-lg hover:shadow-xl border ${theme.border}`}
              >
                No Thanks, Just Log Me In
              </button>
            )}
            <button
              onClick={handleReset}
              className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 
                ${theme.buttonBg} ${theme.buttonHover} ${theme.text} 
                backdrop-blur-md shadow-lg hover:shadow-xl border ${theme.border}`}
            >
              Reset All Layers
            </button>
            <button
              onClick={handleRandomize}
              className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 
                ${theme.buttonBg} ${theme.buttonHover} ${theme.text} 
                backdrop-blur-md shadow-lg hover:shadow-xl border ${theme.border}`}
            >
              Random Layers
            </button>
            <ExportAndUploadButton
              layers={layers} 
              darkMode={darkMode} 
              mode="arweave"
              signer={signer}
              isUnlocked={walletStatus?.isUnlocked}
              onUploadStatusChange={setUploadStatus}
              onError={setError}
              onConnect={handleConnectWallet}
              onNeedUnlock={() => setIsPurchaseModalOpen(true)}
              onUploadComplete={handleExportComplete}
              className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 
                ${theme.buttonBg} ${theme.buttonHover} ${theme.text} 
                backdrop-blur-md shadow-lg hover:shadow-xl border ${theme.border}`}
            />
          </div>

          <Footer darkMode={darkMode} />

          {/* Admin Tools - Comment out when not needed DO NOT REMOVE*/}
          {/* <div className={`flex flex-col gap-4 p-4 ${theme.container} border-t ${theme.border}`}>
            <AdminBulkUnlock />
            <AdminRemoveUser />
          </div> */}
        </div>

        {showCelebration && (
          <div className="fixed inset-0 z-50 pointer-events-none">
            <Confetti
              width={windowSize.width}
              height={windowSize.height}
              recycle={false}
              numberOfPieces={500}
              gravity={0.3}
              colors={['#F4860A', '#814E33', '#FCF5D8', '#FFD700', '#FFA500']}
            />
          </div>
        )}

        <PurchaseModal
          isOpen={isPurchaseModalOpen}
          onClose={() => setIsPurchaseModalOpen(false)}
          onPurchase={handlePurchase}
          contractIcon={contractIcon}
          contractName={contractName}
        />

        <WarpTransition show={onEnter ? showWarp : false} onComplete={handleWarpComplete} />
      </div>
    </div>
  );
};

export default SpriteCustomizer;
