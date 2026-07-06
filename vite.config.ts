import { defineConfig } from 'vite';

/**
 * base: './' — relative asset paths so the production build can be served
 * from any static folder and dropped into a Capacitor webDir without changes.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2018',
    sourcemap: false,
    chunkSizeWarningLimit: 1600, // phaser is a single large vendor chunk by design
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  server: {
    host: true,
  },
});
