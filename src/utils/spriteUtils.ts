import { Gateway } from '../constants/spriteAssets';

interface LayerState {
  style: string;
  color: string;
}

interface Layers {
  [key: string]: LayerState;
}

const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
};

export const drawSprite = async (
  ctx: CanvasRenderingContext2D,
  layers: Layers,
  scale: number = 1
) => {
  // Clear canvas
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Draw each layer
  for (const [layerName, layer] of Object.entries(layers)) {
    if (!layer.style) continue;

    try {
      const img = await loadImage(`${Gateway}${layer.style}`);
      ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale);

      // Apply color if specified
      if (layer.color) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = layer.color;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.globalCompositeOperation = 'source-over';
      }
    } catch (error) {
      console.error(`Error loading sprite layer ${layerName}:`, error);
    }
  }
};
