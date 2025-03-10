import React from 'react';
import { Theme } from '../constants/theme';

// Helper functions
const getTypeColorClass = (type: string): string => {
  const typeMap: Record<string, string> = {
    fire: 'bg-red-500 text-white',
    water: 'bg-blue-500 text-white',
    air: 'bg-sky-500 text-white',
    rock: 'bg-amber-700 text-white',
    default: 'bg-gray-500 text-white'
  };
  return typeMap[type.toLowerCase()] || typeMap.default;
};

const getRarityStars = (rarity: number): string => {
  return '★'.repeat(rarity);
};

interface Move {
  type: string;
  attack?: number;
  defense?: number;
  speed?: number;
  health?: number;
  damage?: number;
  rarity?: number;
  count?: number;
}

interface MovesListProps {
  moves: Record<string, Move>;
  theme: Theme;
  layout?: 'grid' | 'vertical';
  className?: string;
}

export const MovesList: React.FC<MovesListProps> = ({ 
  moves, 
  theme, 
  layout = 'grid', 
  className = '' 
}) => {
  return (
    <div className={`moves-section ${className}`}>
      <h3 className={`moves-title ${theme.text} mb-2`}>Moves</h3>
      <div className={layout === 'grid' ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2'}>
        {Object.entries(moves).map(([name, move]) => (
          <div 
            key={name} 
            className={`move-card ${move.type} p-2 rounded-lg bg-opacity-20 backdrop-blur-sm relative overflow-hidden`}
          >
            {/* Type Badge in Corner */}
            <div className={`absolute top-0 right-0 px-2 py-0.5 text-xs font-bold ${getTypeColorClass(move.type)} rounded-bl-lg uppercase`}>
              {move.type}
            </div>
            
            {/* Rarity Stars (under type badge) */}
            {move.rarity && (
              <div className="absolute top-5 right-0 px-2 py-0.5">
                <span className={`text-xs font-medium text-yellow-500`}>
                  {getRarityStars(move.rarity)}
                </span>
              </div>
            )}
            
            {/* Move Name with Count */}
            <div className="flex items-center gap-1 mb-1">
              <div className={`move-name ${theme.text} font-bold text-sm truncate`}>{name}</div>
              {move.count && move.count > 1 && (
                <span className="bg-gray-200 text-gray-900 rounded-full px-1.5 text-xs font-medium">
                  x{move.count}
                </span>
              )}
            </div>
            
            {/* Move Stats - condensed to one row with smaller text */}
            <div className="move-stats flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-xs">
              {move.attack !== 0 && move.attack !== undefined && (
                <div className={`stat-item ${theme.text} flex items-center`}>
                  <span className="stat-icon mr-0.5">⚔️</span>
                  <span className={`${move.attack < 0 ? 'text-red-500' : ''}`}>
                    {move.attack > 0 ? '+' : ''}{move.attack}
                  </span>
                </div>
              )}
              
              {move.defense !== 0 && move.defense !== undefined && (
                <div className={`stat-item ${theme.text} flex items-center`}>
                  <span className="stat-icon mr-0.5">🛡️</span>
                  <span className={`${move.defense < 0 ? 'text-red-500' : ''}`}>
                    {move.defense > 0 ? '+' : ''}{move.defense}
                  </span>
                </div>
              )}
              
              {move.speed !== 0 && move.speed !== undefined && (
                <div className={`stat-item ${theme.text} flex items-center`}>
                  <span className="stat-icon mr-0.5">⚡</span>
                  <span className={`${move.speed < 0 ? 'text-red-500' : ''}`}>
                    {move.speed > 0 ? '+' : ''}{move.speed}
                  </span>
                </div>
              )}
              
              {move.health !== 0 && move.health !== undefined && (
                <div className={`stat-item ${theme.text} flex items-center`}>
                  <span className="stat-icon mr-0.5">❤️</span>
                  <span className={`${move.health < 0 ? 'text-red-500' : ''}`}>
                    {move.health > 0 ? '+' : ''}{move.health}
                  </span>
                </div>
              )}
              
              {move.damage !== 0 && move.damage !== undefined && (
                <div className={`stat-item ${theme.text} flex items-center`}>
                  <span className="stat-icon mr-0.5">💥</span>
                  <span className={`${move.damage < 0 ? 'text-red-500' : ''}`}>
                    {move.damage > 0 ? '+' : ''}{move.damage}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MovesList;
