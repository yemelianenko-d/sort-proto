import Phaser from 'phaser';
import { COLORS, FONTS, SCENE_KEYS } from '../../app/gameConfig';
import { UI_TEXTS } from '../../config/uiTexts';
import { GAME_SETTINGS } from '../../config/gameSettings';
import { BLOCKS_SETTINGS, BLOCKS_TILE_TINTS } from './blocksSettings';
import { eventBus } from '../../core/events/EventBus';
import type { GameController } from '../../core/game/GameController';
import { hasTexture } from '../../core/assets/AssetLoader';
import { PaperBackground } from '../../ui/sketch';
import { scatterDoodles, NEUTRAL_DOODLE_KEYS } from '../../ui/doodles';
import { drawBlueprintDoodles } from './blocksDoodles';

/** Blocks-themed doodles (geometry objects + block one-liners): scoped to
 * this mechanic only. scatterDoodles mixes them with the universal set. */
const BLOCKS_DOODLE_KEYS = Array.from(
  { length: 16 },
  (_, i) => `blocks/doodle_${String(i + 1).padStart(2, '0')}`,
);
import { Button } from '../../ui/Button';
import { Popup } from '../../ui/Popup';
import { ResponsiveContainer } from '../../ui/ResponsiveContainer';
import { storageGet, storageSet } from '../../core/utils/storage';
import { BlocksModel } from './BlocksModel';
import { BlocksView } from './BlocksView';
import { BlocksController } from './BlocksController';
import { PRAISE_RANK, type PraiseTier } from './blocksPraise';
import { blocksLevels } from './blocksLevels';
import { BLOCKS_ENDLESS_CONFIG } from './blocksEndless';
import { levelSeed, makeRng, resolveBucket } from './blocksRng';

interface SceneData {
  levelIndex: number;
  /** Arcade/endless mode (`?endless=1`): ignores levelIndex, uses the built-in
   * endless config, never wins — plays until the board dead-ends. */
  endless?: boolean;
}

/** localStorage key for the endless high score (mechanic-owned). */
const ENDLESS_BEST_KEY = 'blocks.endless.best';

/** Per-session booster wallet (prototype scope; resets on page load — like the
 * sorting wallet). Revive: on game over, clear the board and continue the run. */
const blocksWallet = { revives: GAME_SETTINGS.boosters.initialRevives };

/** Per-level attempt counter (session-scoped; resets on reload). Drives the
 * restart bucket so early retries share a learnable opening (Balance Spec §8). */
const attemptCounts = new Map<string, number>();

export class BlocksScene extends Phaser.Scene {
  private game_!: GameController;
  private model!: BlocksModel;
  private view!: BlocksView;
  private controller!: BlocksController;
  private levelIndex = 0;
  private endless = false;
  private endlessBest = 0;

  private paper!: PaperBackground;
  private doodles!: Phaser.GameObjects.Container;
  private doodleSeed = 0;
  private hudLevel!: Phaser.GameObjects.Text;
  /** Goal panel above the board: collect = symbol icons + remaining counts,
   * score = "Очки: S / T". */
  private hudGoal!: Phaser.GameObjects.Container;
  /** Each collect chip's icon x within hudGoal (target for the fly-out). */
  private chipLocalX = new Map<number, number>();
  private backBtn!: Button;
  private restartBtn!: Button;
  private fullscreenBtn: Button | null = null;
  private winBtn: Button | null = null;
  private popupOpen = false;

  constructor() {
    super(SCENE_KEYS.blocks);
  }

  init(data: Partial<SceneData>): void {
    this.levelIndex = data.levelIndex ?? 0;
    this.endless = data.endless ?? false;
  }

  create(): void {
    this.game_ = this.registry.get('game') as GameController;
    const config = this.endless ? BLOCKS_ENDLESS_CONFIG : blocksLevels.byIndex(this.levelIndex);
    if (!config) {
      const message = UI_TEXTS.error.levelNotFound(this.levelIndex);
      eventBus.emit('error_occurred', { stage: 'level_load', message });
      this.scene.start(SCENE_KEYS.error, { message });
      return;
    }
    if (this.endless) this.endlessBest = Number(storageGet(ENDLESS_BEST_KEY)) || 0;
    eventBus.emit('level_loaded', {
      level_id: config.id,
      level_index: this.levelIndex,
      difficulty: config.difficulty,
    });

    this.popupOpen = false;
    // Deterministic per-attempt seed (Balance Spec §8): same level+version+
    // bucket → same board, for replay/QA. Early attempts share the opening.
    const attemptIndex = (attemptCounts.get(config.id) ?? 0) + 1;
    attemptCounts.set(config.id, attemptIndex);
    const bucket = resolveBucket(attemptIndex, config.restartPolicy);
    // Campaign: deterministic per-attempt seed (replay/QA). Endless: a fresh
    // random seed every run so the arcade sequence is never the same twice.
    const seed = this.endless
      ? Math.floor(Math.random() * 2 ** 31) >>> 0
      : levelSeed(config.id, config.balanceVersion ?? 1, bucket);
    this.model = new BlocksModel(config, makeRng(seed).pieces);
    this.view = new BlocksView(this, this.model);
    this.controller = new BlocksController(this.model, this.view, {
      onStateChanged: () => this.refreshHud(),
      onWin: () => this.onWin(),
      onFail: () => this.onFail(),
      onCollected: (cells) => this.flyCollected(cells),
      onCombo: (chain) => this.showCombo(chain),
      onPraise: (tier) => this.showPraise(tier),
    });

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

    // Authored levels never deal a dead tray, but the guard keeps a random
    // edge case honest instead of soft-locking the scene.
    if (this.model.isFailed()) this.onFail();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.view.destroy();
    });
  }

  /* ---------------- onboarding ---------------- */

  private maybeShowTutorial(): void {
    if (this.game_.progress.isTutorialSeen('blocks_howto')) return;
    const t = UI_TEXTS.mechanics.blocks;
    this.popupOpen = true;
    new Popup(this, {
      variant: 'note',
      title: t.howtoTitle,
      body: t.howtoBody,
      actions: [
        {
          label: UI_TEXTS.tutorials.ok,
          success: true,
          onClick: () => {
            this.game_.progress.markTutorialSeen('blocks_howto');
            this.popupOpen = false;
          },
        },
      ],
    });
  }

  /* ---------------- layout / HUD ---------------- */

  private layout(w: number, h: number): void {
    const safe = this.game_.platform.device.safeArea();
    const sizes = GAME_SETTINGS.layoutSizes;
    const landscape = w > h;
    // portrait reserves a taller band (mechanic-owned) so the score/goal panel
    // clears the button row on narrow phones; shared hudHeight stays untouched.
    const hudHeight = landscape ? sizes.hudHeightLandscape : BLOCKS_SETTINGS.layout.hudBand;
    this.paper.resize(w, h);

    const top = safe.top + 8;
    this.hudLevel.setPosition(safe.left + 56, top + 4);
    this.backBtn.setPosition(safe.left + 30, top + 20);
    this.restartBtn.setPosition(w - safe.right - 30, top + 20);
    this.fullscreenBtn?.setPosition(w - safe.right - 82, top + 20);
    // cheat WIN sits under the restart button — never over the goal panel
    this.winBtn?.setPosition(w - safe.right - 30, top + 64);

    this.view.setArea(
      safe.left + 8,
      top + hudHeight,
      w - safe.left - safe.right - 16,
      h - top - hudHeight - safe.bottom - 8,
    );

    const board = this.view.contentBounds;
    // the goal panel sits above the board, clear of the blueprint dimension
    // line and its "8" label / datum circles (the enlarged compass is tall).
    // Subtract the board's applied drop so the panel stays put while the board
    // + tray + decor move down (developer: lower the field, not the panel).
    this.hudGoal.setPosition(w / 2, board.y - 86 - this.view.appliedDrop);
    // wider pad than usual: the board carries blueprint dimension lines
    const pad = 56;
    // Doodles must never sit under any HUD text: exclude the top bar, the goal
    // panel band above the board (its real bounds, padded), the board+tray, and
    // the bottom safe area.
    const goalB = this.hudGoal.getBounds();
    const goalRect =
      goalB.width > 4
        ? { x: goalB.x - 14, y: goalB.y - 10, w: goalB.width + 28, h: goalB.height + 20 }
        : { x: w / 2 - 150, y: board.y - 128, w: 300, h: 80 };
    const exclude = [
      { x: 0, y: 0, w, h: top + hudHeight },
      goalRect,
      { x: board.x - pad, y: board.y - pad, w: board.w + pad * 2, h: board.h + pad * 2 },
      { x: 0, y: h - safe.bottom - 24, w, h: safe.bottom + 24 },
    ];
    // blocks-themed doodles mixed with the NEUTRAL universal drawings only —
    // the sorting-flavoured text puns (deco_doodle_11..20) are excluded so
    // they never leak into this mechanic. Without the art: procedural motifs.
    if (BLOCKS_DOODLE_KEYS.some((k) => hasTexture(this, k))) {
      scatterDoodles(this, this.doodles, w, h, exclude, this.doodleSeed, 7, BLOCKS_DOODLE_KEYS, NEUTRAL_DOODLE_KEYS);
    } else {
      drawBlueprintDoodles(this, this.doodles, w, h, exclude, this.doodleSeed);
    }
  }

  private buildHud(): void {
    const t = UI_TEXTS.mechanics.blocks;

    this.hudLevel = this.add
      .text(0, 0, this.endless ? t.endlessName : t.level(this.levelIndex + 1), {
        fontFamily: FONTS.display,
        fontSize: '24px',
        color: COLORS.inkCss,
        padding: { x: 8, y: 6 },
      })
      .setOrigin(0, 0);
    this.hudGoal = this.add.container(0, 0);
    // The revive booster stays functional (charges in blocksWallet, "Continue"
    // on game over) but its counter is intentionally NOT shown on the game
    // screen — developer asked to remove the lives readout from play.

    this.backBtn = new Button(this, 0, 0, {
      width: 44,
      height: 44,
      label: UI_TEXTS.hud.back,
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
      label: UI_TEXTS.hud.restart,
      iconKey: 'icon_restart',
      iconOnly: true,
      onClick: () => this.confirmRestart(),
    });

    if (this.game_.settings.cheat && !this.endless) {
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
    // The goal panel is the only progress readout: score levels show the
    // score there; collect levels show the symbol chips. No standalone score.
    this.rebuildGoalChip();
    this.restartBtn.setEnabled(this.model.moves > 0 && !this.controller.isBusy);
  }

  /** Goal headline: for collect goals a row of chips (symbol icon + remaining
   * count) like the reference; for score goals the "Очки: N / T" line. */
  private rebuildGoalChip(): void {
    const t = UI_TEXTS.mechanics.blocks;
    this.hudGoal.removeAll(true);
    const progress = this.model.goalProgress();
    const style = {
      fontFamily: FONTS.display,
      fontSize: '36px',
      color: COLORS.inkCss,
      padding: { x: 8, y: 6 },
    };
    if (progress.type === 'score') {
      this.buildScoreBar(progress.score, progress.target);
      return;
    }

    if (progress.type === 'endless') {
      // live score (large) with the running best beneath it
      const best = Math.max(this.endlessBest, progress.score);
      this.hudGoal.add(this.add.text(0, -10, t.score(progress.score), style).setOrigin(0.5));
      this.hudGoal.add(
        this.add
          .text(0, 26, t.endlessBest(best), { ...style, fontSize: '22px', color: COLORS.pencilCss })
          .setOrigin(0.5),
      );
      return;
    }

    // collect: one chip per quota (symbol icon + remaining count), laid out
    // left-anchored within each chip, then the whole row centred. The compass
    // glyph is tall+narrow, so it gets a larger height to read at the same
    // visual weight as the others.
    const iconSize = 44;
    const iconScale = [1.4, 1, 1, 1, 1]; // per-symbol height multiplier
    const numGap = 8;
    const chipGap = 30;
    const chips = progress.quotas.map((q) => {
      const left = Math.max(0, q.count - q.collected);
      const node = this.add.container(0, 0);
      const iconKey = `blocks/symbol_${q.symbol}`;
      const iconH = iconSize * (iconScale[q.symbol] ?? 1);
      let iconW = iconH;
      if (hasTexture(this, iconKey)) {
        const fr = this.textures.getFrame(iconKey);
        iconW = iconH * (fr.width / fr.height);
        node.add(this.add.image(iconW / 2, 0, iconKey).setDisplaySize(iconW, iconH));
      } else {
        node.add(this.add.text(iconW / 2, 0, '◆', { ...style, color: COLORS.pencilCss }).setOrigin(0.5));
      }
      let numW: number;
      if (left === 0) {
        // done: the hand-drawn green check asset instead of "0" (procedural fallback)
        const chSize = iconH * 0.66;
        if (hasTexture(this, 'icon_check')) {
          const fr = this.textures.getFrame('icon_check');
          const cw = chSize * (fr.width / fr.height);
          node.add(this.add.image(iconW + numGap + cw / 2, 0, 'icon_check').setDisplaySize(cw, chSize));
          numW = cw;
        } else {
          node.add(this.drawCheck(iconW + numGap, 0, chSize));
          numW = chSize;
        }
      } else {
        const num = this.add.text(iconW + numGap, 1, String(left), style).setOrigin(0, 0.5);
        node.add(num);
        numW = num.width;
      }
      return { node, w: iconW + numGap + numW, symbol: q.symbol, iconCenter: iconW / 2 };
    });
    const totalW = chips.reduce((s, c) => s + c.w, 0) + chipGap * (chips.length - 1);
    let x = -totalW / 2;
    this.chipLocalX.clear();
    for (const chip of chips) {
      chip.node.setX(x);
      this.hudGoal.add(chip.node);
      this.chipLocalX.set(chip.symbol, x + chip.iconCenter); // fly-out target (local to hudGoal)
      x += chip.w + chipGap;
    }
  }

  /** A hand-drawn green check mark (notebook style), left-anchored at (x0, cy),
   * fitting a box of `size`. Two sketchy strokes with a soft double-pass. */
  private drawCheck(x0: number, cy: number, size: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    const s = size;
    // check geometry inside [0..s]: dip at ~40% width, up to the right
    const p1 = { x: x0 + s * 0.08, y: cy + s * 0.05 };
    const p2 = { x: x0 + s * 0.4, y: cy + s * 0.38 };
    const p3 = { x: x0 + s * 0.95, y: cy - s * 0.42 };
    const stroke = (w: number, alpha: number, dx = 0, dy = 0) => {
      g.lineStyle(w, 0x2e9e4f, alpha);
      g.beginPath();
      g.moveTo(p1.x + dx, p1.y + dy);
      g.lineTo(p2.x + dx, p2.y + dy);
      g.lineTo(p3.x + dx, p3.y + dy);
      g.strokePath();
    };
    stroke(Math.max(3, s * 0.16), 0.9); // main
    stroke(Math.max(2, s * 0.1), 0.5, 0.6, -0.6); // sketchy second pass
    return g;
  }

  private lastBarScore = -1;

  /** Panel-art layout fractions (printed by prepare-blocks-score-panel.mjs). */
  private static readonly SCORE_PANEL = {
    aspect: 0.1824,
    bubbleC: (0.0295 + 0.1288) / 2, // left square centre x
    targetC: (0.8289 + 0.9587) / 2, // right square centre x
    squareH: 0.8353 - 0.2206, // square height (fraction)
    trackY: 0.5382,
    trackX0: 0.1389,
    trackX1: 0.8283,
  };

  /**
   * Score-mode goal readout on the DRAWN ruler panel: the art frame + dashes +
   * track, with the game drawing filled circles over the two end squares (blue
   * = live score, cream/orange = target), crisp ruler ticks that stop before
   * the right circle, a progress fill and a sliding pin. Procedural fallback
   * if the art is missing. The score circle pulses when the score grew.
   */
  private buildScoreBar(score: number, target: number): void {
    const P = BlocksScene.SCORE_PANEL;
    const W = 384;
    const H = W * P.aspect;
    const ly = (fy: number) => (fy - 0.5) * H;
    const R = Math.round((P.squareH * H) / 2 + 3); // circle size follows the art square
    // circles are placed SYMMETRICALLY (same margin to both panel edges) —
    // the art squares sat asymmetrically, but they are erased now. Integer
    // centres keep the circle edges crisp (no sub-pixel smear).
    const edgeM = 14;
    const cxL = Math.round(-W / 2 + edgeM + R);
    const cxR = Math.round(W / 2 - edgeM - R);
    const ty = ly(P.trackY);
    // the scale runs BETWEEN the circles: starts a bit right of the blue one,
    // ends a bit left of the orange one — never overlapping either (2px wider)
    const x0 = cxL + R + 7.5; // scale widened 3px total (1.5 each end)
    const x1 = cxR - R - 7.5;
    const ratio = Math.min(score / target, 1);
    const px = x0 + (x1 - x0) * ratio;

    if (hasTexture(this, 'blocks/score_panel')) {
      this.hudGoal.add(this.add.image(0, 0, 'blocks/score_panel').setDisplaySize(W, H));
    }

    // title, centred between the two baked side dashes (no dot decorations)
    this.hudGoal.add(
      this.add
        .text(0, ly(0.24) + 3, UI_TEXTS.mechanics.blocks.scoreLabel, {
          fontFamily: FONTS.display,
          fontSize: '26px',
          color: COLORS.inkCss,
          fontStyle: 'bold',
          padding: { x: 4, y: 3 },
        })
        .setOrigin(0.5),
    );

    // the scale itself: base line + evenly spaced crisp ticks + fill + pin
    const g = this.add.graphics();
    g.lineStyle(3, COLORS.grid, 0.85);
    g.beginPath();
    g.moveTo(x0, ty);
    g.lineTo(x1, ty);
    g.strokePath();
    for (let i = 0; i <= 10; i++) {
      const tx = Math.round(x0 + ((x1 - x0) * i) / 10) + 0.5 - (i === 0 ? 2 : 0); // nudge left end tick 2px left
      const major = i % 5 === 0;
      const topExtend = i === 0 || i === 10 ? 8 : 0; // end ticks reach 8px higher
      g.lineStyle(major ? 2 : 1.5, COLORS.ink, major ? 0.7 : 0.5);
      g.beginPath();
      g.moveTo(tx, ty + 5 - topExtend);
      g.lineTo(tx, ty + (major ? 15 : 11));
      g.strokePath();
    }
    if (ratio > 0) {
      g.lineStyle(5, COLORS.grid, 0.95);
      g.beginPath();
      g.moveTo(x0, ty);
      g.lineTo(px, ty);
      g.strokePath();
    }
    g.fillStyle(COLORS.grid, 1);
    g.fillCircle(px, ty, 6);
    this.hudGoal.add(g);

    // digit style shared by both circles — white on the solid fill, centred
    // (a hair above geometric centre so the display font reads centred), with
    // symmetric padding so nothing clips
    const digitStyle = (n: number): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: FONTS.display,
      fontSize: n >= 1000 ? '19px' : '24px',
      color: '#ffffff',
      fontStyle: 'bold',
      padding: { x: 3, y: 3 },
    });

    // right (target) circle — SOLID orange fill now (was hollow), white digits.
    // Arc game objects render a clean anti-aliased disc (no jagged edges).
    this.hudGoal.add(this.add.circle(cxR, 0, R, COLORS.accentWarm).setStrokeStyle(3, 0xb5610a));
    this.hudGoal.add(this.add.text(cxR, -1, String(target), digitStyle(target)).setOrigin(0.5));

    // left (score) circle — solid blue fill, white digits (container so it can pulse)
    const scoreCircle = this.add.container(cxL, 0);
    scoreCircle.add(this.add.circle(0, 0, R, COLORS.grid).setStrokeStyle(3, COLORS.ink));
    scoreCircle.add(this.add.text(0, -1, String(score), digitStyle(score)).setOrigin(0.5));
    this.hudGoal.add(scoreCircle);

    if (score > this.lastBarScore && this.lastBarScore >= 0) {
      scoreCircle.setScale(1.22);
      this.tweens.add({ targets: scoreCircle, scale: 1, duration: 220, ease: 'Back.easeOut' });
    }
    this.lastBarScore = score;
  }

  /**
   * Collected specials fly from their board cells into the matching goal chip
   * (juice): a symbol token arcs up to the panel, then the panel pulses.
   */
  private flyCollected(cells: { symbol: number; row: number; col: number }[]): void {
    cells.forEach((cell, i) => {
      const localX = this.chipLocalX.get(cell.symbol);
      if (localX === undefined) return;
      const from = this.view.cellWorldXY(cell.row, cell.col);
      const to = { x: this.hudGoal.x + localX, y: this.hudGoal.y };
      const key = `blocks/symbol_${cell.symbol}`;
      const size = this.view.cellSize * 0.72;
      const token = hasTexture(this, key)
        ? this.add.image(from.x, from.y, key).setDepth(1500)
        : this.add
            .text(from.x, from.y, '◆', { fontFamily: FONTS.display, fontSize: '26px', color: COLORS.pencilCss })
            .setOrigin(0.5)
            .setDepth(1500);
      if (token instanceof Phaser.GameObjects.Image) {
        const fr = this.textures.getFrame(key);
        token.setDisplaySize(size * (fr.width / fr.height), size);
      }
      const s0 = token.scale;
      const delay = 90 + i * 90;
      // 1) lift a little above the board and grow; 2) hover briefly;
      // 3) then fly into the goal panel, shrinking; panel pulses on arrival.
      this.tweens.add({
        targets: token,
        y: from.y - this.view.cellSize * 0.7,
        scale: s0 * 1.4,
        duration: 240,
        delay,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.time.delayedCall(200, () => {
            this.tweens.add({
              targets: token,
              x: to.x,
              y: to.y,
              scale: s0 * 0.5,
              duration: 480,
              ease: 'Cubic.easeIn',
              onComplete: () => {
                token.destroy();
                this.pulseGoalPanel();
              },
            });
          });
        },
      });
    });
  }

  private pulseGoalPanel(): void {
    this.tweens.add({
      targets: this.hudGoal,
      scale: 1.12,
      duration: 90,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => this.hudGoal.setScale(1),
    });
  }

  private comboBadge: Phaser.GameObjects.Text | null = null;
  private praiseText: Phaser.GameObjects.Text | null = null;

  /**
   * Praise callout for a standout move (2/3/4+ lines, clean sheet): a big
   * hand-written word popping over the board centre, louder with rarity.
   * Deliberately stacks with the combo badge — the reference shows both.
   */
  private showPraise(tier: PraiseTier): void {
    const variants = UI_TEXTS.mechanics.blocks.praise[tier];
    const text = variants[this.model.moves % variants.length];
    const rank = PRAISE_RANK[tier];
    const board = this.view.contentBounds;
    const size = [0, 38, 44, 52, 58][rank];
    const color = tier === 'allClear' ? '#2e7a3f' : rank >= 3 ? '#d97b1f' : COLORS.inkCss;

    this.praiseText?.destroy();
    const badge = this.add
      .text(board.x + board.w / 2, board.y + board.h / 2, text, {
        fontFamily: FONTS.display,
        fontSize: `${size}px`,
        color,
        fontStyle: 'bold',
        stroke: '#fdfcf6',
        strokeThickness: 6,
        padding: { x: 10, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(1700)
      .setScale(0.4)
      .setAngle(rank >= 3 ? -6 : -3);
    this.praiseText = badge;
    this.tweens.add({ targets: badge, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: badge,
      y: badge.y - 46,
      alpha: 0,
      delay: 560 + rank * 90, // rarer praise lingers a beat longer
      duration: 420,
      ease: 'Sine.easeIn',
      onComplete: () => {
        badge.destroy();
        if (this.praiseText === badge) this.praiseText = null;
      },
    });
  }

  /** Brief "Combo N" feedback popping over the board on a chain of ≥2
   * (reference format: just the whole chain number, no multiplier). */
  private showCombo(chain: number): void {
    const board = this.view.contentBounds;
    this.comboBadge?.destroy();
    const badge = this.add
      .text(board.x + board.w / 2, board.y + this.view.cellSize * 1.4, UI_TEXTS.mechanics.blocks.combo(chain), {
        fontFamily: FONTS.display,
        fontSize: '34px',
        color: COLORS.accentWarm ? '#d97b1f' : COLORS.inkCss,
        fontStyle: 'bold',
        stroke: '#fdfcf6',
        strokeThickness: 5,
        padding: { x: 8, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(1600)
      .setScale(0.5)
      .setAngle(-4);
    this.comboBadge = badge;
    this.tweens.add({ targets: badge, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: badge,
      y: badge.y - this.view.cellSize * 0.8,
      alpha: 0,
      delay: 420,
      duration: 360,
      ease: 'Sine.easeIn',
      onComplete: () => {
        badge.destroy();
        if (this.comboBadge === badge) this.comboBadge = null;
      },
    });
  }

  /* ---------------- flow ---------------- */

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
      body: UI_TEXTS.mechanics.blocks.confirmBody,
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

  private confirmRestart(): void {
    if (this.popupOpen || this.model.moves === 0) return;
    this.popupOpen = true;
    const t = UI_TEXTS.restartConfirm;
    new Popup(this, {
      icon: 'icon_restart',
      emoji: '↺',
      title: t.title,
      body: UI_TEXTS.mechanics.blocks.confirmBody,
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
            this.restart();
          },
        },
      ],
    });
  }

  private restart(): void {
    eventBus.emit('level_restarted', {
      level_id: this.model.levelId,
      source: 'button',
      moves_count: this.model.moves,
    });
    eventBus.emit('restart_used', { level_id: this.model.levelId });
    this.scene.restart({ levelIndex: this.levelIndex, endless: this.endless } satisfies SceneData);
  }

  private gotoLevel(index: number): void {
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
    if (this.endless || this.popupOpen) return; // endless never "wins"
    this.popupOpen = true;

    const config = blocksLevels.byIndex(this.levelIndex)!;
    const moves = this.model.moves;
    const twoStarLimit = Math.ceil(config.par * GAME_SETTINGS.scoring.twoStarFactor);
    const stars = moves <= config.par ? 3 : moves <= twoStarLimit ? 2 : 1;

    eventBus.emit('level_completed', {
      level_id: config.id,
      difficulty: config.difficulty,
      moves_count: moves,
      duration_sec: this.game_.state.levelDurationSec(),
      stars,
      result: 'completed',
    });

    const t = UI_TEXTS.win;
    const tb = UI_TEXTS.mechanics.blocks;
    const hasNext = this.levelIndex + 1 < blocksLevels.count;
    // BB-style bright finish first (tile burst + confetti rain), THEN the
    // popup — it must not cover the fireworks. Also keeps the winning tap's
    // pointer-up away from the fresh "Next" button.
    this.playWinCelebration();
    this.time.delayedCall(1250, () => {
      new Popup(this, {
        title: t.title,
        stars,
        body: tb.winScore(this.model.score),
        note: stars < 3 ? { before: t.hintBefore, after: tb.winHintAfter(config.par) } : undefined,
        actions: [
          {
            label: hasNext ? t.next : t.toLobby,
            success: true,
            onClick: () =>
              hasNext ? this.gotoLevel(this.levelIndex + 1) : this.scene.start(SCENE_KEYS.lobby),
          },
          { label: t.replay, onClick: () => this.restart() },
        ],
      });
    });
  }

  /**
   * BB-style win celebration (reference: the level-complete transition rains
   * coloured square confetti while the board empties in a burst): every
   * remaining tile pops out of its cell in its OWN colour, radiating from the
   * board centre, while confetti squares fall across the whole screen.
   */
  private playWinCelebration(): void {
    const board = this.view.contentBounds;
    const cx = board.x + board.w / 2;
    const cy = board.y + board.h / 2;

    // 1) the board bursts: a coloured square flies out of every occupied cell.
    // The REAL tiles are hidden the moment the copies spawn — otherwise the
    // tile visibly "stays behind" while its copy flies away.
    this.view.hideBoardTiles();
    for (let r = 0; r < this.model.rows; r++) {
      for (let c = 0; c < this.model.cols; c++) {
        const cell = this.model.grid[r][c];
        if (!cell) continue;
        const { x, y } = this.view.cellWorldXY(r, c);
        const tint = cell.special !== undefined ? 0xf7b733 : (BLOCKS_TILE_TINTS[cell.color] ?? 0x9de27d);
        const s = this.view.cellSize * 0.72;
        const sq = this.add.rectangle(x, y, s, s, tint).setDepth(1650).setAlpha(0.95);
        const spread = 0.6 + Math.random() * 0.5;
        this.tweens.add({
          targets: sq,
          x: x + (x - cx) * spread + (Math.random() - 0.5) * 60,
          y: y + (y - cy) * spread - 60 - Math.random() * 80,
          angle: (Math.random() - 0.5) * 360,
          alpha: 0,
          scale: 0.4,
          delay: Math.hypot(x - cx, y - cy) * 0.9,
          duration: 620,
          ease: 'Cubic.easeOut',
          onComplete: () => sq.destroy(),
        });
      }
    }

    // 2) confetti rain across the screen (coloured squares, like the reference)
    const w = this.scale.width;
    const h = this.scale.height;
    for (let i = 0; i < 54; i++) {
      const size = 8 + Math.random() * 10;
      const tint = BLOCKS_TILE_TINTS[Math.floor(Math.random() * BLOCKS_TILE_TINTS.length)];
      const px = Math.random() * w;
      const sq = this.add
        .rectangle(px, -20 - Math.random() * 80, size, size, tint)
        .setDepth(1700)
        .setAngle(Math.random() * 360);
      this.tweens.add({
        targets: sq,
        y: h + 40,
        x: px + (Math.random() - 0.5) * 120,
        angle: sq.angle + (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360),
        delay: Math.random() * 350,
        duration: 950 + Math.random() * 650,
        ease: 'Sine.easeIn',
        onComplete: () => sq.destroy(),
      });
    }
  }

  private onFail(): void {
    if (this.popupOpen) return;
    this.popupOpen = true;
    const t = UI_TEXTS.mechanics.blocks;

    if (this.endless) {
      // arcade game over: commit the high score, then show final + best
      const score = this.model.score;
      const isNewBest = score > this.endlessBest;
      if (isNewBest) {
        this.endlessBest = score;
        storageSet(ENDLESS_BEST_KEY, String(score));
      }
      this.time.delayedCall(350, () => {
        new Popup(this, {
          icon: 'icon_restart',
          emoji: '∞',
          title: t.gameOverTitle,
          body: isNewBest ? `${t.gameOverScore(score)}\n${t.newBest}` : `${t.gameOverScore(score)}\n${t.gameOverBest(this.endlessBest)}`,
          actions: [
            ...this.reviveActions(),
            {
              label: UI_TEXTS.win.replay,
              success: this.reviveActions().length === 0,
              onClick: () => {
                this.popupOpen = false;
                this.restart();
              },
            },
            {
              label: UI_TEXTS.win.toLobby,
              onClick: () => {
                this.popupOpen = false;
                this.quitToLobby();
              },
            },
          ],
        });
      });
      return;
    }

    this.time.delayedCall(350, () => {
      new Popup(this, {
        icon: 'icon_restart',
        emoji: '↺',
        title: t.failTitle,
        body: t.failBody,
        actions: [
          ...this.reviveActions(),
          {
            label: UI_TEXTS.win.replay,
            success: this.reviveActions().length === 0,
            onClick: () => {
              this.popupOpen = false;
              this.restart();
            },
          },
          {
            label: UI_TEXTS.win.toLobby,
            onClick: () => {
              this.popupOpen = false;
              this.quitToLobby();
            },
          },
        ],
      });
    });
  }

  /** The Revive booster action for a game-over popup (empty when none left).
   * Reviving spends a charge, clears the board and continues the run. */
  private reviveActions(): { label: string; success?: boolean; onClick: () => void }[] {
    if (blocksWallet.revives <= 0) return [];
    return [
      {
        label: UI_TEXTS.mechanics.blocks.revive(blocksWallet.revives),
        success: true,
        onClick: () => this.doRevive(),
      },
    ];
  }

  private doRevive(): void {
    blocksWallet.revives -= 1;
    this.popupOpen = false;
    this.model.revive();
    this.view.rebuild({ refilled: true });
    this.refreshHud();
    eventBus.emit('booster_used', { level_id: this.model.levelId, booster: 'revive' });
  }
}
