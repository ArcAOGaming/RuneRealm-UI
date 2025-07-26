import React from "react";

/**
 * UpdateIndicator Component
 * 
 * A small loading indicator that appears in the bottom-right corner during battle updates.
 * Provides visual feedback to users when the battle state is being updated (e.g., after moves).
 * Features a pulsing animation to indicate ongoing activity.
 * 
 * This component is positioned fixed to stay visible regardless of scroll position.
 */
const UpdateIndicator: React.FC = () => (
  <div className="fixed bottom-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-full text-sm animate-pulse">
    Updating...
  </div>
);

export default UpdateIndicator;
