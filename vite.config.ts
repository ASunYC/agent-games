import { defineConfig } from 'vite';
import { createLocalGenerationPlugin } from './server/local-generation.mjs';

export default defineConfig({
  plugins: [createLocalGenerationPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
