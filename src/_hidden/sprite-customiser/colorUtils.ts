export const applyColorToLayer = (
  grayscaleImage: HTMLCanvasElement,
  color: string
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = grayscaleImage.width;
  canvas.height = grayscaleImage.height;
  const ctx = canvas.getContext('2d')!;

  // Draw the grayscale image
  ctx.drawImage(grayscaleImage, 0, 0);

  // Get the RGB values from the color string
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  // Get the image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Apply the color tint
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i]; // Use red channel as grayscale value
    data[i] = (gray * r) / 255;     // Red
    data[i + 1] = (gray * g) / 255; // Green
    data[i + 2] = (gray * b) / 255; // Blue
    // Alpha channel remains unchanged
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
};
