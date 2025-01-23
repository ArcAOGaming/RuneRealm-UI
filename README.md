# Sprite Map Creator

A web application for creating custom sprite maps by overlaying and coloring grayscale layers on a base model.

## Features

- Layer-based sprite composition
- Real-time color adjustment for each layer
- Live preview with walking animation
- Export functionality for the final sprite map
- Responsive design for desktop and mobile

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm (v7 or higher)

### Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd sprite-map-creator
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

### Adding Assets

Place your sprite assets in the `public/assets` directory:
- `BASE.png`: Base model with walking animation frames
- `HAIR.png`: Grayscale hair layer
- `SHIRT.png`: Grayscale shirt layer
- `PANTS.png`: Grayscale pants layer

All assets should be pre-aligned and have the same dimensions.

### Customizing Animations

To customize the walking animations, modify the frame configuration in `src/components/PreviewCanvas.tsx`. The default configuration uses 3 frames for each direction.

## Development

### Project Structure

```
src/
  components/
    ColorSlider.tsx    # Color adjustment controls
    PreviewCanvas.tsx  # Phaser game canvas for preview
    ExportButton.tsx   # Export functionality
  utils/
    colorUtils.ts      # Color manipulation utilities
  App.tsx             # Main application component
  main.tsx            # Application entry point
```

### Adding New Layers

1. Add the new grayscale asset to `public/assets/`
2. Update the layers state in `App.tsx`
3. Add the layer loading in `PreviewCanvas.tsx`

## License

MIT
