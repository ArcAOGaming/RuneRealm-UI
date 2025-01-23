import React, { useState } from 'react';
import { message, createDataItemSigner } from '../config/aoConnection';
import { AdminSkinChanger } from '../constants/spriteAssets';
import { TurboFactory } from '@ardrive/turbo-sdk/web';

interface ExportAndUploadButtonProps {
  id: string;
  layers: any;
  darkMode: boolean;
  mode: string;
  signer: any;
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
  signer,
  isUnlocked,
  onUploadStatusChange,
  onError,
  onConnect,
  onNeedUnlock,
  onUploadComplete,
  className
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleExport = async () => {
    try {
      setIsLoading(true);
      onUploadStatusChange('Starting upload...');

      if (!signer) {
        onUploadStatusChange('Please connect your wallet');
        await onConnect();
        return;
      }

      if (!isUnlocked) {
        onUploadStatusChange('Please purchase access first');
        onNeedUnlock();
        return;
      }

      // Convert layers to JSON string
      const layersJson = JSON.stringify(layers);

      // Upload to Arweave
      onUploadStatusChange('Uploading to Arweave...');
      
      const turbo = TurboFactory.authenticated(signer);
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
        signer: createDataItemSigner(window.arweaveWallet),
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
