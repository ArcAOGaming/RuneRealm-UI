import React from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { currentTheme } from '../../constants/theme';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { darkMode, setDarkMode } = useWallet();
  const [rotateScreen, setRotateScreen] = React.useState(
    localStorage.getItem('rotateScreen') !== 'false' // Default to true
  );
  const theme = currentTheme(darkMode);

  const handleRotateScreenToggle = () => {
    const newValue = !rotateScreen;
    setRotateScreen(newValue);
    localStorage.setItem('rotateScreen', newValue.toString());
    // Force reload to apply/remove rotation
    window.location.reload();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={`bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 ${theme.bg} ${theme.text}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>
        
        <div className="space-y-4">
          {/* Theme Toggle */}
          <div className="flex items-center justify-between">
            <span>Theme</span>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`px-4 py-2 rounded-lg ${theme.buttonBg} ${theme.buttonHover} transition-all duration-300`}
            >
              {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
            </button>
          </div>

          {/* Screen Rotation Toggle */}
          <div className="flex items-center justify-between">
            <span>Mobile Screen Rotation</span>
            <button
              onClick={handleRotateScreenToggle}
              className={`px-4 py-2 rounded-lg ${theme.buttonBg} ${theme.buttonHover} transition-all duration-300`}
            >
              {rotateScreen ? '📱 Enabled' : '🔒 Disabled'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
