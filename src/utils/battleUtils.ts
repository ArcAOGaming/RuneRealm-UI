/**
 * Battle Utility Functions
 * 
 * Contains helper functions for battle-related operations and UI logic.
 */

/**
 * Determines the background color class for a move button based on the move type.
 * Each move type has a distinct color to help players quickly identify move categories.
 * 
 * Color scheme:
 * - Struggle: Purple (special last-resort move)
 * - Heal: Green (restorative moves)
 * - Boost: Yellow (stat enhancement moves)
 * - Fire: Red (fire-type attacks)
 * - Water: Blue (water-type attacks)
 * - Air: Cyan (air/wind-type attacks)
 * - Rock: Orange (earth/rock-type attacks)
 * - Normal: Gray (basic attacks)
 * - Default: Dark red (fallback for attack moves)
 * 
 * @param moveName - Name of the move
 * @param move - Move object containing type and other properties
 * @returns Tailwind CSS background color class
 */
export const getMoveColor = (moveName: string, move: any): string => {
  // Special case for struggle move
  if (moveName === "struggle") return "bg-purple-700";
  
  // Determine type based on move type property
  const type = move.type.toLowerCase();
  
  switch (type) {
    case "heal":
      return "bg-green-600"; // Brighter green for healing
    case "boost":
      return "bg-yellow-400"; // Vibrant yellow for stat boosts
    case "fire":
      return "bg-red-600"; // Intense red for fire attacks
    case "water":
      return "bg-blue-600"; // Rich blue for water attacks
    case "air":
      return "bg-cyan-400"; // Light cyan for air attacks
    case "rock":
      return "bg-orange-700"; // Earthy orange for rock attacks
    case "normal":
      return "bg-gray-500"; // Neutral gray for normal attacks
    default:
      // Default to deep red for any other attack moves
      return "bg-red-700";
  }
};
