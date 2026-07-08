import Phaser from 'phaser';
import { applyHiDpiCamera, logicalSize } from '../core/utils/hidpi';
import { COLORS, FONTS, SCENE_KEYS, readAppFlags } from '../app/gameConfig';
import { UI_TEXTS } from '../config/uiTexts';
import { GAME_SETTINGS } from '../config/gameSettings';
import { drawPaper } from './sketch';
import { eventBus } from '../core/events/EventBus';
import type { GameController } from '../core/game/GameController';
import { loadExternalAssets } from '../core/assets/AssetLoader';

/**
 * Loading flow:
 *   app start -> fonts -> level config -> lobby.
 * Any failure routes to the ErrorScene with a readable message.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.preload);
  }

  create(): void {
    const game = this.registry.get('game') as GameController;

    const paper = this.add.graphics();
    applyHiDpiCamera(this);
    const { w: lw, h: lh } = logicalSize(this);
    drawPaper(paper, lw, lh);

    const label = this.add
      .text(lw / 2, lh / 2, UI_TEXTS.app.loading, {
        fontFamily: FONTS.body,
        fontSize: '20px',
        color: COLORS.pencilCss,
      })
      .setOrigin(0.5);

    const dots = this.time.addEvent({
      delay: 350,
      loop: true,
      callback: () => {
        label.setText(UI_TEXTS.app.loading + '.'.repeat((dots.getOverallProgress() * 100) % 4));
      },
    });

    void this.run(game);
  }

  private async run(game: GameController): Promise<void> {
    try {
      // 1) handwriting fonts (best-effort: game is playable with fallbacks;
      //    document.fonts can be absent in sandboxed previews)
      const fonts = document.fonts as FontFaceSet | undefined;
      await Promise.race([
        fonts
          ? Promise.all([fonts.load('600 24px Caveat'), fonts.load('16px Neucha')]).catch(
              () => undefined,
            )
          : Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, GAME_SETTINGS.loading.fontTimeoutMs)),
      ]);

      // 2) external level config (hard requirement)
      await game.levels.load();

      // 3) optional artist assets (fail-graceful: procedural fallback)
      await loadExternalAssets(this);

      eventBus.emit('assets_loaded', { levels_count: game.levels.count });
      eventBus.emit('mechanic_loaded', {
        mechanic_id: 'sorting',
        levels_count: game.levels.count,
      });
      // Dev shortcut: `?level=N` boots straight into that level (1-based,
      // clamped to the available range) so a specific level can be opened
      // deterministically without clicking through the lobby.
      const jump = readAppFlags().level;
      if (jump !== null) {
        this.scene.start(SCENE_KEYS.sorting, {
          levelIndex: Math.min(jump - 1, game.levels.count - 1),
        });
      } else {
        this.scene.start(SCENE_KEYS.lobby);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : UI_TEXTS.error.unknown;
      eventBus.emit('error_occurred', { stage: 'preload', message });
      this.scene.start(SCENE_KEYS.error, { message });
    }
  }
}
