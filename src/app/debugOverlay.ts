import Phaser from 'phaser';
import { SCENE_KEYS } from './gameConfig';
import type { GameController } from '../core/game/GameController';
import type { SortingScene } from '../mechanics/sorting';
import { logInfo } from '../core/utils/logger';

/**
 * Tiny DOM debug panel, enabled with `?debug=true`.
 * Lives outside the canvas so it never interferes with gameplay input.
 */
export function mountDebugOverlay(game: Phaser.Game, controller: GameController): void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:9999;display:flex;gap:6px;align-items:center;' +
    'font:12px monospace;background:rgba(30,30,40,.85);color:#fff;padding:6px 8px;border-radius:8px;';

  const btn = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:12px monospace;padding:2px 8px;cursor:pointer;';
    b.addEventListener('click', onClick);
    el.appendChild(b);
    return b;
  };

  const fps = document.createElement('span');
  fps.textContent = 'fps: --';
  el.appendChild(fps);
  setInterval(() => {
    fps.textContent = `fps: ${Math.round(game.loop.actualFps)}`;
  }, 500);

  const sortingScene = () =>
    game.scene.isActive(SCENE_KEYS.sorting)
      ? (game.scene.getScene(SCENE_KEYS.sorting) as SortingScene)
      : null;

  const currentIndex = () => controller.state.currentLevelIndex;

  btn('◀ lvl', () => {
    const s = sortingScene();
    const target = Math.max(0, currentIndex() - 1);
    if (s) s.gotoLevel(target);
    else game.scene.start(SCENE_KEYS.sorting, { levelIndex: target });
  });
  btn('lvl ▶', () => {
    const s = sortingScene();
    const target = currentIndex() + 1;
    if (s) s.gotoLevel(target);
    else game.scene.start(SCENE_KEYS.sorting, { levelIndex: target });
  });
  btn('restart', () => sortingScene()?.restart('debug'));
  btn('clear save', () => {
    controller.progress.clear();
    logInfo('[debug] progress cleared');
    game.scene.start(SCENE_KEYS.lobby);
  });

  document.body.appendChild(el);
}
