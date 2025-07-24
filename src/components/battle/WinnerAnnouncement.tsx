import React from "react";

interface WinnerAnnouncementProps {
  winner: string;
  theme: any;
}

/**
 * WinnerAnnouncement Component
 * 
 * Displays a modal overlay announcing the winner of the battle.
 * Shows for 3 seconds with a fade-in animation and backdrop blur effect.
 * 
 * @param winner - Name of the winning player/monster
 * @param theme - Theme object containing styling classes
 */
const WinnerAnnouncement: React.FC<WinnerAnnouncementProps> = ({
  winner,
  theme,
}) => {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-50">
      <div
        className={`${theme.container} border ${theme.border} backdrop-blur-md p-8 rounded-xl animate-fade-in text-center`}
      >
        <h2 className="text-3xl font-bold mb-4 text-yellow-400">
          Battle Complete!
        </h2>
        <p className="text-xl text-white">
          {winner} has won the battle!
        </p>
      </div>
    </div>
  );
};

export default WinnerAnnouncement;
