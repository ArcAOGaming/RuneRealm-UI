import { layerToImage, LayerToImageOptions } from './LayerToImage';

interface LayerData {
  style: string;
  color: string;
}

interface CacheMetadata {
  timestamp: number;
  key: string;
  layers: {
    [key: string]: LayerData;
  };
}

export class SpriteCacheService {
  private static CACHE_PREFIX = 'sprite_cache_';
  private static METADATA_KEY = 'sprite_cache_metadata';
  private static MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 hours
  private static MAX_CACHE_ITEMS = 10;

  private static generateCacheKey(layers: { [key: string]: LayerData }): string {
    // Create a deterministic string representation of the layers
    const layerString = Object.entries(layers)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}:${value.style}:${value.color}`)
      .join('|');
    
    // Create a hash of the string
    let hash = 0;
    for (let i = 0; i < layerString.length; i++) {
      const char = layerString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `${this.CACHE_PREFIX}${Math.abs(hash)}_${layerString}`;
  }

  private static async getMetadata(): Promise<CacheMetadata[]> {
    const metadata = localStorage.getItem(this.METADATA_KEY);
    return metadata ? JSON.parse(metadata) : [];
  }

  private static async setMetadata(metadata: CacheMetadata[]): Promise<void> {
    localStorage.setItem(this.METADATA_KEY, JSON.stringify(metadata));
  }

  private static async cleanOldCache(): Promise<void> {
    const metadata = await this.getMetadata();
    const now = Date.now();
    
    // Remove old entries
    const validMetadata = metadata.filter(entry => {
      const isExpired = (now - entry.timestamp) > this.MAX_CACHE_AGE;
      if (isExpired) {
        localStorage.removeItem(entry.key);
        console.log('Removed expired cache entry:', entry.key);
      }
      return !isExpired;
    });

    // If we still have too many items, remove the oldest ones
    while (validMetadata.length > this.MAX_CACHE_ITEMS) {
      const oldest = validMetadata.shift();
      if (oldest) {
        localStorage.removeItem(oldest.key);
        console.log('Removed oldest cache entry:', oldest.key);
      }
    }

    await this.setMetadata(validMetadata);
  }

  static async getCachedSprite(
    layers: { [key: string]: LayerData },
    options: LayerToImageOptions
  ): Promise<HTMLCanvasElement | null> {
    const cacheKey = this.generateCacheKey(layers);
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      console.log('Cache hit:', cacheKey);
      const img = new Image();
      img.src = cached;
      
      // Convert back to canvas
      const canvas = document.createElement('canvas');
      canvas.width = options.width;
      canvas.height = options.height;
      const ctx = canvas.getContext('2d')!;
      
      await new Promise((resolve) => {
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          resolve(null);
        };
      });
      
      return canvas;
    }
    
    console.log('Cache miss:', cacheKey);
    return null;
  }

  static async cacheSprite(
    layers: { [key: string]: LayerData },
    options: LayerToImageOptions
  ): Promise<HTMLCanvasElement> {
    await this.cleanOldCache();
    
    const cacheKey = this.generateCacheKey(layers);
    console.log('Generating and caching sprite:', cacheKey);
    
    // Generate the sprite
    const canvas = await layerToImage(layers, options);
    
    // Cache the sprite
    const dataUrl = canvas.toDataURL('image/png');
    localStorage.setItem(cacheKey, dataUrl);
    
    // Update metadata
    const metadata = await this.getMetadata();
    metadata.push({
      key: cacheKey,
      timestamp: Date.now(),
      layers: { ...layers } // Store layer information
    });
    await this.setMetadata(metadata);
    
    return canvas;
  }

  static async getOrCreateSprite(
    layers: { [key: string]: LayerData },
    options: LayerToImageOptions
  ): Promise<HTMLCanvasElement> {
    // Try to get from cache first
    const cached = await this.getCachedSprite(layers, options);
    if (cached) {
      return cached;
    }
    
    // If not in cache, generate and cache
    return this.cacheSprite(layers, options);
  }

  static clearCache(): void {
    // Clear all sprite cache entries
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
    
    // Clear metadata
    localStorage.removeItem(this.METADATA_KEY);
    console.log('Cache cleared');
  }
}
