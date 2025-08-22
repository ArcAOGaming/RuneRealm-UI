import React from 'react';
import { currentTheme } from '../../constants/theme';
import { MonsterStats } from '../../utils/aoHelpers';
import { MonsterCardDisplay } from './MonsterCardDisplay';

interface MonsterCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  monster: MonsterStats;
  darkMode: boolean;
}

const MonsterCardModal: React.FC<MonsterCardModalProps> = ({ 
  isOpen, 
  onClose, 
  monster, 
  darkMode 
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div 
        className={`relative max-w-4xl max-h-[90vh] w-full overflow-y-auto rounded-lg ${
          darkMode ? 'bg-gray-900' : 'bg-white'
        } border ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 z-10 p-2 rounded-full ${
            darkMode 
              ? 'bg-gray-800 hover:bg-gray-700 text-white' 
              : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
          } transition-colors`}
          aria-label="Close modal"
        >
          <svg 
            className="w-6 h-6" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M6 18L18 6M6 6l12 12" 
            />
          </svg>
        </button>

        {/* Modal Content */}
        <div className="p-6">
          <MonsterCardDisplay 
            monster={monster}
            expanded={true}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
};

export default MonsterCardModal;
