import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills() // Ensure polyfills work correctly
  ],
  build: {
    rollupOptions: {
      input: 'index.html', // Ensure the correct entry point
      output: {
        globals: {}, // This is fine, but not always needed
      }
    },
    assetsInlineLimit: 4096, // Ensures large assets aren't inlined
  },
  resolve: {
    alias: {
      '@assets': '/src/assets' // Makes it easier to import assets
    }
  },
  base: '/', // Keep this if deploying at root
});
