import Phaser from 'phaser';
import { COLORS, readAppFlags } from './gameConfig';
import { WebPlatformService } from '../platform/WebPlatformService';
import { GameController } from '../core/game/GameController';
import { eventBus } from '../core/events/EventBus';
import { PreloadScene } from '../ui/Preloader';
import { LobbyScene } from '../scenes/LobbyScene';
import { ErrorScene } from '../scenes/ErrorScene';
import { SortingScene } from '../mechanics/sorting';
import { mountDebugOverlay } from './debugOverlay';
import { logWarn } from '../core/utils/logger';

/**
 * Composition root.
 * Creates the platform layer, the app controller and the Phaser game,
 * then hands control to the loading flow (PreloadScene).
 */
function bootstrap(): void {
  const flags = readAppFlags();
  const platform = new WebPlatformService();
  const controller = new GameController(platform);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    backgroundColor: COLORS.paperCss,
    scale: {
      mode: Phaser.Scale.RESIZE, // true responsive canvas, no letterboxing
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: window.innerWidth,
      height: window.innerHeight,
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
    scene: [PreloadScene, LobbyScene, SortingScene, ErrorScene],
  });

  game.registry.set('game', controller);

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
    setTimeout(() => game.scale.refresh(), 250);
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

bootstrap();
