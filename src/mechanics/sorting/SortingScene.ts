import Phaser from 'phaser';
import { COLORS, FONTS, SCENE_KEYS } from '../../app/gameConfig';
import { UI_TEXTS } from '../../config/uiTexts';
import { GAME_SETTINGS } from '../../config/gameSettings';
import { eventBus } from '../../core/events/EventBus';
import type { GameController } from '../../core/game/GameController';
import { PaperBackground } from '../../ui/sketch';
import { scatterDoodles } from '../../ui/doodles';

/** Sorting one-liner doodles: scoped to this mechanic only (see doodles.ts). */
const SORTING_DOODLE_KEYS = Array.from(
  { length: 10 },
  (_, i) => `deco_sort_${String(i + 1).padStart(2, '0')}`,
);
import { Button } from '../../ui/Button';
import { Popup } from '../../ui/Popup';
import { ResponsiveContainer } from '../../ui/ResponsiveContainer';
import { SortingModel } from './SortingModel';
import { SortingView } from './SortingView';
import { SortingController } from './SortingController';
import { hasTexture } from '../../core/assets/AssetLoader';
import { SPECIAL } from './SortingTypes';

interface SceneData {
  levelIndex: number;
}

/** Per-session booster wallet (prototype scope; reset on page load). */
const wallet = {
  keys: GAME_SETTINGS.boosters.initialKeys,
  lenses: GAME_SETTINGS.boosters.initialLenses,
  undos: GAME_SETTINGS.boosters.initialUndos,
};

type TutorialId = 'howto' | 'hidden' | 'locked' | 'ink' | 'keyblock' | 'taped' | 'target' | 'chains' | 'multilock';

export class SortingScene extends Phaser.Scene {
  private game_!: GameController;
  private model!: SortingModel;
  private view!: SortingView;
  private controller!: SortingController;
  private levelIndex = 0;

  private paper!: PaperBackground;
  private doodles!: Phaser.GameObjects.Container;
  private doodleSeed = 0;
  private hudLevel!: Phaser.GameObjects.Text;
  private hudMoves!: Phaser.GameObjects.Text;
  private undoBtn!: Button;
  private lensBtn!: Button;
  private keyBtn!: Button;
  private nudgeTimer: Phaser.Time.TimerEvent | null = null;
  private backBtn!: Button;
  private restartBtn!: Button;
  private fullscreenBtn: Button | null = null;
  private popupOpen = false;
  private plusLensBtn: Button | null = null;
  private plusKeyBtn: Button | null = null;
  private plusUndoBtn: Button | null = null;
  private winBtn: Button | null = null;

  constructor() {
    super(SCENE_KEYS.sorting);
  }

  init(data: Partial<SceneData>): void {
    this.levelIndex = data.levelIndex ?? 0;
  }

  create(): void {
    this.game_ = this.registry.get('game') as GameController;
    const config = this.game_.levels.byIndex(this.levelIndex);
    if (!config) {
      const message = UI_TEXTS.error.levelNotFound(this.levelIndex);
      eventBus.emit('error_occurred', { stage: 'level_load', message });
      this.scene.start(SCENE_KEYS.error, { message });
      return;
    }
    eventBus.emit('level_loaded', {
      level_id: config.id,
      level_index: this.levelIndex,
      difficulty: config.difficulty,
    });

    this.popupOpen = false;
    this.model = new SortingModel(config);
    this.view = new SortingView(this, this.model);
    this.controller = new SortingController(
      this.model,
      this.view,
      {
        onStateChanged: () => this.refreshHud(),
        onWin: () => this.onWin(),
        // Deadlock popup removed by design: the player keeps full control via
        // the regular undo/restart buttons; level_failed analytics still fires.
        onDeadlock: () => {},
        onPlayerInteracted: () => this.cancelNudge(),
      },
      () => wallet.keys,
    );

    this.paper = new PaperBackground(this);
    this.doodles = this.add.container(0, 0).setDepth(-8);
    this.doodleSeed = Math.floor(Math.random() * 2 ** 31);
    this.buildHud();

    new ResponsiveContainer(this, (w, h) => this.layout(w, h));

    this.game_.state.markLevelStarted(this.levelIndex);
    eventBus.emit('level_started', {
      level_id: config.id,
      level_index: this.levelIndex,
      difficulty: config.difficulty,
    });

    this.maybeShowTutorial();
    this.scheduleNudge();

    // Lifecycle hygiene: scene-owned objects/tweens die with the scene;
    // explicitly release view refs so nothing outlives a restart.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cancelNudge();
      this.view.destroy();
    });
  }

  /* ---------------- onboarding: tutorials + idle hint ---------------- */

  private maybeShowTutorial(): void {
    const t = UI_TEXTS.tutorials;
    const seen = (k: string) => this.game_.progress.isTutorialSeen(k);
    const m = this.model;
    let id: TutorialId | null = null;
    // priority mirrors the curve order (one new mechanic per intro phase):
    // hidden 4 -> lock 7 -> ink 16 -> key 21 -> tape 31 -> target 36 ->
    // chains 41 -> double lock 46
    if (!seen('howto')) id = 'howto';
    else if (m.hasHiddenBlocks() && !seen('hidden')) id = 'hidden';
    else if (m.lockedColumn !== null && !m.hasBlockOfColor(SPECIAL.KEY) && !seen('locked')) id = 'locked';
    else if (m.hasBlockOfColor(SPECIAL.INK) && !seen('ink')) id = 'ink';
    else if (m.hasBlockOfColor(SPECIAL.KEY) && !seen('keyblock')) id = 'keyblock';
    else if (m.hasTapedColumns() && !seen('taped')) id = 'taped';
    else if (m.hasTargetColumns() && !seen('target')) id = 'target';
    else if (m.chainsLeft().length > 0 && !seen('chains')) id = 'chains';
    else if (m.locksLeft > 1 && !seen('multilock')) id = 'multilock';
    if (!id) return;

    const card = t[id];
    this.popupOpen = true;
    new Popup(this, {
      variant: 'note',
      title: card.title,
      section: this.buildTutorialArt(id),
      body: card.body,
      actions: [
        {
          label: t.ok,
          success: true,
          onClick: () => {
            this.game_.progress.markTutorialSeen(id as string);
            this.popupOpen = false;
            this.scheduleNudge();
          },
        },
      ],
    });
  }

  /** Mini illustration assembled from the live game assets (no extra art). */
  private buildTutorialArt(id: TutorialId): {
    node: Phaser.GameObjects.Container;
    height: number;
  } {
    const node = this.add.container(0, 0);
    const g = this.add.graphics();

    // Shared helpers so every mini-scene reads the same. `img` places an asset
    // centred at (x,y), scaled to fit `size` (aspect kept). `arrow` draws a
    // clean dashed arc with a real arrowhead (optionally crossed = "can't").
    const img = (key: string, x: number, y: number, size: number, alpha = 1): void => {
      if (!hasTexture(this, key)) return;
      const im = this.add.image(x, y, key);
      if (key === 'col_frame') {
        // the frame art is a very tall 96x506; force a readable mini-column
        // width instead of aspect-scaling it down to a thin strip.
        im.setDisplaySize(32, 78);
      } else {
        const fr = this.textures.getFrame(key);
        im.setScale(size / Math.max(fr.width, fr.height));
      }
      if (alpha < 1) im.setAlpha(alpha);
      node.add(im);
    };
    const arrow = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      opts: { dashed?: boolean; crossed?: boolean; lift?: number } = {},
    ): void => {
      const { dashed = true, crossed = false, lift = 22 } = opts;
      const mx = (x0 + x1) / 2;
      const my = Math.min(y0, y1) - lift;
      const pt = (t: number) => ({
        x: (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1,
        y: (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1,
      });
      g.lineStyle(2.8, COLORS.ink, 0.92);
      const N = 22;
      let prev = pt(0);
      for (let i = 1; i <= N; i++) {
        const p = pt(i / N);
        if (!dashed || i % 2 === 0) g.lineBetween(prev.x, prev.y, p.x, p.y);
        prev = p;
      }
      const end = pt(1);
      const near = pt(1 - 2 / N);
      const ang = Math.atan2(end.y - near.y, end.x - near.x);
      const ah = 11;
      g.lineBetween(end.x, end.y, end.x - Math.cos(ang - 0.55) * ah, end.y - Math.sin(ang - 0.55) * ah);
      g.lineBetween(end.x, end.y, end.x - Math.cos(ang + 0.55) * ah, end.y - Math.sin(ang + 0.55) * ah);
      if (crossed) {
        g.lineStyle(3.4, 0xb23317, 0.95);
        const cx = (x0 + x1) / 2;
        const cy = my + 2;
        g.lineBetween(cx - 9, cy - 9, cx + 9, cy + 9);
        g.lineBetween(cx + 9, cy - 9, cx - 9, cy + 9);
      }
    };
    const sparkle = (x: number, y: number, r: number): void => {
      g.lineStyle(2, COLORS.ink, 0.85);
      g.lineBetween(x - r, y, x + r, y);
      g.lineBetween(x, y - r, x, y + r);
      const r2 = r * 0.6;
      g.lineStyle(1.2, COLORS.ink, 0.7);
      g.lineBetween(x - r2, y - r2, x + r2, y + r2);
      g.lineBetween(x - r2, y + r2, x + r2, y - r2);
    };

    // A colour block that just turned face-up: the ? tile plus a sparkle burst
    // reading as "reveals" (no travel arrow — that would read as a move).
    if (id === 'hidden') {
      img('block_hidden', -46, 2, 42);
      sparkle(2, -4, 7);
      sparkle(-2, 14, 5);
      sparkle(9, 16, 4);
      node.add(g);
      img('block_1', 48, 2, 42);
      img('icon_lens', -46, 32, 16);
      return { node, height: 86 };
    }

    // Ink: two blots in a column, a crossed arc to a second empty column —
    // the blots cannot be lifted OUT of their column.
    if (id === 'ink') {
      img('col_frame', -54, 6, 82);
      img('block_ink', -54, 2, 24);
      img('block_ink', -54, 26, 24);
      img('col_frame', 56, 6, 82);
      arrow(-30, 6, 34, 6, { crossed: true, lift: 20 });
      node.add(g);
      return { node, height: 92 };
    }

    // Key hidden in a pile -> arc -> the locked column it opens.
    if (id === 'keyblock') {
      img('col_frame', -54, 6, 82);
      img('block_3', -54, 26, 24);
      img('block_key', -54, 2, 26);
      arrow(-30, 2, 34, 2, { lift: 20 });
      node.add(g);
      img('col_frame', 58, 6, 82);
      img('icon_lock', 58, 4, 20);
      return { node, height: 90 };
    }

    // Colour column: a block flies into a column showing its pale colour hint.
    if (id === 'target') {
      img('block_0', -56, 4, 36);
      arrow(-34, 2, 34, 2, { lift: 22 });
      node.add(g);
      img('col_frame', 58, 6, 84);
      for (let k = 0; k < 3; k++) img('block_0', 58, 26 - k * 24, 22, 0.24);
      return { node, height: 94 };
    }

    // Seal: a completed colour set breaks the emblem's seal on the column.
    if (id === 'chains') {
      for (let k = 0; k < 3; k++) img('block_0', -56, 26 - k * 21, 19);
      arrow(-38, 28, 30, 4, { lift: 24 });
      node.add(g);
      img('col_frame', 58, 10, 84);
      if (hasTexture(this, 'deco_seal')) {
        const fr = this.textures.getFrame('deco_seal');
        const sc = 46 / fr.width; // medallion is centred in the 256² texture
        node.add(this.add.image(58, -14, 'deco_seal').setScale(sc));
        const socket = this.add.graphics();
        socket.fillStyle(0xf1ede3, 0.95);
        socket.fillCircle(58, -14, 56 * sc);
        node.add(socket);
        img('block_0', 58, -14, 16);
      }
      return { node, height: 100 };
    }

    // Paper-flap column: take-only. A block cannot be dropped in (crossed arc);
    // the paper flap (same asset as in play) hangs over the column's top edge.
    if (id === 'taped') {
      img('block_0', -56, 8, 34);
      img('col_frame', 58, 10, 82);
      if (hasTexture(this, 'tape_flap')) {
        const flap = this.add.image(58, -21, 'tape_flap');
        const fr = this.textures.getFrame('tape_flap');
        flap.setDisplaySize(29, (29 * fr.height) / fr.width);
        node.add(flap);
      }
      arrow(-32, 6, 34, 6, { crossed: true, lift: 20 });
      node.add(g);
      return { node, height: 96 };
    }

    // Two keys -> a column carrying two locks.
    if (id === 'multilock') {
      img('icon_key', -54, -10, 26);
      img('icon_key', -54, 22, 26);
      arrow(-32, 6, 34, 6, { lift: 22 });
      node.add(g);
      img('col_frame', 58, 4, 82);
      img('icon_lock', 58, -12, 18);
      img('icon_lock', 58, 20, 18);
      return { node, height: 92 };
    }

    // Generic 'howto' / 'locked': a block drops into a column.
    img('block_0', -58, 4, 36);
    arrow(-38, 2, 34, 2, { lift: 22 });
    node.add(g);
    img('col_frame', 58, 4, 82);
    if (id === 'locked') {
      img('icon_lock', 58, 4, 18);
      img('icon_key', 58, 44, 16);
    }
    return { node, height: 86 };
  }

  /** Beginner idle hint: after a pause on the first levels, pulse a source. */
  private scheduleNudge(): void {
    this.cancelNudge();
    if (!GAME_SETTINGS.hint.enabled) return;
    if (this.levelIndex > GAME_SETTINGS.hint.maxLevelIndex) return;
    if (this.model.moves > 0 || this.popupOpen) return;
    this.nudgeTimer = this.time.delayedCall(GAME_SETTINGS.hint.idleDelayMs, () => {
      if (this.popupOpen || this.model.moves > 0) return;
      const mv = this.controller.findAnyMove();
      if (mv) this.view.pulseColumn(mv.from);
    });
  }

  private cancelNudge(): void {
    if (this.nudgeTimer) {
      this.nudgeTimer.remove(false);
      this.nudgeTimer = null;
    }
    this.view?.clearPulse();
  }

  /* ---------------- layout / HUD ---------------- */

  private layout(w: number, h: number): void {
    const safe = this.game_.platform.device.safeArea();
    const sizes = GAME_SETTINGS.layoutSizes;
    // Landscape is height-starved — use the slim bars so the board keeps the
    // vertical space (portrait stays exactly as tuned).
    const landscape = w > h;
    const hudHeight = landscape ? sizes.hudHeightLandscape : sizes.hudHeight;
    const boosterBarHeight = landscape ? sizes.boosterBarHeightLandscape : sizes.boosterBarHeight;
    this.paper.resize(w, h);

    const top = safe.top + 8;
    this.hudLevel.setPosition(safe.left + 56, top + 4);
    this.backBtn.setPosition(safe.left + 30, top + 20);
    this.restartBtn.setPosition(w - safe.right - 30, top + 20);
    this.fullscreenBtn?.setPosition(w - safe.right - 82, top + 20);
    // moves counter sits on the button row, just left of the left-most top-right
    // button (fullscreen if present, else restart). Right-aligned + mid-anchored.
    const leftmostBtnEdge = this.fullscreenBtn ? w - safe.right - 104 : w - safe.right - 52;
    this.hudMoves.setPosition(leftmostBtnEdge - 12, top + 20);


    const bottomY = h - safe.bottom - boosterBarHeight / 2;
    this.undoBtn.setPosition(w / 2 - 88, bottomY);
    this.lensBtn.setPosition(w / 2, bottomY);
    this.keyBtn.setPosition(w / 2 + 88, bottomY);
    this.plusLensBtn?.setPosition(w / 2 + 44, bottomY - 24);
    this.plusKeyBtn?.setPosition(w / 2 + 132, bottomY - 24);
    this.plusUndoBtn?.setPosition(w / 2 - 44, bottomY - 24);
    this.winBtn?.setPosition(w / 2, top + 24);

    this.view.setArea(
      safe.left + 8,
      top + hudHeight,
      w - safe.left - safe.right - 16,
      h - top - hudHeight - boosterBarHeight - safe.bottom - 8,
    );

    // дудли лише на бічних полях: зона виключення — реальні межі колонок
    // (з запасом), а не фіксована смуга, щоб широкі рівні не накривали дудли
    const board = this.view.contentBounds;
    const pad = 28;
    scatterDoodles(this, this.doodles, w, h, [
      { x: 0, y: 0, w, h: top + hudHeight },
      { x: board.x - pad, y: board.y - pad, w: board.w + pad * 2, h: board.h + pad * 2 },
      { x: 0, y: h - safe.bottom - boosterBarHeight - 10, w, h: boosterBarHeight + safe.bottom + 10 },
    ], this.doodleSeed, 6, SORTING_DOODLE_KEYS);
    // re-apply selection highlight after a resize rebuild
    if (this.controller.selectedColumn >= 0) {
      this.view.rebuild({ selected: this.controller.selectedColumn });
    }
  }

  private buildHud(): void {
    const cfg = this.game_.levels.byIndex(this.levelIndex)!;
    const t = UI_TEXTS.hud;

    this.hudLevel = this.add
      .text(0, 0, t.level(this.levelIndex + 1, cfg.par), {
        fontFamily: FONTS.display,
        fontSize: '24px',
        color: COLORS.inkCss,
        padding: { x: 8, y: 6 },
      })
      .setOrigin(0, 0);
    this.hudMoves = this.add
      .text(0, 0, '', {
        fontFamily: FONTS.display,
        fontSize: '24px',
        color: COLORS.inkCss,
        padding: { x: 8, y: 6 },
      })
      .setOrigin(1, 0.5);

    this.backBtn = new Button(this, 0, 0, {
      width: 44,
      height: 44,
      label: t.back,
      iconKey: 'icon_back',
      iconOnly: true,
      onClick: () => this.confirmQuit(),
    });
    if (this.scale.fullscreen.available) {
      this.fullscreenBtn = new Button(this, 0, 0, {
        width: 44,
        height: 44,
        label: '⛶',
        fontSize: 22,
        onClick: () => this.scale.toggleFullscreen(),
      });
    }
    this.restartBtn = new Button(this, 0, 0, {
      width: 44,
      height: 44,
      label: t.restart,
      iconKey: 'icon_restart',
      iconOnly: true,
      onClick: () => this.confirmRestart(),
    });

    this.undoBtn = new Button(this, 0, 0, {
      width: 76,
      height: 52,
      label: hasTexture(this, 'icon_undo') ? t.countOnly(wallet.undos) : t.undo,
      fontSize: 19,
      iconKey: 'icon_undo',
      light: true,
      onClick: () => {
        if (wallet.undos > 0 && this.controller.undo()) {
          wallet.undos -= 1;
          this.refreshHud();
        }
      },
    });
    this.lensBtn = new Button(this, 0, 0, {
      width: 76,
      height: 52,
      label: hasTexture(this, 'icon_lens') ? t.countOnly(wallet.lenses) : t.lens(wallet.lenses),
      fontSize: 19,
      iconKey: 'icon_lens',
      light: true,
      onClick: () => {
        if (wallet.lenses > 0 && this.controller.useLens()) {
          wallet.lenses -= 1;
          this.refreshHud();
        }
      },
    });
    this.keyBtn = new Button(this, 0, 0, {
      width: 76,
      height: 52,
      label: hasTexture(this, 'icon_key') ? t.countOnly(wallet.keys) : t.key(wallet.keys),
      fontSize: 19,
      iconKey: 'icon_key',
      light: true,
      onClick: () => {
        if (wallet.keys > 0 && this.controller.useKey()) {
          wallet.keys -= 1;
          this.refreshHud();
        }
      },
    });

    // чит-режим: "+" біля бустерів і кнопка авто-виграшу
    if (this.game_.settings.cheat) {
      this.plusLensBtn = new Button(this, 0, 0, {
        width: 26,
        height: 26,
        label: '+',
        fontSize: 18,
        onClick: () => {
          wallet.lenses += 1;
          this.refreshHud();
        },
      });
      this.plusKeyBtn = new Button(this, 0, 0, {
        width: 26,
        height: 26,
        label: '+',
        fontSize: 18,
        onClick: () => {
          wallet.keys += 1;
          this.refreshHud();
        },
      });
      this.plusUndoBtn = new Button(this, 0, 0, {
        width: 26,
        height: 26,
        label: '+',
        fontSize: 18,
        onClick: () => {
          wallet.undos += 1;
          this.refreshHud();
        },
      });
      this.winBtn = new Button(this, 0, 0, {
        width: 58,
        height: 34,
        label: UI_TEXTS.cheat.win,
        fontSize: 16,
        onClick: () => this.onWin(),
      });
    }

    this.refreshHud();
  }

  private refreshHud(): void {
    const t = UI_TEXTS.hud;
    this.hudMoves.setText(t.moves(this.model.moves));
    this.restartBtn.setEnabled(this.model.moves > 0 && !this.controller.isBusy);
    this.undoBtn
      .setLabel(hasTexture(this, 'icon_undo') ? t.countOnly(wallet.undos) : t.undo)
      .setEnabled(wallet.undos > 0 && this.model.canUndo && !this.controller.isBusy);
    this.lensBtn
      .setLabel(hasTexture(this, 'icon_lens') ? t.countOnly(wallet.lenses) : t.lens(wallet.lenses))
      .setEnabled(wallet.lenses > 0 && this.model.hasHiddenBlocks() && !this.controller.isBusy);
    this.keyBtn
      .setLabel(hasTexture(this, 'icon_key') ? t.countOnly(wallet.keys) : t.key(wallet.keys))
      .setEnabled(wallet.keys > 0 && this.model.lockedColumn !== null);
    this.scheduleNudge();
  }

  /* ---------------- flow ---------------- */

  /** Leaving mid-level asks for confirmation (progress + boosters burn). */
  private confirmQuit(): void {
    if (this.popupOpen) return;
    if (this.model.moves === 0) {
      this.quitToLobby();
      return;
    }
    this.popupOpen = true;
    const t = UI_TEXTS.quitConfirm;
    new Popup(this, {
      icon: 'icon_back',
      emoji: '←',
      title: t.title,
      body: t.body,
      actions: [
        {
          label: t.no,
          onClick: () => {
            this.popupOpen = false;
          },
        },
        {
          label: t.yes,
          danger: true,
          onClick: () => {
            this.popupOpen = false;
            this.quitToLobby();
          },
        },
      ],
    });
  }

  /** The top-right restart asks for confirmation (progress + boosters burn). */
  private confirmRestart(): void {
    if (this.popupOpen || this.model.moves === 0) return;
    this.popupOpen = true;
    const t = UI_TEXTS.restartConfirm;
    new Popup(this, {
      icon: 'icon_restart',
      emoji: '↺',
      title: t.title,
      body: t.body,
      actions: [
        {
          label: t.no,
          onClick: () => {
            this.popupOpen = false;
          },
        },
        {
          label: t.yes,
          danger: true,
          onClick: () => {
            this.popupOpen = false;
            this.restart('button');
          },
        },
      ],
    });
  }

  restart(source: 'button' | 'debug'): void {
    eventBus.emit('level_restarted', {
      level_id: this.model.levelId,
      source,
      moves_count: this.model.moves,
    });
    eventBus.emit('restart_used', { level_id: this.model.levelId });
    this.scene.restart({ levelIndex: this.levelIndex } satisfies SceneData);
  }

  gotoLevel(index: number): void {
    this.scene.restart({ levelIndex: index } satisfies SceneData);
  }

  private quitToLobby(): void {
    eventBus.emit('level_quit', {
      level_id: this.model.levelId,
      moves_count: this.model.moves,
      duration_sec: this.game_.state.levelDurationSec(),
    });
    this.scene.start(SCENE_KEYS.lobby);
  }

  private onWin(): void {
    if (this.popupOpen) return;
    this.popupOpen = true;

    const cfg = this.game_.levels.byIndex(this.levelIndex)!;
    const moves = this.model.moves;
    const twoStarLimit = Math.ceil(cfg.par * GAME_SETTINGS.scoring.twoStarFactor);
    const stars = moves <= cfg.par ? 3 : moves <= twoStarLimit ? 2 : 1;

    eventBus.emit('level_completed', {
      level_id: cfg.id,
      difficulty: cfg.difficulty,
      moves_count: moves,
      duration_sec: this.game_.state.levelDurationSec(),
      stars,
      result: 'completed',
    });

    const t = UI_TEXTS.win;
    const hasNext = this.levelIndex + 1 < this.game_.levels.count;
    // Delay the popup briefly: the move that completes the level can fire on
    // pointer-down, and without this gap the same tap's pointer-up lands on the
    // freshly-shown "Next" button and skips to the next level.
    this.time.delayedCall(300, () => {
      new Popup(this, {
        title: t.title,
        stars,
        body: t.moves(moves),
        note: stars < 3 ? { before: t.hintBefore, after: t.hintAfter(cfg.par) } : undefined,
        actions: [
          {
            label: hasNext ? t.next : t.toLobby,
            success: true,
            onClick: () =>
              hasNext ? this.gotoLevel(this.levelIndex + 1) : this.scene.start(SCENE_KEYS.lobby),
          },
          { label: t.replay, onClick: () => this.restart('button') },
        ],
      });
    });
  }

}
