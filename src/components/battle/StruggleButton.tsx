import React from "react";

interface StruggleButtonProps {
  onAttack: (moveName: string) => void;
  isDisabled: boolean;
  battleStatus: string;
}

/**
 * StruggleButton Component
 * 
 * Special move button that appears when all regular moves are exhausted (count = 0).
 * The struggle move is a last resort attack that deals minimal damage but can always be used.
 * Positioned absolutely in the center of the moves grid as an overlay.
 * 
 * @param onAttack - Callback function when struggle is selected
 * @param isDisabled - Whether the button should be disabled
 * @param battleStatus - Current battle status
 */
const StruggleButton: React.FC<StruggleButtonProps> = ({
  onAttack,
  isDisabled,
  battleStatus,
}) => {
  const isButtonDisabled = isDisabled || battleStatus === "ended";

  return (
    <button
      onClick={() => onAttack("struggle")}
      disabled={isButtonDisabled}
      className={`absolute inset-0 m-auto w-32 h-32 p-2 rounded-lg font-medium transition-all duration-300 
        bg-purple-500 hover:brightness-110 z-10
        ${isButtonDisabled ? "opacity-50 cursor-not-allowed" : ""}
        text-white overflow-hidden group flex flex-col justify-center items-center`}
    >
      <span className="capitalize text-lg mb-1">Struggle</span>
      <span className="text-sm opacity-75 mb-2">Last Resort</span>
      <span className="text-sm">⚔️ +1</span>
    </button>
  );
};

export default StruggleButton;
