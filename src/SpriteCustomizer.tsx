import { useState, useEffect } from 'react'
import PreviewCanvas from './components/PreviewCanvas'
import ExportButton from './components/ExportButton'
import LayerSelector from './components/LayerSelector'
import ExportAndUploadButton from './services/testupload'
import WalkingPreview from './components/WalkingPreview'
import FourDirectionView from './components/FourDirectionView'
import WarpTransition from './components/WarpTransition'
import PurchaseModal from './components/PurchaseModal'
import { currentTheme } from './constants/theme'
import { SPRITE_CATEGORIES } from './constants/spriteAssets'
import { ArconnectSigner } from '@ardrive/turbo-sdk/web'
import logoPath from './assets/rune-realm-transparent.png'
import { checkWalletStatus, TokenOption, purchaseAccess } from './utils/aoHelpers'
import Confetti from 'react-confetti'
import { AdminSkinChanger } from './constants/spriteAssets'
import { AdminBulkImport } from './components/AdminBulkImport'
import { AdminBulkUnlock } from './components/AdminBulkUnlock'
import AdminRemoveUser from './components/AdminRemoveUser'
import TestButton from './components/TestButton'
import CacheDebugger from './components/CacheDebugger'
// Uncomment when deploying in Reality, comment out SimpleHeader import
// import Header from './components/Header'
// Comment out when deploying in Reality
import SimpleHeader from './components/SimpleHeader'
import Header from './components/Header'

interface LayerState {
  style: string;
  color: string;
}

interface Layers {
  [key: string]: LayerState;
}

import { ArweaveWallet, REQUIRED_PERMISSIONS } from './types/arweave';

interface SpriteCustomizerProps {
  wallet?: ArweaveWallet;
  onEnter?: () => void;
  darkMode?: boolean;
}

// Helper function to get arweave wallet
const getArweaveWallet = async (): Promise<ArweaveWallet | null> => {
  if (window.arweaveWallet) {
    return window.arweaveWallet;
  }
  return null;
};

const SpriteCustomizer: React.FC<SpriteCustomizerProps> = ({ wallet, onEnter, darkMode: initialDarkMode }) => {
  const [layers, setLayers] = useState<Layers>({});
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [signer, setSigner] = useState<any>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [currentSkin, setCurrentSkin] = useState(null);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(initialDarkMode ?? false);
  const [loading, setLoading] = useState(true);
  const [availableStyles, setAvailableStyles] = useState(SPRITE_CATEGORIES);
  const [contractIcon, setContractIcon] = useState<string | undefined>();
  const [contractName, setContractName] = useState<string | undefined>();
  const [showCelebration, setShowCelebration] = useState(false);
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [isConnected, setIsConnected] = useState(false);
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
        if (window.arweaveWallet) {
          const address = await window.arweaveWallet.getActiveAddress();
          if (address) {
            setSigner(new ArconnectSigner(window.arweaveWallet));
            setIsConnected(true);
          }
        }
      } catch (error) {
        console.error("Connection error:", error);
      }
    };

    init();
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        console.log('SpriteCustomizer: Checking existing wallet connection');
        setLoading(true);
        const browserSigner = await getArweaveWallet();
        if (browserSigner) {
          console.log('SpriteCustomizer: Wallet connected');
          setSigner(browserSigner);
          const status = await checkWalletStatus();
          setIsUnlocked(status.isUnlocked);
          setContractIcon(status.contractIcon);
          setContractName(status.contractName);
          if (status.currentSkin) {
            console.log('SpriteCustomizer: Current skin found:', status.currentSkin);
            setCurrentSkin(status.currentSkin);
            // If we have a valid skin, enter immediately
            if (status.currentSkin !== "none") {
              setShowPreview(true);
              setShowCustomizer(true);
              if (onEnter) {
                setShowWarp(true);
              }
            }
          }
          setIsConnected(true);
        } else {
          console.log('SpriteCustomizer: No wallet connected');
        }
      } catch (error) {
        console.log('SpriteCustomizer: Connection error:', error);
      } finally {
        setLoading(false);
      }
    };

    init();
    initializeLayers();
  }, []);

  useEffect(() => {
    if (wallet && !isConnected) {
      const initializeWithWallet = async () => {
        try {
          const addr = await wallet.getActiveAddress();
          if (addr) {
            setIsConnected(true);
            const browserSigner = new ArconnectSigner(window.arweaveWallet);
            setSigner(browserSigner);
            const status = await checkWalletStatus();
            setIsUnlocked(status.isUnlocked);
            setContractIcon(status.contractIcon);
            setContractName(status.contractName);
            if (status.currentSkin) {
              setCurrentSkin(status.currentSkin);
              if (status.currentSkin !== "none") {
                setShowPreview(true);
                setShowCustomizer(true);
                if (onEnter) {
                  setShowWarp(true);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error initializing with wallet:', error);
        }
      };

      initializeWithWallet();
    }
  }, [wallet, isConnected]);

  useEffect(() => {
    const checkConnection = async () => {
      if (window.arweaveWallet) {
        try {
          const addr = await window.arweaveWallet.getActiveAddress();
          if (addr) {
            setIsConnected(true);
            const browserSigner = new ArconnectSigner(window.arweaveWallet);
            setSigner(browserSigner);
            const status = await checkWalletStatus();
            setIsUnlocked(status.isUnlocked);
            if (status.currentSkin) {
              setCurrentSkin(status.currentSkin);
              if (status.currentSkin !== "none") {
                setShowPreview(true);
                setShowCustomizer(true);
                if (onEnter) {
                  setShowWarp(true);
                }
              }
            }
          }
        } catch (error) {
          console.log('Not connected:', error);
        }
      }
    };
    checkConnection();
  }, []);

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

  const connectWallet = async () => {
    try {
      if (!window.arweaveWallet) {
        throw new Error('Please install ArConnect extension');
      }
      await window.arweaveWallet.connect(REQUIRED_PERMISSIONS);
      const address = await window.arweaveWallet.getActiveAddress();
      const browserSigner = new ArconnectSigner(window.arweaveWallet);
      
      setSigner(browserSigner);
      setIsConnected(true);
      
      const status = await checkWalletStatus({ address });
      setIsUnlocked(status.isUnlocked);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      setError('Failed to connect wallet. Please try again.');
    }
  };

  const handleExport = () => {
    console.log('Exporting...');
  };

  const handlePurchase = async (selectedToken: TokenOption) => {
    console.log('SpriteCustomizer: Initiating purchase with token:', selectedToken);
    try {
      if (!window.arweaveWallet) {
        throw new Error('Please connect your Arweave wallet');
      }
      const success = await purchaseAccess(selectedToken);
      if (success) {
        setShowCelebration(true);
        
        // Close the modal quickly
        setTimeout(() => setIsPurchaseModalOpen(false), 2500);
        
        // Start checking status immediately and continue for a few seconds
        const checkInterval = setInterval(async () => {
          const status = await checkWalletStatus();
          console.log('Rechecking status:', status);
          if (status.isUnlocked) {
            setIsUnlocked(true);
            clearInterval(checkInterval);
          }
        }, 1000);

        // Clear interval after 10 seconds if it hasn't succeeded
        setTimeout(() => clearInterval(checkInterval), 10000);
        
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

  const handleUnlockClick = () => {
    if (!signer) {
      connectWallet();
    } else if (!isUnlocked) {
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

  if (loading) return <div>Loading assets...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Main container with gradient background */}
      <div className={`h-screen flex flex-col ${theme.bg}`}>
        {/* Uncomment when deploying in Reality, comment out SimpleHeader */}
         <Header
          theme={theme}
          darkMode={darkMode}
          showBackButton={!onEnter}
          onDarkModeToggle={handleDarkModeToggle}
        />
        {/* Comment out when deploying in Reality */}
        {/*<SimpleHeader 
          theme={theme}
          darkMode={darkMode}
          onDarkModeToggle={handleDarkModeToggle}
        />
        {/* Main content area */}
        <div className={`flex-1 w-full ${theme.container} ${theme.text} shadow-2xl ${theme.border} flex flex-col overflow-hidden`}>
          {/* Content area */}
          <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 h-full overflow-hidden">
            {/* Left column - Controls */}
            <div className="w-full lg:w-1/3 p-2 overflow-y-auto">
              {/* Layer Selection */}
              <div className={`p-2 rounded-xl ${theme.container} border ${theme.border}`}>
                <h2 className="text-lg font-bold mb-2">Layer Selection</h2>
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
              <div className={`flex-1 p-4 rounded-xl ${theme.container} border ${theme.border}`}>
                <h2 className="text-lg font-bold mb-2">Character Preview</h2>
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
          <div className={`flex gap-3 p-4 flex-shrink-0 ${theme.container} border-t ${theme.border}`}>
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
              id="export-upload-button"
              layers={layers} 
              darkMode={darkMode} 
              mode="arweave"
              signer={signer}
              isUnlocked={isUnlocked}
              onUploadStatusChange={setUploadStatus}
              onError={setError}
              onConnect={connectWallet}
              onNeedUnlock={() => setIsPurchaseModalOpen(true)}
              onUploadComplete={handleExportComplete}
              className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 
                ${theme.buttonBg} ${theme.buttonHover} ${theme.text} 
                backdrop-blur-md shadow-lg hover:shadow-xl border ${theme.border}`}
            />
          </div>

          {/* Footer */}
          <div className={`flex justify-center items-center gap-2 py-1.5 px-3 ${theme.container} backdrop-blur-sm rounded-b-2xl border-t ${theme.border} flex-shrink-0`}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/70">Powered by</span>
              <a 
                href="https://ar.io" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="transition-transform hover:scale-105"
              >
                <img 
                  src={new URL(`./assets/ARIO-${darkMode ? 'Dark' : 'Light'}.png`, import.meta.url).href} 
                  alt="ARIO.pn" 
                  className="h-10" 
                />
              </a>
              <span className="text-sm text-white/70">+</span>
              <a 
                href="https://ardrive.io/turbo" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="transition-transform hover:scale-105"
              >
                <img 
                  src={new URL(`./assets/Turbo-${darkMode ? 'Dark' : 'Light'}.png`, import.meta.url).href} 
                  alt="Turbo" 
                  className="h-10" 
                />
              </a>
              <span className="text-sm text-white/70">on</span>
              <a 
                href="https://game.ar.io" 
                target="_blank" 
                rel="noopener noreferrer"
                className="transition-transform hover:scale-105"
              >
                <img src={new URL('./assets/arcao.ico', import.meta.url).href} alt="arcao" className="h-10" />
              </a>
            </div>
          </div>

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
