import { SpriteColorizer } from '../utils/spriteColorizer';

interface LayerData {
  style: string;
  color: string;
}

export interface LayerToImageOptions {
  width: number;
  height: number;
  includeBase?: boolean;
}

export async function layerToImage(
  layers: { [key: string]: LayerData },
  options: LayerToImageOptions
): Promise<HTMLCanvasElement> {
  console.log('Starting layer to image conversion...', { layers, options });
  
  // Create the main canvas
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  // Set canvas dimensions
  canvas.width = options.width;
  canvas.height = options.height;
  console.log('Canvas created with dimensions:', canvas.width, 'x', canvas.height);

  // Process BASE layer if included
  if (options.includeBase !== false) {
    console.log('Loading BASE layer...');
    const baseUrl = new URL('../assets/BASE.png', import.meta.url).href;
    const baseImg = new Image();
    baseImg.src = baseUrl;
    await new Promise((resolve) => {
      baseImg.onload = () => {
        console.log('BASE layer loaded:', baseImg.width, 'x', baseImg.height);
        ctx.drawImage(baseImg, 0, 0, baseImg.width, options.height, 0, 0, options.width, options.height);
        console.log('Drew BASE layer to canvas');
        resolve(null);
      };
    });
  }

  // Process each layer
  const processLayer = async (layerName: string, layerData: LayerData) => {
    console.log(`Processing layer: ${layerName}`, layerData);
    
    // Load the sprite sheet image
    const assetUrl = new URL(`../assets/${layerName}/${layerData.style}.png`, import.meta.url).href;
    const img = new Image();
    img.src = assetUrl;
    console.log(`Loading assetUrl: ${assetUrl}`);
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
    tempCanvas.width = options.width;
    tempCanvas.height = options.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    
    // Draw the layer to the temp canvas
    tempCtx.drawImage(img, 
      0, 0,                    // Source x, y
      img.width, options.height, // Source width, height
      0, 0,                    // Destination x, y
      options.width, options.height  // Destination width, height
    );
    console.log(`Drew ${layerName} to temp canvas`);
    
    // Get image data and apply color
    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const colorizedData = SpriteColorizer.colorizeTexture(imageData, layerData.color, {
      preserveAlpha: true,
      cacheKey: `layertoimage_${layerName}_${layerData.color}`
    });
    
    // Put the colorized data back
    tempCtx.putImageData(colorizedData, 0, 0);
    console.log(`Applied color to ${layerName}`);
    
    // Draw the processed layer onto the main canvas
    ctx.drawImage(tempCanvas, 0, 0);
    console.log(`Drew ${layerName} to main canvas`);
  };

  // Process all layers in order
  console.log('Processing additional layers...');
  for (const [layerName, layerData] of Object.entries(layers)) {
    await processLayer(layerName, layerData);
  }

  return canvas;
}

// Helper function to convert canvas to blob
export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        console.log('Blob created successfully, size:', blob.size);
        resolve(blob);
      } else {
        reject(new Error('Failed to create blob'));
      }
    }, 'image/png');
  });
}
