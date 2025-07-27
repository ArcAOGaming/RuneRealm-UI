import React, { useState, useEffect } from 'react';
import { currentTheme } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';

interface CacheEntry {
  key: string;
  value: string;
  size: number;
  type: 'sprite' | 'metadata' | 'other';
  isExpanded: boolean;
  isEditing: boolean;
  editValue: string;
}

interface CacheGroup {
  prefix: string;
  entries: CacheEntry[];
  totalSize: number;
  isExpanded: boolean;
}

const CacheViewer: React.FC = () => {
  const { darkMode } = useWallet();
  const theme = currentTheme(darkMode);
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [cacheGroups, setCacheGroups] = useState<CacheGroup[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'sprite' | 'metadata' | 'other'>('all');
  const [totalSize, setTotalSize] = useState(0);
  const [groupingEnabled, setGroupingEnabled] = useState(true);

  const loadCacheEntries = () => {
    const entries: CacheEntry[] = [];
    let total = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key) || '';
        const size = new Blob([value]).size;
        total += size;

        // Determine cache type
        let type: 'sprite' | 'metadata' | 'other' = 'other';
        if (key.startsWith('sprite_cache_')) {
          type = 'sprite';
        } else if (key.includes('metadata') || key.includes('cache_metadata')) {
          type = 'metadata';
        }

        entries.push({
          key,
          value,
          size,
          type,
          isExpanded: false,
          isEditing: false,
          editValue: value
        });
      }
    }

    // Sort by key name
    entries.sort((a, b) => a.key.localeCompare(b.key));
    setCacheEntries(entries);
    setTotalSize(total);
    
    // Group entries by prefix
    groupCacheEntries(entries);
  };

  const groupCacheEntries = (entries: CacheEntry[]) => {
    const groups: { [key: string]: CacheEntry[] } = {};
    
    entries.forEach(entry => {
      // Extract prefix (everything before the first dash or the whole key if no dash)
      const dashIndex = entry.key.indexOf('-');
      const prefix = dashIndex > 0 ? entry.key.substring(0, dashIndex) : entry.key;
      
      if (!groups[prefix]) {
        groups[prefix] = [];
      }
      groups[prefix].push(entry);
    });
    
    // Convert to CacheGroup array
    const groupArray: CacheGroup[] = Object.keys(groups)
      .sort()
      .map(prefix => ({
        prefix,
        entries: groups[prefix],
        totalSize: groups[prefix].reduce((sum, entry) => sum + entry.size, 0),
        isExpanded: false
      }));
    
    setCacheGroups(groupArray);
  };

  useEffect(() => {
    loadCacheEntries();
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const toggleGroupExpanded = (prefix: string) => {
    setCacheGroups(prev => prev.map(group => 
      group.prefix === prefix 
        ? { ...group, isExpanded: !group.isExpanded }
        : group
    ));
  };

  const toggleExpanded = (key: string) => {
    setCacheEntries(prev => prev.map(entry => 
      entry.key === key 
        ? { ...entry, isExpanded: !entry.isExpanded, isEditing: false }
        : entry
    ));
    
    // Also update in groups
    setCacheGroups(prev => prev.map(group => ({
      ...group,
      entries: group.entries.map(entry => 
        entry.key === key 
          ? { ...entry, isExpanded: !entry.isExpanded, isEditing: false }
          : entry
      )
    })));
  };

  const startEditing = (key: string) => {
    setCacheEntries(prev => prev.map(entry => 
      entry.key === key 
        ? { ...entry, isEditing: true, editValue: entry.value }
        : entry
    ));
    
    // Also update in groups
    setCacheGroups(prev => prev.map(group => ({
      ...group,
      entries: group.entries.map(entry => 
        entry.key === key 
          ? { ...entry, isEditing: true, editValue: entry.value }
          : entry
      )
    })));
  };

  const cancelEditing = (key: string) => {
    setCacheEntries(prev => prev.map(entry => 
      entry.key === key 
        ? { ...entry, isEditing: false, editValue: entry.value }
        : entry
    ));
    
    // Also update in groups
    setCacheGroups(prev => prev.map(group => ({
      ...group,
      entries: group.entries.map(entry => 
        entry.key === key 
          ? { ...entry, isEditing: false, editValue: entry.value }
          : entry
      )
    })));
  };

  const saveEdit = (key: string) => {
    const entry = cacheEntries.find(e => e.key === key);
    if (entry) {
      try {
        localStorage.setItem(key, entry.editValue);
        setCacheEntries(prev => prev.map(e => 
          e.key === key 
            ? { ...e, value: e.editValue, isEditing: false, size: new Blob([e.editValue]).size }
            : e
        ));
        loadCacheEntries(); // Refresh to update total size
      } catch (error) {
        alert('Failed to save cache entry: ' + error);
      }
    }
  };

  const updateEditValue = (key: string, value: string) => {
    setCacheEntries(prev => prev.map(entry => 
      entry.key === key 
        ? { ...entry, editValue: value }
        : entry
    ));
  };

  const deleteEntry = (key: string) => {
    if (confirm(`Are you sure you want to delete cache entry "${key}"?`)) {
      localStorage.removeItem(key);
      loadCacheEntries();
    }
  };

  const clearAllCache = () => {
    if (confirm('Are you sure you want to clear ALL localStorage? This cannot be undone!')) {
      localStorage.clear();
      loadCacheEntries();
    }
  };

  const exportCache = () => {
    const cacheData = {};
    cacheEntries.forEach(entry => {
      cacheData[entry.key] = entry.value;
    });
    
    const dataStr = JSON.stringify(cacheData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `cache-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    
    URL.revokeObjectURL(url);
  };

  const filteredEntries = cacheEntries.filter(entry => {
    const matchesSearch = entry.key.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesType = typeFilter === 'all' || entry.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const filteredGroups = cacheGroups.map(group => ({
    ...group,
    entries: group.entries.filter(entry => {
      const matchesSearch = entry.key.toLowerCase().includes(searchFilter.toLowerCase());
      const matchesType = typeFilter === 'all' || entry.type === typeFilter;
      return matchesSearch && matchesType;
    })
  })).filter(group => group.entries.length > 0);

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'sprite': return 'bg-blue-100 text-blue-800';
      case 'metadata': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className={theme.text}>
        <h2 className="text-2xl font-bold mb-4">Cache Viewer</h2>
        <p className="opacity-80 mb-6">
          View and manage all local storage cache entries. Click on any key to expand and view/edit its contents.
        </p>
      </div>

      {/* Cache Statistics */}
      <div className={`${theme.container} border ${theme.border} rounded-lg p-4`}>
        <h3 className={`text-lg font-semibold ${theme.text} mb-3`}>Cache Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className={`font-medium ${theme.primary}`}>Total Entries:</span>
            <span className={`ml-2 ${theme.text}`}>{cacheEntries.length}</span>
          </div>
          <div>
            <span className={`font-medium ${theme.primary}`}>Total Size:</span>
            <span className={`ml-2 ${theme.text}`}>{formatSize(totalSize)}</span>
          </div>
          <div>
            <span className={`font-medium ${theme.primary}`}>Sprite Caches:</span>
            <span className={`ml-2 ${theme.text}`}>{cacheEntries.filter(e => e.type === 'sprite').length}</span>
          </div>
          <div>
            <span className={`font-medium ${theme.primary}`}>Other Entries:</span>
            <span className={`ml-2 ${theme.text}`}>{cacheEntries.filter(e => e.type === 'other').length}</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className={`${theme.container} border ${theme.border} rounded-lg p-4`}>
        <div className="flex flex-wrap gap-4 mb-4">
          <div className="flex-1 min-w-64">
            <input
              type="text"
              placeholder="Search cache keys..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className={`w-full px-3 py-2 rounded border ${theme.border} ${theme.container} ${theme.text} text-sm`}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className={`px-3 py-2 rounded border ${theme.border} ${theme.container} ${theme.text} text-sm`}
          >
            <option value="all">All Types</option>
            <option value="sprite">Sprite Cache</option>
            <option value="metadata">Metadata</option>
            <option value="other">Other</option>
          </select>
          <button
            onClick={() => setGroupingEnabled(!groupingEnabled)}
            className={`px-4 py-2 rounded font-medium ${groupingEnabled ? 'bg-blue-600 hover:bg-blue-700 text-white' : theme.buttonBg + ' ' + theme.buttonHover + ' ' + theme.text} text-sm`}
          >
            {groupingEnabled ? 'Ungroup' : 'Group'}
          </button>
          <button
            onClick={loadCacheEntries}
            className={`px-4 py-2 rounded font-medium ${theme.buttonBg} ${theme.buttonHover} ${theme.text} text-sm`}
          >
            Refresh
          </button>
          <button
            onClick={exportCache}
            className={`px-4 py-2 rounded font-medium bg-green-600 hover:bg-green-700 text-white text-sm`}
          >
            Export
          </button>
          <button
            onClick={clearAllCache}
            className={`px-4 py-2 rounded font-medium bg-red-600 hover:bg-red-700 text-white text-sm`}
          >
            Clear All
          </button>
        </div>
        
        <p className={`${theme.text} opacity-60 text-sm`}>
          {groupingEnabled 
            ? `Showing ${filteredGroups.reduce((sum, group) => sum + group.entries.length, 0)} entries in ${filteredGroups.length} groups`
            : `Showing ${filteredEntries.length} of ${cacheEntries.length} entries`
          }
        </p>
      </div>

      {/* Cache Entries */}
      <div className="space-y-2">
        {groupingEnabled ? (
          /* Grouped View */
          filteredGroups.map((group) => (
            <div key={group.prefix} className={`${theme.container} border ${theme.border} rounded-lg`}>
              {/* Group Header */}
              <div 
                className={`p-4 cursor-pointer ${theme.buttonHover} rounded-t-lg bg-opacity-50`}
                onClick={() => toggleGroupExpanded(group.prefix)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`text-lg ${group.isExpanded ? 'rotate-90' : ''} transition-transform`}>
                      ▶
                    </span>
                    <span className={`font-bold text-base ${theme.text}`}>
                      {group.prefix}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800`}>
                      {group.entries.length} items
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className={`${theme.text} opacity-60`}>
                      {formatSize(group.totalSize)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Group Entries */}
              {group.isExpanded && (
                <div className={`border-t ${theme.border} p-2 space-y-1`}>
                  {group.entries.map((entry) => (
                    <div key={entry.key} className={`${theme.buttonBg} border ${theme.border} rounded`}>
                      {/* Entry Header */}
                      <div 
                        className={`p-3 cursor-pointer ${theme.buttonHover} rounded-t`}
                        onClick={() => toggleExpanded(entry.key)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className={`text-sm ${entry.isExpanded ? 'rotate-90' : ''} transition-transform`}>
                              ▶
                            </span>
                            <span className={`font-mono text-xs ${theme.text} truncate`}>
                              {entry.key.substring(group.prefix.length + 1) || entry.key}
                            </span>
                            <span className={`px-1 py-0.5 rounded text-xs font-medium ${getTypeColor(entry.type)}`}>
                              {entry.type}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className={`${theme.text} opacity-60`}>
                              {formatSize(entry.size)}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteEntry(entry.key);
                              }}
                              className="text-red-600 hover:text-red-800 font-medium"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Content */}
                      {entry.isExpanded && (
                        <div className={`border-t ${theme.border} p-3`}>
                          <div className="flex justify-between items-center mb-2">
                            <h5 className={`font-semibold ${theme.text} text-sm`}>Content</h5>
                            <div className="flex gap-1">
                              {!entry.isEditing ? (
                                <button
                                  onClick={() => startEditing(entry.key)}
                                  className={`px-2 py-1 rounded text-xs font-medium ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                                >
                                  Edit
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={() => saveEdit(entry.key)}
                                    className="px-2 py-1 rounded text-xs font-medium bg-green-600 hover:bg-green-700 text-white"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => cancelEditing(entry.key)}
                                    className="px-2 py-1 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white"
                                  >
                                    Cancel
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {entry.isEditing ? (
                            <textarea
                              value={entry.editValue}
                              onChange={(e) => updateEditValue(entry.key, e.target.value)}
                              className={`w-full h-48 p-2 rounded border ${theme.border} ${theme.container} ${theme.text} font-mono text-xs`}
                              placeholder="Enter cache value..."
                            />
                          ) : (
                            <div className={`bg-black/20 rounded p-2 max-h-48 overflow-auto`}>
                              <pre className={`${theme.text} font-mono text-xs whitespace-pre-wrap break-all`}>
                                {entry.value}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          /* Ungrouped View */
          filteredEntries.map((entry) => (
            <div key={entry.key} className={`${theme.container} border ${theme.border} rounded-lg`}>
              {/* Entry Header */}
              <div 
                className={`p-4 cursor-pointer ${theme.buttonHover} rounded-t-lg`}
                onClick={() => toggleExpanded(entry.key)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`text-lg ${entry.isExpanded ? 'rotate-90' : ''} transition-transform`}>
                      ▶
                    </span>
                    <span className={`font-mono text-sm ${theme.text} truncate`}>
                      {entry.key}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getTypeColor(entry.type)}`}>
                      {entry.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className={`${theme.text} opacity-60`}>
                      {formatSize(entry.size)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteEntry(entry.key);
                      }}
                      className="text-red-600 hover:text-red-800 font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              {entry.isExpanded && (
                <div className={`border-t ${theme.border} p-4`}>
                  <div className="flex justify-between items-center mb-3">
                    <h4 className={`font-semibold ${theme.text}`}>Content</h4>
                    <div className="flex gap-2">
                      {!entry.isEditing ? (
                        <button
                          onClick={() => startEditing(entry.key)}
                          className={`px-3 py-1 rounded text-sm font-medium ${theme.buttonBg} ${theme.buttonHover} ${theme.text}`}
                        >
                          Edit
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => saveEdit(entry.key)}
                            className="px-3 py-1 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => cancelEditing(entry.key)}
                            className="px-3 py-1 rounded text-sm font-medium bg-gray-600 hover:bg-gray-700 text-white"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {entry.isEditing ? (
                    <textarea
                      value={entry.editValue}
                      onChange={(e) => updateEditValue(entry.key, e.target.value)}
                      className={`w-full h-64 p-3 rounded border ${theme.border} ${theme.container} ${theme.text} font-mono text-sm`}
                      placeholder="Enter cache value..."
                    />
                  ) : (
                    <div className={`bg-black/20 rounded p-3 max-h-64 overflow-auto`}>
                      <pre className={`${theme.text} font-mono text-xs whitespace-pre-wrap break-all`}>
                        {entry.value}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {((groupingEnabled && filteredGroups.length === 0) || (!groupingEnabled && filteredEntries.length === 0)) && (
        <div className={`${theme.container} border ${theme.border} rounded-lg p-8 text-center`}>
          <p className={`${theme.text} opacity-60`}>
            No cache entries found matching your filters.
          </p>
        </div>
      )}
    </div>
  );
};

export default CacheViewer;
