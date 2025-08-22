import React, { useState } from 'react';
import { Gateway } from '../../constants/Constants';
import Arweave from 'arweave';

interface ProfileDetailProps {
  wallet?: any;
  profile: {
    ProfileImage?: string;
    CoverImage?: string;
    UserName?: string;
    DisplayName?: string;
    Description?: string;
    DateCreated?: number;
    DateUpdated?: number;
  };
  address: string;
  assets?: Array<{
    Id: string;
    Quantity: string;
    Type?: string;
  }>;
  onClose?: () => void;
}

export const ProfileDetail: React.FC<ProfileDetailProps> = ({
  profile,
  address,
  assets,
  onClose
}) => {
  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="relative">
          {profile.CoverImage && (
            <div className="h-48 w-full">
              <img
                src={`${Gateway}${profile.CoverImage}`}
                alt="Cover"
                className="w-full h-full object-cover rounded-t-lg"
              />
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white bg-black bg-opacity-50 rounded-full p-2 hover:bg-opacity-75"
          >
            ✕
          </button>
        </div>
        
        <div className="p-6">
          <div className="flex items-center mb-6">
            <div className="w-20 h-20 mr-4">
              {profile.ProfileImage ? (
                <img
                  src={`${Gateway}${profile.ProfileImage}`}
                  alt={profile.DisplayName || 'Profile'}
                  className="w-full h-full rounded-full object-cover border-4 border-gray-800"
                />
              ) : (
                <div className="w-full h-full rounded-full bg-gray-600 flex items-center justify-center">
                  <span className="text-white text-xl">
                    {(profile.DisplayName || profile.UserName || 'User').charAt(0)}
                  </span>
                </div>
              )}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">
                {profile.DisplayName || profile.UserName || 'Anonymous User'}
              </h2>
              <p className="text-gray-400 font-mono">{address}</p>
            </div>
          </div>

          {profile.Description && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white mb-2">About</h3>
              <p className="text-gray-300 whitespace-pre-line">{profile.Description}</p>
            </div>
          )}

          {/* {assets && assets.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white mb-2">Assets</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {assets.map((asset, index) => (
                  <div key={index} className="bg-gray-700 p-4 rounded-lg">
                    <p className="text-white font-mono text-sm mb-1">{asset.Id}</p>
                    <div className="flex justify-between text-gray-300">
                      <span>Quantity: {asset.Quantity}</span>
                      {asset.Type && <span>Type: {asset.Type}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )} */}

          <div className="text-gray-400 text-sm">
            <p>Member since: {formatDate(profile.DateCreated)}</p>
            <p>Last updated: {formatDate(profile.DateUpdated)}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
