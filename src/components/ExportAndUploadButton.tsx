import React, { useState } from 'react';
import { message, createDataItemSigner } from '../config/aoConnection';
import { AdminSkinChanger } from '../constants/Constants';
import { TurboFactory } from '@ardrive/turbo-sdk/web';
import { useWallet } from '../contexts/WalletContext';

interface ExportAndUploadButtonProps {
  id: string;
  layers: any;
  darkMode: boolean;
  mode: string;
  isUnlocked: boolean;
  onUploadStatusChange: (status: string) => void;
  onError: (error: string) => void;
  onConnect: () => Promise<void>;
  onNeedUnlock: () => void;
  onUploadComplete: () => void;
  className?: string;
}

const ExportAndUploadButton: React.FC<ExportAndUploadButtonProps> = ({
  id,
  layers,
  darkMode,
  mode,
  isUnlocked,
  onUploadStatusChange,
  onError,
  onConnect,
  onNeedUnlock,
  onUploadComplete,
  className
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const { wallet } = useWallet();
  const [walletSigner, setWalletSigner] = useState<any>(null);

  const handleExport = async () => {
    try {
      setIsLoading(true);
      onUploadStatusChange('Starting upload...');

      if (!wallet) {
        onUploadStatusChange('Please connect your wallet');
        await onConnect();
        return;
      }

      if (!isUnlocked) {
        onUploadStatusChange('Please purchase access first');
        onNeedUnlock();
        return;
      }

      if (!wallet) {
        throw new Error('No wallet connected');
      }
      const newSigner = createDataItemSigner(wallet);
      setWalletSigner(newSigner);

      // Convert layers to JSON string
      const layersJson = JSON.stringify(layers);

      // Upload to Arweave
      onUploadStatusChange('Uploading to Arweave...');
      
      // Create Turbo instance with the signer
      const turbo = TurboFactory.authenticated({
        signer: wallet
      });
      const uploadResponse = await turbo.uploadFile(
        new Blob([layersJson], { type: 'application/json' }),
        { tags: [{ name: 'Content-Type', value: 'application/json' }] }
      );

      const txId = uploadResponse.dataTxId;
      console.log('Uploaded to Arweave:', txId);

      // Send message to contract
      onUploadStatusChange('Saving to contract...');
      const result = await message({
        process: AdminSkinChanger,
        tags: [
          { name: "Action", value: "SetSkin" },
          { name: "SkinTxId", value: txId }
        ],
        signer: walletSigner,
      });

      console.log('Contract response:', result);
      onUploadStatusChange('Upload complete!');
      onUploadComplete();

    } catch (error) {
      console.error('Export error:', error);
      onError(error.message || 'Export failed');
      onUploadStatusChange('Upload failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      id={id}
      onClick={handleExport}
      disabled={isLoading}
      className={className}
    >
      {isLoading ? 'Uploading...' : 'Save Character'}
    </button>
  );
};

export default ExportAndUploadButton;
