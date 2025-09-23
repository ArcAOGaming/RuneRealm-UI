import { useState, useEffect } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import LayerSelector from '../../components/sprite/LayerSelector';
import ExportAndUploadButton from '../../services/upload';
import WalkingPreview from '../../components/sprite/WalkingPreview';
import WarpTransition from '../../components/sprite/WarpTransition';
import PurchaseModal from '../../components/ui/PurchaseModal';
import { currentTheme } from '../../constants/theme';
import { SPRITE_CATEGORIES } from '../../constants/Constants';
import { ArconnectSigner } from '@ardrive/turbo-sdk/web';
import { TokenOption, purchaseAccess } from '../../utils/aoHelpers';
import Confetti from 'react-confetti';
import Header from '../../components/ui/Header';
import Footer from '../../components/ui/Footer';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShuffle, faRotateLeft, faUpload, faDoorOpen } from '@fortawesome/free-solid-svg-icons';
import { useNavigate } from 'react-router-dom';
import FourDirectionView from '../../components/sprite/FourDirectionView';

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

const UploadSuccessModal = ({ open, onClose, darkMode }: { open: boolean; onClose: () => void; darkMode: boolean }) => {
  const navigate = useNavigate();
  const theme = currentTheme(darkMode);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className={`w-full max-w-xs sm:max-w-sm p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4 ${theme.container} border-2 ${theme.border}`}
        style={{ backgroundColor: theme.cardBg, borderColor: theme.cardBorder, color: theme.cardText }}
      >
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-green-500/20 mb-2">
          <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        </div>
        <div className="text-lg font-semibold text-center" style={{ color: theme.cardTitle }}>Sprite uploaded successfully!</div>
        <div className="flex flex-col gap-2 w-full mt-2">
          <button
            onClick={() => navigate('/reality')}
            className="w-full py-2 rounded-xl font-bold transition-all duration-200 hover:brightness-110"
            style={{ 
              background: `linear-gradient(to right, ${theme.cardAccent}, ${theme.primary})`,
              color: darkMode ? '#FFFFFF' : '#FFFFFF'
            }}
          >
            Play Now
          </button>
          <button
            onClick={onClose}
            className={`w-full py-2 rounded-xl font-bold border-2 mt-1 transition-all duration-200 ${theme.buttonHover}`}
            style={{ 
              borderColor: theme.cardBorder,
              color: theme.cardText,
              backgroundColor: 'transparent'
            }}
          >
            Edit Again
          </button>
        </div>
        <button onClick={onClose} className="absolute top-2 right-2 text-xl opacity-60 hover:opacity-100">×</button>
      </div>
    </div>
  );
};

const SpriteCustomizer: React.FC<SpriteCustomizerProps> = ({ onEnter }) => {
  const [layers, setLayers] = useState<Layers>({});
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [signer, setSigner] = useState<any>(null);
  const [currentSkin, setCurrentSkin] = useState(null);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const { wallet, walletStatus, connectWallet, darkMode, setDarkMode } = useWallet();
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
  const [showUploadSuccess, setShowUploadSuccess] = useState(false);
  const [previewMode, setPreviewMode] = useState<'walking' | 'four-direction'>('walking');
  const [hasUserCustomized, setHasUserCustomized] = useState(false);

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
          setSigner(new ArconnectSigner(window.arweaveWallet));
          if (walletStatus.contractIcon) setContractIcon(walletStatus.contractIcon);
          if (walletStatus.contractName) setContractName(walletStatus.contractName);
          if (walletStatus.currentSkin) {
            setCurrentSkin(walletStatus.currentSkin);
            if (walletStatus.currentSkin !== "none") {
              setShowPreview(true);
              setShowCustomizer(true);
              if (onEnter) setShowWarp(true);
            }
          }
          setLoading(false);
          return;
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
    setHasUserCustomized(true);
    setLayers(prev => ({
      ...prev,
      [layerName]: { ...prev[layerName], style }
    }));
  };

  const handleColorChange = (layerName: string, color: string) => {
    setHasUserCustomized(true);
    setLayers(prev => ({
      ...prev,
      [layerName]: { ...prev[layerName], color }
    }));
  };

  const handleDarkModeToggle = () => {
    if (setDarkMode) {
      setDarkMode(!darkMode);
    }
  };

  const handleReset = () => {
    setHasUserCustomized(false);
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
      const success = await purchaseAccess(wallet, selectedToken);
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
      
      // Always initialize this category in the layers object
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
      } else {
        // If no valid options, always set to 'None'
        newLayers[category.name] = {
          style: 'None',
          color: '#ffffff'
        };
      }
    });
    
    return newLayers;
  };

  const handleRandomize = () => {
    setHasUserCustomized(true);
    setLayers(getRandomLayers(availableStyles));
  };



  useEffect(() => {
    // Only initialize layers on first load, not when user has already customized
    if (hasUserCustomized) return;
    
    // Initialize with random layers instead of empty ones
    const loadAssets = async () => {
      try {
        setLoading(true);
        // Wait for a small delay to ensure Phaser is ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Ensure availableStyles is ready and not empty
        if (availableStyles && availableStyles.length > 0) {
          setLayers(getRandomLayers(availableStyles));
        } else {
          // Fallback to initializeLayers if availableStyles is not ready
          initializeLayers();
        }
      } catch (error) {
        console.error('Error loading initial layers:', error);
        setError('Failed to load initial layers');
        // Fallback to initializeLayers on error
        initializeLayers();
      } finally {
        setLoading(false);
      }
    };
    
    loadAssets();
  }, [availableStyles, hasUserCustomized]);

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
    setShowUploadSuccess(true);
    if (onEnter) {
      setShowWarp(true);
    }
  };

  if (isLoading || !layers || Object.keys(layers).length === 0) return <div className={`min-h-screen flex items-center justify-center ${theme.bg} ${theme.text}`}>Loading assets...</div>;
  if (error) return <div className={`min-h-screen flex items-center justify-center ${theme.bg} ${theme.text}`}>Error: {error}</div>;

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${theme.bg} ${theme.text}`}>
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
      {/* Main container with gradient background */}
      <div className={`flex-1 flex flex-col overflow-hidden ${theme.bg}`}>
        <Header
          theme={theme}
          darkMode={darkMode}
          showBackButton={!onEnter}
          onDarkModeToggle={handleDarkModeToggle}
        />
        <UploadSuccessModal open={showUploadSuccess} onClose={() => setShowUploadSuccess(false)} darkMode={darkMode} />
        {/* Main content area */}
        <div className={`flex-1 w-full ${theme.container} border-2 ${theme.border} backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden`}>
          {/* Content area */}
          <div className="flex-1 flex flex-col lg:flex-row gap-2 p-2 overflow-hidden">
            {/* Left column - Controls */}
            <div className="w-full lg:w-1/3 xl:w-1/4 flex flex-col overflow-hidden">
              {/* Layer Selection */}
              <div className={`flex-1 p-3 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-xl shadow-lg overflow-hidden flex flex-col`}>
                <h2 className="text-lg font-bold mb-3" style={{ color: theme.cardTitle }}>Character Customization</h2>
                <div className="flex-1 overflow-y-auto">
                  <LayerSelector
                    layers={layers}
                    availableStyles={availableStyles}
                    onStyleChange={handleStyleChange}
                    onColorChange={handleColorChange}
                    darkMode={darkMode}
                  />
                </div>
              </div>
            </div>

            {/* Right column - Preview */}
            <div className="w-full lg:w-2/3 xl:w-3/4 flex flex-col overflow-hidden">
              {/* Character Preview */}
              <div className={`flex-1 p-3 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-xl shadow-lg flex flex-col overflow-hidden`}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-bold" style={{ color: theme.cardTitle }}>Character Preview</h2>
                  
                  {/* Preview Mode Toggle */}
                  <div className="flex rounded-lg overflow-hidden" style={{ backgroundColor: theme.buttonBg }}>
                    <button
                      onClick={() => setPreviewMode('walking')}
                      className="px-3 py-1 text-sm font-medium transition-colors"
                      style={{
                        backgroundColor: previewMode === 'walking' ? theme.cardAccent : 'transparent',
                        color: previewMode === 'walking' ? '#FFFFFF' : theme.cardText
                      }}
                    >
                      Walking
                    </button>
                    <button
                      onClick={() => setPreviewMode('four-direction')}
                      className="px-3 py-1 text-sm font-medium transition-colors"
                      style={{
                        backgroundColor: previewMode === 'four-direction' ? theme.cardAccent : 'transparent',
                        color: previewMode === 'four-direction' ? '#FFFFFF' : theme.cardText
                      }}
                    >
                      4-Direction
                    </button>
                  </div>
                </div>
                
                {/* Preview Content */}
                <div className="flex-1 w-full rounded-xl overflow-hidden">
                  {previewMode === 'walking' ? (
                    <WalkingPreview
                      layers={layers}
                      darkMode={darkMode}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-2">
                      <div className="w-full max-w-4xl" style={{ aspectRatio: '960/280' }}>
                        <FourDirectionView
                          layers={layers}
                          darkMode={darkMode}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Buttons */}
          <div className={`flex gap-2 p-3 flex-shrink-0 ${theme.container} border-t ${theme.border} backdrop-blur-xl`}>
            {onEnter && (
              <button
                onClick={handleSkipClick}
                className="flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 backdrop-blur-md shadow-lg hover:shadow-xl border-2 flex items-center justify-center gap-2 font-bold"
                style={{
                  background: `linear-gradient(to right, ${theme.cardAccent}, ${theme.primary})`,
                  color: '#FFFFFF',
                  borderColor: theme.cardBorder
                }}
              >
                <FontAwesomeIcon icon={faDoorOpen} className="w-4 h-4" />
                <span className="hidden sm:inline">No Thanks, Just Log Me In</span>
                <span className="sm:hidden">Skip</span>
              </button>
            )}
            <button
              onClick={handleRandomize}
              className="flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all duration-300 font-bold shadow-md flex items-center justify-center gap-2 hover:brightness-110 hover:shadow-lg"
              style={{
                background: `linear-gradient(to right, ${theme.purple}, ${theme.purpleHover})`,
                color: '#FFFFFF'
              }}
            >
              <FontAwesomeIcon icon={faShuffle} className="w-4 h-4" />
              <span className="hidden sm:inline">Random</span>
            </button>
            <button
              onClick={handleReset}
              className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all duration-300 font-bold flex items-center justify-center gap-2 shadow-sm hover:shadow-md border-2 ${theme.buttonHover}`}
              style={{
                borderColor: theme.cardBorder,
                color: theme.cardText,
                backgroundColor: 'transparent'
              }}
            >
              <FontAwesomeIcon icon={faRotateLeft} className="w-4 h-4" />
              <span className="hidden sm:inline">Reset</span>
            </button>
            <div className="flex-1">
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
                className="w-full py-2 px-3 rounded-xl text-sm font-medium transition-all duration-300 font-bold flex items-center justify-center gap-2 shadow-sm hover:shadow-md border-2"
                icon={<FontAwesomeIcon icon={faUpload} className="w-4 h-4" />}
              />
            </div>
          </div>

          <Footer darkMode={darkMode} />
        </div>
      </div>
      <PurchaseModal
        isOpen={isPurchaseModalOpen}
        onClose={() => setIsPurchaseModalOpen(false)}
        onPurchase={handlePurchase}
        contractIcon={contractIcon}
        contractName={contractName}
      />
      <WarpTransition show={onEnter ? showWarp : false} onComplete={handleWarpComplete} />
    </div>
  );
};

export default SpriteCustomizer;
