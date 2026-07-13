import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * DEV-ONLY convenience for the blocks worktree. The embedded preview pane keeps
 * reloading to the bare root ("/"), which drops the ?mechanic query and so
 * shows the DEFAULT mechanic (sorting). This config redirects "/" to the blocks
 * entry at the server level, so the pane always lands on blocks no matter how
 * it reloads. Opt-in only: `vite --config vite.blocks.config.ts`. The base
 * config, the production build, and other mechanics are untouched.
 */
export default mergeConfig(
  base,
  defineConfig({
    plugins: [
      {
        name: 'blocks-root-redirect',
        configureServer(server) {
          // added BEFORE Vite's html-serving middleware so "/" is intercepted
          server.middlewares.use((req, res, next) => {
            if (req.url === '/' || req.url === '/index.html') {
              res.writeHead(302, { Location: '/?mechanic=blocks&level=1' });
              res.end();
              return;
            }
            next();
          });
        },
      },
    ],
  }),
);
