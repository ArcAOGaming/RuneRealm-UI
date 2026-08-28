import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { TurboFactory } from '@ardrive/turbo-sdk/web';
import { message, createDataItemSigner } from '../config/aoConnection';
import { AdminSkinChanger, DefaultAtlasTxID, PERMISSIONS } from '../constants/Constants';
import { useWallet } from '../contexts/WalletContext';
import { SpriteColorizer } from '../utils/spriteColorizer';
import { faLockOpen } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

interface ExportAndUploadButtonProps {
  layers: {
    [key: string]: {
      style: string;
      color: string;
    };
  };
  darkMode: boolean;
  className?: string;
  mode?: 'download' | 'arweave';
  signer?: any;
  isUnlocked?: boolean;
  onUploadClick?: () => Promise<void>;
  onNeedUnlock?: () => void;
  onConnect?: () => void;
  onUploadComplete?: () => void;
  onUploadStatusChange?: (status: string) => void;
  onError?: (error: string) => void;
  icon?: React.ReactNode;
}

const unlockIcon = <FontAwesomeIcon icon={faLockOpen} className="w-5 h-5 mr-2 text-amber-400" />;

const ExportAndUploadButton: React.FC<ExportAndUploadButtonProps> = ({
  layers,
  darkMode,
  className,
  mode = 'download',
  signer,
  isUnlocked: propIsUnlocked,
  onUploadClick,
  onNeedUnlock,
  onConnect,
  onUploadComplete,
  onUploadStatusChange,
  onError,
  icon
}) => {
  const [uploading, setUploading] = useState(false);
  const { wallet, walletStatus, connectWallet } = useWallet();
  const [isConnected, setIsConnected] = useState(false);

  // Check wallet connection status when wallet or status changes
  useEffect(() => {
    setIsConnected(walletStatus?.isUnlocked ?? false);
  }, [walletStatus]);

  const isUnlocked = propIsUnlocked ?? walletStatus?.isUnlocked ?? false;

  const createColorizedTexture = useCallback((imageData: ImageData, color: string): ImageData => {
    return SpriteColorizer.colorizeTexture(imageData, color, {
      preserveAlpha: true,
      cacheKey: `export_${color}_${imageData.width}x${imageData.height}`
    });
  }, []);

  // Removed requestPermissions and REQUIRED_PERMISSIONS as they're now handled by WalletContext

  const handleExport = async () => {
    try {
      console.log('Starting export process...');
      // Create a canvas for the final sprite map
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      // Set canvas size to match sprite sheet (12 frames * 48 pixels width, 60 pixels height)
      canvas.width = 576; // 12 frames * 48 pixels
      canvas.height = 60; // Single row height
      console.log('Canvas created with dimensions:', canvas.width, 'x', canvas.height);

      // Load and process each layer
      const processLayer = async (layerName: string, layerData: { style: string, color: string }) => {
        console.log(`Processing layer: ${layerName}, style: ${layerData.style}, color: ${layerData.color}`);
        // Load the sprite sheet image
        const assetUrl = new URL(`../assets/${layerName}/${layerData.style}.png`, import.meta.url).href;
        const img = new Image();
        img.src = assetUrl;
        
        await new Promise((resolve, reject) => {
          img.onload = () => {
            console.log(`Loaded image for ${layerName}: ${img.width}x${img.height}`);
            resolve(null);
          };
          img.onerror = (err) => {
            console.error(`Failed to load image for ${layerName}:`, err);
            reject(err);
          };
        });

        // Create a temporary canvas for color processing
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        
        // Draw the original image
        tempCtx.drawImage(img, 0, 0);
        console.log(`Drew ${layerName} to temp canvas`);
        
        // Get image data and apply color
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        console.log(`Got image data for ${layerName}: ${imageData.width}x${imageData.height}`);
        const colorizedData = SpriteColorizer.colorizeTexture(imageData, layerData.color, {
          preserveAlpha: true,
          cacheKey: `export_${layerName}_${layerData.color}`
        });
        
        // Put the colorized data back
        tempCtx.putImageData(colorizedData, 0, 0);
        console.log(`Applied color to ${layerName}`);
        
        // Draw the processed layer onto the main canvas
        ctx.drawImage(tempCanvas, 0, 0);
        console.log(`Drew ${layerName} to main canvas`);
      };

      // Process BASE layer first
      console.log('Loading BASE layer...');
      const baseUrl = new URL('../assets/BASE.png', import.meta.url).href;
      const baseImg = new Image();
      baseImg.src = baseUrl;
      await new Promise((resolve) => {
        baseImg.onload = () => {
          console.log('BASE layer loaded:', baseImg.width, 'x', baseImg.height);
          resolve(null);
        };
      });
      ctx.drawImage(baseImg, 0, 0);
      console.log('Drew BASE layer');

      // Process all other layers in order
      console.log('Processing additional layers...');
      for (const [layerName, layerData] of Object.entries(layers)) {
        await processLayer(layerName, layerData);
      }

      console.log('Converting to blob...');
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            console.log('Blob created successfully, size:', blob.size);
            resolve(blob);
          } else {
            console.error('Failed to create blob');
            reject(new Error('Failed to create blob'));
          }
        }, 'image/png');
      });

      if (mode === 'arweave') {
        if (!signer) {
          throw new Error('Arweave wallet not connected');
        }
        
        // Ensure wallet has proper permissions before creating TurboClient
        try {
          await window.arweaveWallet.getActiveAddress();
          await window.arweaveWallet.getActivePublicKey();
        } catch (permError) {
          console.error('Wallet permission error:', permError);
          // Try to reconnect with proper permissions
          try {
            //TODO maybe need this?
            //await window.arweaveWallet.connect(PERMISSIONS);
            await window.arweaveWallet.getActiveAddress();
            await window.arweaveWallet.getActivePublicKey();
          } catch (reconnectError) {
            throw new Error(`Wallet connection failed: ${reconnectError.message}`);
          }
        }

        console.log('Initializing TurboClient...');
        const turboClient = TurboFactory.authenticated({ signer });
        
        console.log('Starting Arweave upload...');
        // Convert blob to buffer before upload
        const buffer = Buffer.from(await blob.arrayBuffer());
        const { id } = await turboClient.uploadFile({
          fileStreamFactory: () => buffer,
          fileSizeFactory: () => blob.size,
          dataItemOpts: {
            tags: [
              { name: "Content-Type", value: "image/png" },
            ],
          },
        });
        console.log('Upload successful! TxId:', id);

        // Send message to update sprite handler
        if (window.arweaveWallet) {
          console.log('Sending sprite update message...');
          await message({
            process: AdminSkinChanger,
            tags: [
              { name: "Action", value: "UpdateSprite" },
              { name: "SpriteTxId", value: id },
              { name: "SpriteAtlasTxId", value: DefaultAtlasTxID }
            ],
            signer: createDataItemSigner(window.arweaveWallet),
            data: ""
          });
          console.log('Sprite update message sent successfully');
        }
        if (onUploadComplete) {
          onUploadComplete();
        }
        return id;
      } else {
        // Download mode
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'sprite-map.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      }
    } catch (error) {
      console.error('Error during export:', error);
      throw error;
    }
  };

  const handleClick = async () => {
    try {
      if (!signer) {
        if (onConnect) {
          onConnect();
        }
        return;
      }

      if (!isUnlocked) {
        if (onNeedUnlock) {
          onNeedUnlock();
        }
        return;
      }

      setUploading(true);
      if (onUploadStatusChange) {
        onUploadStatusChange('Starting upload...');
      }

      // Ensure wallet is connected using the wallet context
      if (!isConnected) {
        await connectWallet();
      }

      if (onUploadClick) {
        await onUploadClick();
      } else {
        await handleExport();
      }
    } catch (error) {
      console.error('Upload error:', error);
      if (onError) {
        onError(error instanceof Error ? error.message : 'Upload failed');
      }
    } finally {
      setUploading(false);
      if (onUploadStatusChange) {
        onUploadStatusChange('');
      }
    }
  };

  const buttonText = useMemo(() => {
    if (uploading) return 'Uploading...';
    if (!signer) return 'Connect Wallet';
    if (!isUnlocked) return 'Unlock Access';
    return 'Upload Sprite';
  }, [uploading, signer, isUnlocked]);

  // Spinner SVG
  const spinner = (
    <svg className={`animate-spin w-5 h-5 mr-2 ${darkMode ? 'text-amber-400' : 'text-blue-600'}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
    </svg>
  );

  const getButtonTitle = () => {
    if (!signer) return 'Click to connect your wallet';
    if (!isUnlocked) return 'Click to unlock sprite customization';
    return 'Click to upload your sprite';
  };

  return (
    <button
      onClick={handleClick}
      disabled={uploading}
      title={getButtonTitle()}
      className={className || `py-2 px-4 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 ${
        darkMode 
          ? 'bg-[#814E33]/30 hover:bg-[#814E33]/40 text-[#FCF5D8]' 
          : 'bg-[#814E33]/20 hover:bg-[#814E33]/30 text-[#814E33]'
      } backdrop-blur-md shadow-lg hover:shadow-xl border ${darkMode ? 'border-[#F4860A]/30' : 'border-[#814E33]/20'}`}
    >
      {uploading ? spinner : !isUnlocked ? unlockIcon : icon && <span className="mr-2 flex items-center">{icon}</span>}
      {buttonText}
    </button>
  );
};

export default ExportAndUploadButton;
