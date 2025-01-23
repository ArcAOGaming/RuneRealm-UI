import React, { useState, useEffect } from 'react';
import { SpriteCacheService } from '../services/SpriteCacheService';

interface CacheEntry {
  key: string;
  timestamp: number;
  size: number;
  preview: string;
  layers?: {
    [key: string]: {
      style: string;
      color: string;
    };
  };
}

const CacheDebugger: React.FC = () => {
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [totalSize, setTotalSize] = useState(0);

  const refreshCache = () => {
    const entries: CacheEntry[] = [];
    let total = 0;

    // Scan localStorage for sprite cache entries
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('sprite_cache_')) {
        const value = localStorage.getItem(key);
        if (value) {
          const size = new Blob([value]).size;
          total += size;
          entries.push({
            key,
            timestamp: JSON.parse(localStorage.getItem('sprite_cache_metadata') || '[]')
              .find((m: any) => m.key === key)?.timestamp || 0,
            size,
            preview: value
          });
        }
      }
    }

    // Sort by timestamp (newest first)
    entries.sort((a, b) => b.timestamp - a.timestamp);
    setCacheEntries(entries);
    setTotalSize(total);
  };

  useEffect(() => {
    refreshCache();
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  const handleClearCache = () => {
    SpriteCacheService.clearCache();
    refreshCache();
  };

  return (
    <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Sprite Cache Debug</h2>
        <div className="space-x-4">
          <button
            onClick={refreshCache}
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Refresh
          </button>
          <button
            onClick={handleClearCache}
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Clear Cache
          </button>
        </div>
      </div>

      <div className="mb-4">
        <p>Total Cache Size: {formatSize(totalSize)}</p>
        <p>Entries: {cacheEntries.length}</p>
      </div>

      <div className="space-y-4">
        {cacheEntries.map((entry) => (
          <div
            key={entry.key}
            className="p-4 bg-white dark:bg-gray-700 rounded-lg shadow"
          >
            <div className="flex justify-between items-start">
              <div className="flex-1 mr-4">
                <p className="font-mono text-sm mb-2 break-all">{entry.key}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Created: {formatDate(entry.timestamp)}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                  Size: {formatSize(entry.size)}
                </p>
                
                {entry.layers && (
                  <div className="mt-2">
                    <p className="text-sm font-semibold mb-1">Layers:</p>
                    <div className="grid grid-cols-1 gap-2">
                      {Object.entries(entry.layers).map(([layerName, data]) => (
                        <div 
                          key={layerName}
                          className="flex items-center space-x-2 text-sm"
                        >
                          <span className="font-medium">{layerName}:</span>
                          <span className="text-gray-600 dark:text-gray-300">
                            {data.style}
                          </span>
                          <div 
                            className="w-4 h-4 rounded border"
                            style={{ backgroundColor: data.color }}
                            title={data.color}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <img
                src={entry.preview}
                alt="Cached Sprite"
                className="w-32 h-auto bg-gray-200 rounded"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CacheDebugger;
