import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Standalone build: everything inlined into a single index.html that runs
 * from file:// (double-click) or as a chat/artifact preview. Level config is
 * injected by tools/make-standalone.mjs after the build.
 */
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2018',
    outDir: 'dist-standalone',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
});
