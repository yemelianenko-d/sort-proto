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
import { Popup, type PopupAction } from '../../ui/Popup';
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
};

type TutorialId = 'howto' | 'hidden' | 'locked' | 'ink' | 'keyblock' | 'taped';

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
  private popupOpen = false;
  private plusLensBtn: Button | null = null;
  private plusKeyBtn: Button | null = null;
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
        onDeadlock: (canOfferKey) => this.onDeadlock(canOfferKey),
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
    if (!seen('howto')) id = 'howto';
    else if (m.hasHiddenBlocks() && !seen('hidden')) id = 'hidden';
    else if (m.lockedColumn !== null && !m.hasBlockOfColor(SPECIAL.KEY) && !seen('locked')) id = 'locked';
    else if (m.hasBlockOfColor(SPECIAL.INK) && !seen('ink')) id = 'ink';
    else if (m.hasBlockOfColor(SPECIAL.KEY) && !seen('keyblock')) id = 'keyblock';
    else if (m.hasTapedColumns() && !seen('taped')) id = 'taped';
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

    // спецмеханіки: власні міні-сцени
    if (id === 'ink') {
      const cellSz = 34;
      const gg = this.add.graphics();
      gg.fillStyle(0x3b3e49, 1);
      gg.fillRoundedRect(-cellSz / 2, -cellSz / 2, cellSz, cellSz, 11);
      gg.lineStyle(2.2, 0x23252d, 1);
      gg.strokeRoundedRect(-cellSz / 2, -cellSz / 2, cellSz, cellSz, 11);
      gg.setPosition(-58, 6);
      node.add(gg);
      // пунктирна дуга до колонки (та сама, що в howto)
      g.lineStyle(2.6, COLORS.ink, 0.9);
      const pts = 9;
      for (let i = 0; i < pts; i += 2) {
        const t0 = i / pts;
        const t1 = (i + 1) / pts;
        const px = (tt: number) => -38 + tt * 74;
        const pyf = (tt: number) => 2 - Math.sin(tt * Math.PI) * 22;
        g.lineBetween(px(t0), pyf(t0), px(t1), pyf(t1));
      }
      g.lineBetween(36, 2, 29, -6);
      g.lineBetween(36, 2, 27, 3);
      node.add(g);
      if (hasTexture(this, 'col_frame')) {
        node.add(this.add.image(58, 4, 'col_frame').setDisplaySize(30, 74));
      }
      return { node, height: 84 };
    }
    if (id === 'keyblock') {
      if (hasTexture(this, 'icon_key')) node.add(this.add.image(-50, 6, 'icon_key').setDisplaySize(30, 30));
      g.lineStyle(2.6, COLORS.ink, 0.9);
      for (let x = -28; x < 26; x += 12) g.lineBetween(x, 6, x + 6, 6);
      g.lineBetween(30, 6, 22, 0);
      g.lineBetween(30, 6, 22, 12);
      node.add(g);
      if (hasTexture(this, 'col_frame')) node.add(this.add.image(56, 4, 'col_frame').setDisplaySize(30, 74));
      if (hasTexture(this, 'icon_lock')) node.add(this.add.image(56, 4, 'icon_lock').setDisplaySize(18, 18));
      return { node, height: 84 };
    }
    if (id === 'taped') {
      if (hasTexture(this, 'col_frame')) node.add(this.add.image(0, 6, 'col_frame').setDisplaySize(34, 80));
      if (hasTexture(this, 'deco_tape')) {
        const tape = this.add.image(0, -26, 'deco_tape').setAngle(-20);
        const frame = this.textures.getFrame('deco_tape');
        tape.setScale(48 / frame.width);
        node.add(tape);
      }
      return { node, height: 92 };
    }

    const blockKey = id === 'hidden' ? 'block_hidden' : 'block_0';
    const block = hasTexture(this, blockKey)
      ? this.add.image(-58, 6, blockKey).setDisplaySize(36, 36)
      : this.add.text(-58, 6, '■', { fontSize: '30px' }).setOrigin(0.5);
    node.add(block);

    // пунктирна стрілка-дуга
    g.lineStyle(2.6, COLORS.ink, 0.9);
    const pts = 9;
    for (let i = 0; i < pts; i += 2) {
      const t0 = i / pts;
      const t1 = (i + 1) / pts;
      const px = (tt: number) => -38 + tt * 74;
      const pyf = (tt: number) => 2 - Math.sin(tt * Math.PI) * 22;
      g.lineBetween(px(t0), pyf(t0), px(t1), pyf(t1));
    }
    g.lineBetween(36, 2, 29, -6);
    g.lineBetween(36, 2, 27, 3);
    node.add(g);

    if (hasTexture(this, 'col_frame')) {
      node.add(this.add.image(58, 4, 'col_frame').setDisplaySize(30, 74));
    }
    if (id === 'locked') {
      const lockKey = hasTexture(this, 'icon_lock') ? 'icon_lock' : null;
      if (lockKey) node.add(this.add.image(58, 4, lockKey).setDisplaySize(18, 18));
      if (hasTexture(this, 'icon_key')) node.add(this.add.image(58, 44, 'icon_key').setDisplaySize(16, 16));
    }
    if (id === 'hidden' && hasTexture(this, 'icon_lens')) {
      node.add(this.add.image(-58, 44, 'icon_lens').setDisplaySize(17, 17));
    }
    return { node, height: 84 };
  }

  /** Beginner idle hint: after a pause on the first levels, pulse a source. */
  private scheduleNudge(): void {
    this.cancelNudge();
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
    const { hudHeight, boosterBarHeight } = GAME_SETTINGS.layoutSizes;
    this.paper.resize(w, h);

    const top = safe.top + 8;
    this.hudLevel.setPosition(safe.left + 56, top + 4);
    this.hudMoves.setPosition(w - safe.right - 60, top + 4);
    this.backBtn.setPosition(safe.left + 30, top + 20);
    this.restartBtn.setPosition(w - safe.right - 30, top + 20);


    const bottomY = h - safe.bottom - boosterBarHeight / 2;
    this.undoBtn.setPosition(w / 2 - 88, bottomY);
    this.lensBtn.setPosition(w / 2, bottomY);
    this.keyBtn.setPosition(w / 2 + 88, bottomY);
    this.plusLensBtn?.setPosition(w / 2 + 44, bottomY - 24);
    this.plusKeyBtn?.setPosition(w / 2 + 132, bottomY - 24);
    this.winBtn?.setPosition(w / 2, top + 24);

    this.view.setArea(
      safe.left + 8,
      top + hudHeight,
      w - safe.left - safe.right - 16,
      h - top - hudHeight - boosterBarHeight - safe.bottom - 8,
    );

    // дудли лише на бічних полях (на телефоні їх немає — і не треба)
    const boardH = h - top - hudHeight - boosterBarHeight - safe.bottom - 8;
    scatterDoodles(this, this.doodles, w, h, [
      { x: 0, y: 0, w, h: top + hudHeight },
      { x: w / 2 - 260, y: top + hudHeight - 10, w: 520, h: boardH + 20 },
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
      .setOrigin(1, 0);

    this.backBtn = new Button(this, 0, 0, {
      width: 44,
      height: 44,
      label: t.back,
      iconKey: 'icon_back',
      iconOnly: true,
      onClick: () => this.quitToLobby(),
    });
    this.restartBtn = new Button(this, 0, 0, {
      width: 44,
      height: 44,
      label: t.restart,
      iconKey: 'icon_restart',
      iconOnly: true,
      onClick: () => this.restart('button'),
    });

    this.undoBtn = new Button(this, 0, 0, {
      width: 76,
      height: 52,
      label: t.undo,
      fontSize: 19,
      iconKey: 'icon_undo',
      iconOnly: true,
      light: true,
      onClick: () => {
        this.controller.undo();
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
    this.undoBtn.setEnabled(this.model.canUndo && !this.controller.isBusy);
    this.lensBtn
      .setLabel(hasTexture(this, 'icon_lens') ? t.countOnly(wallet.lenses) : t.lens(wallet.lenses))
      .setEnabled(wallet.lenses > 0 && this.model.hasHiddenBlocks() && !this.controller.isBusy);
    this.keyBtn
      .setLabel(hasTexture(this, 'icon_key') ? t.countOnly(wallet.keys) : t.key(wallet.keys))
      .setEnabled(wallet.keys > 0 && this.model.lockedColumn !== null);
    this.scheduleNudge();
  }

  /* ---------------- flow ---------------- */

  restart(source: 'button' | 'deadlock' | 'debug'): void {
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
  }

  private onDeadlock(canOfferKey: boolean): void {
    if (this.popupOpen) return;
    this.popupOpen = true;

    const t = UI_TEXTS.deadlock;
    const actions: PopupAction[] = [];
    if (this.model.canUndo) {
      actions.push({
        label: t.undo,
        primary: true,
        onClick: () => {
          this.popupOpen = false;
          this.controller.undo();
        },
      });
    }
    if (canOfferKey) {
      actions.push({
        label: t.useKey,
        primary: actions.length === 0,
        onClick: () => {
          this.popupOpen = false;
          if (wallet.keys > 0 && this.controller.useKey()) wallet.keys -= 1;
          this.refreshHud();
        },
      });
    }
    actions.push({ label: t.restart, onClick: () => this.restart('deadlock') });

    new Popup(this, {
      emoji: '🤔',
      title: t.title,
      body: t.body,
      actions,
    });
  }
}
