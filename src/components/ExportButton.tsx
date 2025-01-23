import { useCallback } from 'react';
import { message, createDataItemSigner } from '../config/aoConnection';
import { AdminSkinChanger, DefaultAtlasTxID } from '../constants/spriteAssets';

interface ExportButtonProps {
  layers: {
    [key: string]: {
      style: string;
      color: string;
    };
  };
  darkMode?: boolean;
  className?: string;
  onExport?: (imageData: string) => Promise<void>;
  mode?: 'download' | 'arweave';
  buttonText?: string;
}

const ExportButton: React.FC<ExportButtonProps> = ({ 
  layers, 
  darkMode, 
  className, 
  onExport,
  mode = 'download',
  buttonText
}) => {
  const createColorizedTexture = useCallback((imageData: ImageData, color: string): ImageData => {
    const newImageData = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );

    // Convert hex color to RGB
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);

    // Process each pixel
    for (let i = 0; i < newImageData.data.length; i += 4) {
      if (newImageData.data[i + 3] > 0) { // If pixel is not transparent
        // Apply color while preserving luminance
        const luminance = (newImageData.data[i] * 0.299 + 
                         newImageData.data[i + 1] * 0.587 + 
                         newImageData.data[i + 2] * 0.114) / 255;

        newImageData.data[i] = r * luminance;     // Red
        newImageData.data[i + 1] = g * luminance; // Green
        newImageData.data[i + 2] = b * luminance; // Blue
      }
    }

    return newImageData;
  }, []);

  const handleExport = async () => {
    try {
      console.log('Starting export process...');
      // Create a canvas for the final sprite map
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      // Set canvas size to match sprite sheet
      canvas.width = 576; // 12 frames * 48 pixels
      canvas.height = 180; // 3 rows * 60 pixels
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
        const colorizedData = createColorizedTexture(imageData, layerData.color);
        
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

      // Get the image data as base64
      console.log('Converting to base64...');
      const imageData = canvas.toDataURL('image/png');
      console.log('Base64 length:', imageData.length);
      console.log('First 100 chars of base64:', imageData.substring(0, 100));

      if (mode === 'arweave' && onExport) {
        console.log('Uploading to Arweave...');
        const id = await onExport(imageData);
        console.log('Upload handler completed with ID:', id);

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
        }
      } else {
        console.log('Downloading locally...');
        // Create download link
        const link = document.createElement('a');
        link.download = 'sprite-map.png';
        link.href = imageData;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log('Local download completed');
      }
    } catch (error) {
      console.error('Error during export:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
      }
    }
  };

  return (
    <button
      onClick={handleExport}
      className={className || `py-2 px-4 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 ${
        darkMode 
          ? 'bg-[#814E33]/30 hover:bg-[#814E33]/40 text-[#FCF5D8]' 
          : 'bg-[#814E33]/20 hover:bg-[#814E33]/30 text-[#814E33]'
      } backdrop-blur-md shadow-lg hover:shadow-xl border ${darkMode ? 'border-[#F4860A]/30' : 'border-[#814E33]/20'}`}
    >
      {buttonText || (mode === 'arweave' ? 'Upload to Arweave' : 'Export Sprite')}
    </button>
  );
};

export default ExportButton;
