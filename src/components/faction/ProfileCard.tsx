import React from 'react';
import { Gateway } from "../../constants/Constants";
import { MonsterStats } from '../../utils/aoHelpers';
import { MonsterCardDisplay } from '../monster/MonsterCardDisplay';

interface ProfileCardProps {
  profile: {
    ProfileImage?: string;
    UserName?: string;
    DisplayName?: string;
    Description?: string;
  };
  address: string;
  onClick?: () => void;
  assets?: Array<{
    Id: string;
    Quantity: string;
    Type?: string;
  }>;
  monster?: MonsterStats | null;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({ profile, address, onClick, assets, monster }) => {
  const shortenAddress = (addr: string) => {
    if (addr.length < 8) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden hover:bg-gray-700 transition-colors w-full h-full">
      <div className="p-2 h-full flex flex-col">
        {/* Profile Header - Clickable - More centered */}
        <div 
          className="flex items-center justify-center mb-2 cursor-pointer flex-shrink-0 px-1"
          onClick={onClick}
        >
          <div className="w-8 h-8 mr-3 flex-shrink-0">
            {profile?.ProfileImage ? (
              <img
                src={`${Gateway}${profile.ProfileImage}`}
                alt={profile.DisplayName || 'Profile'}
                className="w-full h-full rounded-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  // Only update if not already using fallback
                  if (!target.src.includes('data:image')) {
                    target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDQ4IDQ4IiBmaWxsPSJub25lIj48Y2lyY2xlIGN4PSIyNCIgY3k9IjI0IiByPSIyNCIgZmlsbD0iIzY0NzQ4QiIvPjxwYXRoIGQ9Ik0yNCAyNkMyOC40MTgzIDI2IDMyIDIyLjQxODMgMzIgMThDMzIgMTMuNTgxNyAyOC40MTgzIDEwIDI0IDEwQzE5LjU4MTcgMTAgMTYgMTMuNTgxNyAxNiAxOEMxNiAyMi40MTgzIDE5LjU4MTcgMjYgMjQgMjZaIiBmaWxsPSIjOTRBM0I4Ci8+PHBhdGggZD0iTTM4IDM4QzM4IDMxLjM3MjYgMzEuNzMxOSAyNiAyNCAyNkMxNi4yNjgxIDI2IDEwIDMxLjM3MjYgMTAgMzhIMzhaIiBmaWxsPSIjOTRBM0I4Ci8+PC9zdmc+';
                    target.onerror = null; // Prevent further error handling
                  }
                }}
              />
            ) : (
              <div className="w-full h-full rounded-full bg-gray-600 flex items-center justify-center">
                <span className="text-white text-xs">
                  {(profile?.DisplayName || profile?.UserName || 'User').charAt(0)}
                </span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-medium text-xs leading-tight">
              {profile?.DisplayName || profile?.UserName || 'Anonymous User'}
            </h3>
            <p className="text-gray-400 text-xs font-mono leading-tight">{shortenAddress(address)}</p>
          </div>
        </div>

        {/* Monster Section */}
        {monster ? (
          <div className="flex-1 flex flex-col justify-center px-1">
            {/* Monster Card Display */}
            <div className="w-full" onClick={(e) => e.stopPropagation()}>
              <MonsterCardDisplay monster={monster} />
            </div>
          </div>
        ) : (
          <div className="text-gray-500 text-center flex-1 flex items-center justify-center border-t border-gray-700 mt-2 pt-2 px-1">
            <div className="w-full">
              <div className="bg-gray-700/50 rounded-lg p-2 border border-gray-600/50">
                <span className="text-sm">No Monster</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
