// Self-hosted handwriting fonts: bundled woff2, identical on every device
// and available offline (subsets: Cyrillic + Latin, the weights we use).
import '@fontsource/caveat/cyrillic-500.css';
import '@fontsource/caveat/cyrillic-600.css';
import '@fontsource/caveat/cyrillic-700.css';
import '@fontsource/caveat/latin-500.css';
import '@fontsource/caveat/latin-600.css';
import '@fontsource/caveat/latin-700.css';
import '@fontsource/neucha/cyrillic-400.css';
import '@fontsource/neucha/latin-400.css';
import Phaser from 'phaser';
import { DPR } from '../core/utils/hidpi';
import { COLORS, readAppFlags } from './gameConfig';
import { WebPlatformService } from '../platform/WebPlatformService';
import { GameController } from '../core/game/GameController';
import { eventBus } from '../core/events/EventBus';
import { PreloadScene } from '../ui/Preloader';
import { LobbyScene } from '../scenes/LobbyScene';
import { ErrorScene } from '../scenes/ErrorScene';
import { MECHANICS } from './mechanics';
import { mountDebugOverlay } from './debugOverlay';
import { logWarn } from '../core/utils/logger';

/**
 * Composition root.
 * Creates the platform layer, the app controller and the Phaser game,
 * then hands control to the loading flow (PreloadScene).
 */
/** Wait for the bundled handwriting fonts before any canvas text is drawn
 * (otherwise the first frames render in a system fallback and then "jump").
 * Best-effort with a timeout: the game must still start if FontFaceSet is
 * unavailable (sandboxed previews) or a font fails. */
async function waitForFonts(timeoutMs = 2500): Promise<void> {
  const fonts = document.fonts as FontFaceSet | undefined;
  if (!fonts?.load) return;
  const wanted = [
    fonts.load('500 16px Caveat'),
    fonts.load('600 16px Caveat'),
    fonts.load('700 16px Caveat'),
    fonts.load('16px Neucha'),
  ];
  await Promise.race([
    Promise.all(wanted).then(() => fonts.ready),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

async function bootstrap(): Promise<void> {
  await waitForFonts();
  const flags = readAppFlags();
  const platform = new WebPlatformService();
  const controller = new GameController(platform);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    backgroundColor: COLORS.paperCss,
    scale: {
      // HiDPI: the backing store is physical pixels; zoom keeps the CSS size.
      // Scenes work in logical (CSS) px via applyHiDpiCamera (see hidpi.ts).
      mode: Phaser.Scale.NONE,
      zoom: 1 / DPR,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: window.innerWidth * DPR,
      height: window.innerHeight * DPR,
    },
    render: {
      antialias: true,
      roundPixels: false,
      // Mipmaps: power-of-two textures (icons, blocks, stars are 128x128)
      // downscale smoothly instead of shimmering at 15-20px.
      mipmapFilter: 'LINEAR_MIPMAP_LINEAR',
    },
    input: {
      activePointers: 2, // pointer events unify mouse + touch
    },
    // Mechanic scenes come from the registry (src/app/mechanics.ts) so adding a
    // mechanic never touches bootstrap. Shell scenes bracket them.
    scene: [PreloadScene, LobbyScene, ...MECHANICS.flatMap((m) => [...m.scenes]), ErrorScene],
  });

  game.registry.set('game', controller);

  // Dev-only: the embedded preview pane throttles requestAnimationFrame and
  // reports the page as hidden, so Phaser would pause its own render loop and
  // the canvas stays black. Neutralise the self-pause in dev so the game still
  // renders during the pane's RAF bursts. A real browser tab is unaffected
  // (it never hides); never do this in prod — a genuinely hidden tab should
  // pause to save battery.
  if (import.meta.env.DEV) {
    const loop = game.loop as unknown as { pause: () => void; blur: () => void };
    loop.pause = () => {};
    loop.blur = () => {};
  }

  // Scale.NONE needs a manual resize feed (fires the same RESIZE event the
  // scenes already subscribe to через ResponsiveContainer/onResize).
  const feedResize = () => game.scale.resize(window.innerWidth * DPR, window.innerHeight * DPR);
  window.addEventListener('resize', feedResize);

  // Crisp canvas text on HiDPI: default every text object to DPR resolution
  // (Phaser has no global setting for it; one wrapper beats ~50 call sites).
  const origText = Phaser.GameObjects.GameObjectFactory.prototype.text;
  Phaser.GameObjects.GameObjectFactory.prototype.text = function patchedText(
    this: Phaser.GameObjects.GameObjectFactory,
    x: number,
    y: number,
    content: string | string[],
    style?: Phaser.Types.GameObjects.Text.TextStyle,
  ) {
    return origText.call(this, x, y, content, { resolution: DPR, ...style });
  };

  // Track that the scene stack knows the current level (used by debug tools).
  game.events.on(Phaser.Core.Events.READY, () => {
    if (flags.debug) mountDebugOverlay(game, controller);
  });

  // Orientation / bfcache resume: Scale.RESIZE handles size; we only nudge
  // a refresh so Safari repaints correctly after returning to the tab.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) game.scale.refresh();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(feedResize, 250);
  });

  eventBus.emit('app_started', {
    is_mobile: platform.device.isMobile(),
    orientation: platform.device.orientation(),
    standalone: platform.device.isStandalone(),
    debug: flags.debug,
  });

  // PWA: cache core assets for app-like reloads (production only).
  const isStandalone = typeof window !== 'undefined' && !!window.__SORTPROTO_LEVELS__;
  if (import.meta.env.PROD && !isStandalone && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        logWarn('[sw] registration failed', err);
      });
    });
  }

  // Surface uncaught runtime errors as analytics events (prototype-level).
  window.addEventListener('error', (e) => {
    eventBus.emit('error_occurred', { stage: 'runtime', message: e.message });
  });
}

void bootstrap();
