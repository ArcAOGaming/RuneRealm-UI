import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { TurboFactory } from '@ardrive/turbo-sdk/web';
import { message, createDataItemSigner } from '../config/aoConnection';
import { AdminSkinChanger, DefaultAtlasTxID } from '../constants/Constants';
import { checkWalletStatus } from '../utils/aoHelpers';
import { SpriteColorizer } from '../utils/spriteColorizer';

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
}

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
  onError
}) => {
  const [uploading, setUploading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [localIsUnlocked, setLocalIsUnlocked] = useState(false);

  const checkStatus = async () => {
    try {
      if (!window.arweaveWallet) {
        setIsConnected(false);
        setLocalIsUnlocked(false);
        return;
      }

      const permissions = await window.arweaveWallet.getPermissions();
      const connected = permissions.includes('ACCESS_PUBLIC_KEY');
      setIsConnected(connected);

      if (connected) {
        // Get wallet status
        const status = await checkWalletStatus();
        setLocalIsUnlocked(status.isUnlocked);
      }
    } catch (error) {
      console.error('Error checking status:', error);
      setIsConnected(false);
      setLocalIsUnlocked(false);
    }
  };

  // Check status when component mounts and when dependencies change
  useEffect(() => {
    checkStatus();
  }, [signer, propIsUnlocked]);

  // Use either prop value or local state, preferring prop if available
  const isUnlocked = propIsUnlocked ?? localIsUnlocked;

  const createColorizedTexture = useCallback((imageData: ImageData, color: string): ImageData => {
    return SpriteColorizer.colorizeTexture(imageData, color, {
      preserveAlpha: true,
      cacheKey: `export_${color}_${imageData.width}x${imageData.height}`
    });
  }, []);

  const requestPermissions = async () => {
    if (!window.arweaveWallet) {
      throw new Error('ArConnect not found. Please install ArConnect extension.');
    }

    try {
      await window.arweaveWallet.connect([
        'ACCESS_ADDRESS',
        'ACCESS_PUBLIC_KEY',
        'SIGN_TRANSACTION',
        'SIGNATURE',
        'DISPATCH'
      ]);
      console.log('Permissions granted');
      setIsConnected(true);
      await checkStatus(); // Recheck connection after permissions granted
    } catch (error) {
      console.error('Failed to get permissions:', error);
      setIsConnected(false);
      throw error;
    }
  };

  const REQUIRED_PERMISSIONS = [
    'ACCESS_ADDRESS',
    'ACCESS_PUBLIC_KEY',
    'SIGN_TRANSACTION',
    'DISPATCH'
  ];

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

      // Process BASE layer first
      console.log('Loading BASE layer...');
      const baseUrl = new URL('../assets/BASE.png', import.meta.url).href;
      const baseImg = new Image();
      baseImg.src = baseUrl;
      await new Promise((resolve) => {
        baseImg.onload = () => {
          console.log('BASE layer loaded:', baseImg.width, 'x', baseImg.height);
          // Draw only the first row (60 pixels height)
          ctx.drawImage(baseImg, 0, 0, baseImg.width, 60, 0, 0, baseImg.width, 60);
          console.log('Drew BASE layer to canvas:', canvas.width, 'x', canvas.height);
          resolve(null);
        };
      });

      // Process each layer
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
        tempCanvas.width = 576;  // Fixed width
        tempCanvas.height = 60;  // Fixed height
        const tempCtx = tempCanvas.getContext('2d')!;
        
        // Draw only the first row of the original image, scaling to our target size
        tempCtx.drawImage(img, 
          0, 0,           // Source x, y
          img.width, 60,  // Source width, height (only first row)
          0, 0,           // Destination x, y
          576, 60         // Destination width, height (fixed size)
        );
        console.log(`Drew ${layerName} to temp canvas:`, tempCanvas.width, 'x', tempCanvas.height);
        
        // Get image data and apply color
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        console.log(`Got image data for ${layerName}: ${imageData.width}x${imageData.height}`);
        const colorizedData = createColorizedTexture(imageData, layerData.color);
        
        // Put the colorized data back
        tempCtx.putImageData(colorizedData, 0, 0);
        console.log(`Applied color to ${layerName}, temp canvas:`, tempCanvas.width, 'x', tempCanvas.height);
        
        // Draw the processed layer onto the main canvas
        ctx.drawImage(tempCanvas, 0, 0);
        console.log(`Drew ${layerName} to main canvas:`, canvas.width, 'x', canvas.height);
      };

      // Process all layers in order
      console.log('Processing additional layers...');
      for (const [layerName, layerData] of Object.entries(layers)) {
        await processLayer(layerName, layerData);
      }

      // Convert to blob
      console.log('Converting to blob...');
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            console.log('Blob created successfully, size:', blob.size);
            console.log('Final canvas dimensions:', canvas.width, 'x', canvas.height);
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

        console.log('Initializing TurboClient...');
        const turboClient = TurboFactory.authenticated({ signer });
        
        console.log('Starting Arweave upload...');
        const { id } = await turboClient.uploadFile({
          fileStreamFactory: () => blob.stream(),
          fileSizeFactory: () => blob.size,
          dataItemOpts: {
            tags: [
              {
                name: "Content-Type",
                value: "image/png",
              },
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

      // Ensure we have all required ArConnect permissions
      if (window.arweaveWallet) {
        const permissions = await window.arweaveWallet.getPermissions();
        const missingPermissions = REQUIRED_PERMISSIONS.filter(p => !permissions.includes(p));
        
        if (missingPermissions.length > 0) {
          console.log('Requesting missing permissions:', missingPermissions);
          await window.arweaveWallet.connect(REQUIRED_PERMISSIONS);
        }
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
      {buttonText}
    </button>
  );
};

export default ExportAndUploadButton;
