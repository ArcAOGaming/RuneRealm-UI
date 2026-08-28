import { hexToRgb, calculateColorShade, matchesGreyShade, getGreyLevel } from './colorMapping';

export interface ColorizeOptions {
  preserveAlpha?: boolean;
  cacheKey?: string;
}

export class SpriteColorizer {
  private static colorCache: { [key: string]: ImageData } = {};

  static colorizeTexture(imageData: ImageData, color: string, options: ColorizeOptions = {}): ImageData {
    const { preserveAlpha = true, cacheKey } = options;

    // Check cache if cacheKey provided
    if (cacheKey && this.colorCache[cacheKey]) {
      return this.colorCache[cacheKey];
    }

    const newImageData = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );

    const baseColor = hexToRgb(color);

    // Process each pixel
    for (let i = 0; i < newImageData.data.length; i += 4) {
      // Skip fully transparent pixels
      if (preserveAlpha && newImageData.data[i + 3] === 0) continue;

      // Get the grey level of the current pixel
      const pixelColor = {
        r: newImageData.data[i],
        g: newImageData.data[i + 1],
        b: newImageData.data[i + 2]
      };

      // Check if this is a grey pixel
      const greyIndex = matchesGreyShade(pixelColor);
      if (greyIndex !== -1) {
        // Get the grey level and calculate the appropriate shade
        const greyLevel = getGreyLevel(greyIndex);
        const coloredPixel = calculateColorShade(baseColor, greyLevel);

        newImageData.data[i] = coloredPixel.r;
        newImageData.data[i + 1] = coloredPixel.g;
        newImageData.data[i + 2] = coloredPixel.b;
      }
      // Leave non-grey pixels unchanged
    }

    // Cache the result if cacheKey provided
    if (cacheKey) {
      this.colorCache[cacheKey] = newImageData;
    }

    return newImageData;
  }

  static clearCache() {
    this.colorCache = {};
  }
}
