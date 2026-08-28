interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export const GREY_SHADES = [
  { r: 64, g: 64, b: 64 },    // Dark grey
  { r: 108, g: 108, b: 108 }, // Darkish grey
  { r: 144, g: 144, b: 144 }, // Medium grey
  { r: 176, g: 176, b: 176 }, // Light grey
  { r: 200, g: 200, b: 200 }, // Lightest grey
];

// Convert hex color to RGB
export function hexToRgb(hex: string): RGBColor {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) throw new Error('Invalid hex color');
  
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  };
}

// Darken a color by a specific factor (0-1)
function darkenColor(color: RGBColor, factor: number): RGBColor {
  return {
    r: Math.round(color.r * (1 - factor)),
    g: Math.round(color.g * (1 - factor)),
    b: Math.round(color.b * (1 - factor))
  };
}

// Lighten a color by a specific factor (0-1)
function lightenColor(color: RGBColor, factor: number): RGBColor {
  return {
    r: Math.min(255, Math.round(color.r + (255 - color.r) * factor)),
    g: Math.min(255, Math.round(color.g + (255 - color.g) * factor)),
    b: Math.min(255, Math.round(color.b + (255 - color.b) * factor))
  };
}

// Calculate shades of a color based on grey level
export function calculateColorShade(baseColor: RGBColor, greyLevel: number): RGBColor {
  // Map grey shades to color adjustments (with more subtle variations)
  const colorAdjustment = {
    200: { lighten: 0.35, darken: 0 },    // Lightest grey -> 35% lighter (was 60%)
    176: { lighten: 0.2, darken: 0 },     // Light grey -> 20% lighter (was 30%)
    144: { lighten: 0, darken: 0 },       // Middle grey -> Original color (selected color)
    108: { lighten: 0, darken: 0.2 },     // Dark grey -> 20% darker (was 30%)
    64: { lighten: 0, darken: 0.35 }      // Darkest grey -> 35% darker (was 60%)
  };

  // Find the adjustment based on the grey level
  const adjustment = colorAdjustment[greyLevel as keyof typeof colorAdjustment] ?? { lighten: 0, darken: 0 };
  
  // Apply lightening first if needed
  let adjustedColor = adjustment.lighten > 0 
    ? lightenColor(baseColor, adjustment.lighten)
    : baseColor;
    
  // Then apply darkening if needed
  return adjustment.darken > 0 
    ? darkenColor(adjustedColor, adjustment.darken)
    : adjustedColor;
}

// Check if a color matches one of our grey shades (with some tolerance)
export function matchesGreyShade(color: RGBColor): number {
  // Increase tolerance to account for image compression and color variations
  const tolerance = 5;

  // First check if the color is actually grey (R=G=B within tolerance)
  if (!(
    Math.abs(color.r - color.g) <= tolerance &&
    Math.abs(color.g - color.b) <= tolerance &&
    Math.abs(color.r - color.b) <= tolerance
  )) {
    return -1;
  }

  // Use the average of RGB to determine the grey level
  const greyValue = Math.round((color.r + color.g + color.b) / 3);

  // Find the closest grey shade
  let closestIndex = -1;
  let minDifference = 255;

  GREY_SHADES.forEach((shade, index) => {
    const difference = Math.abs(greyValue - shade.r);
    if (difference < minDifference) {
      minDifference = difference;
      closestIndex = index;
    }
  });

  // Only return a match if it's within our tolerance
  return minDifference <= tolerance ? closestIndex : -1;
}

// Get the grey level value for a shade index
export function getGreyLevel(shadeIndex: number): number {
  if (shadeIndex < 0 || shadeIndex >= GREY_SHADES.length) return 144; // Default to middle grey
  return GREY_SHADES[shadeIndex].r; // Since R=G=B for grey, we can use any channel
}
