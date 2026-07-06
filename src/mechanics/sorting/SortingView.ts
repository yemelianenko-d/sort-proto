import Phaser from 'phaser';
import { BLOCK_STYLES, COLORS, FONTS } from '../../app/gameConfig';
import { computeColumnLayout, type ColumnLayout, BLOCK_GAP } from '../../core/utils/layout';
import { strokeSketchRect, fillPattern } from '../../ui/sketch';
import { setContainerTapArea } from '../../ui/containerTapArea';
import { hasTexture, hasAnimation, nineSliceConfig } from '../../core/assets/AssetLoader';
import { ASSET_KEYS } from '../../core/assets/assetManifest';
import { UI_TEXTS } from '../../config/uiTexts';
import { GAME_SETTINGS } from '../../config/gameSettings';
import type { SortingModel } from './SortingModel';
import { SPECIAL } from './SortingTypes';
import type { SortingViewContract } from './SortingTypes';

const PAD = 8;

/**
 * Render layer of the sorting mechanic (notebook-sketch style).
 *
 * The view is a "dumb" renderer: it rebuilds from the model on demand and
 * plays short one-shot tweens for feedback. It never mutates the model.
 */
export class SortingView implements SortingViewContract {
  private root: Phaser.GameObjects.Container;
  private columnContainers: Phaser.GameObjects.Container[] = [];
  private blockContainers: Phaser.GameObjects.Container[][] = [];
  /** Chalk previews inside target columns, per column index (for the flash). */
  private targetGhosts = new Map<number, Phaser.GameObjects.Container[]>();
  private layout!: ColumnLayout;
  private area = { x: 0, y: 0, width: 0, height: 0 };

  onColumnPress: (index: number) => void = () => {};
  onColumnTap: (index: number) => void = () => {};
  onDragStart: (index: number) => boolean = () => false;
  onDrop: (index: number, target: number | null) => void = () => {};

  private gesture: {
    column: number;
    startX: number;
    startY: number;
    dragging: boolean;
    ghost: Phaser.GameObjects.Container | null;
  } | null = null;
  private moveHandler: (p: Phaser.Input.Pointer) => void;
  private upHandler: (p: Phaser.Input.Pointer) => void;

  constructor(
    private scene: Phaser.Scene,
    private model: SortingModel,
  ) {
    this.root = scene.add.container(0, 0);
    this.moveHandler = (p) => this.onPointerMove(p);
    this.upHandler = (p) => this.onPointerUp(p);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.moveHandler);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.upHandler);
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.moveHandler);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.upHandler);
    this.gesture?.ghost?.destroy(true);
    this.gesture = null;
    this.root.destroy(true);
    this.columnContainers = [];
    this.blockContainers = [];
  }

  /** Available rectangle for the board (between HUD and booster bar). */
  setArea(x: number, y: number, width: number, height: number): void {
    this.area = { x, y, width, height };
    this.rebuild();
  }

  get cellSize(): number {
    return this.layout?.cell ?? 48;
  }

  /* ---------------- building ---------------- */

  rebuild(
    opts: {
      selected?: number;
      landedColumn?: number;
      landedCount?: number;
      revealed?: number[];
      hideTopGroup?: number;
    } = {},
  ): void {
    this.clearPulse();
    this.root.removeAll(true);
    this.columnContainers = [];
    this.blockContainers = [];

    this.layout = computeColumnLayout({
      columnCount: this.model.columns.length,
      cap: this.model.cap,
      caps: this.model.columns.map((_, i) => this.model.capacity(i)),
      availWidth: this.area.width,
      availHeight: this.area.height,
      padding: PAD,
    });

    const selected = opts.selected ?? -1;
    const hideColumn = opts.hideTopGroup ?? -1;
    const hideCount = hideColumn >= 0 ? this.model.topGroup(hideColumn) : 0;
    const targets = selected >= 0 ? new Set(this.model.validTargets(selected)) : new Set<number>();

    this.targetGhosts.clear();
    this.model.columns.forEach((column, ci) => {
      const pos = this.layout.positions[ci];
      const container = this.scene.add.container(this.area.x + pos.x, this.area.y + pos.y);

      container.add(this.buildFrame(ci, selected === ci, targets.has(ci)));
      if (this.model.targetColor(ci) !== null) this.addTargetGhosts(container, ci);

      const liftGroup = selected === ci && hideColumn !== ci ? this.model.topGroup(ci) : 0;
      const blocks: Phaser.GameObjects.Container[] = [];
      column.forEach((block, bi) => {
        const b = this.buildBlock(block.hidden ? -1 : block.color);
        if (hideColumn === ci && bi >= column.length - hideCount) b.setVisible(false);
        const { x, y } = this.blockLocalPos(bi, ci);
        b.setPosition(x, y);
        if (liftGroup > 0 && bi >= column.length - liftGroup) {
          b.y -= 12;
          b.setScale(1.06);
        }
        if (opts.landedColumn === ci && bi >= column.length - (opts.landedCount ?? 0)) {
          const targetY = b.y;
          b.y = targetY - 22;
          b.setScale(0.92);
          this.scene.tweens.add({
            targets: b,
            y: targetY,
            scale: 1,
            duration: GAME_SETTINGS.animation.landDurationMs,
            ease: 'Back.easeOut',
          });
        }
        // "flip open" the block that just turned face-up
        if (opts.revealed?.includes(ci) && bi === column.length - 1 && !block.hidden) {
          b.scaleX = 0;
          this.scene.tweens.add({
            targets: b,
            scaleX: 1,
            duration: GAME_SETTINGS.animation.revealDurationMs,
            ease: 'Back.easeOut',
          });
        }
        container.add(b);
        blocks.push(b);
      });

      if (this.model.lockedColumn === ci) this.addLockDecor(container, ci);
      if (this.model.setLockedColumn === ci) this.addSetLockDecor(container, ci);
      if (this.model.isTaped(ci)) container.add(this.buildTapeOverlay());

      setContainerTapArea(container, this.layout.colWidth, this.layout.colHeights[ci], 'topLeft');
      container.on('pointerdown', (p: Phaser.Input.Pointer) => this.onColumnDown(ci, p));

      this.root.add(container);
      this.columnContainers.push(container);
      this.blockContainers.push(blocks);
    });
  }

  private blockLocalPos(blockIndex: number, columnIndex: number): { x: number; y: number } {
    const cell = this.layout.cell;
    return {
      x: PAD + cell / 2,
      y: this.layout.colHeights[columnIndex] - PAD - cell / 2 - blockIndex * (cell + BLOCK_GAP),
    };
  }

  /** Column frame: artist nine-slice per state, or the procedural sketch. */
  private buildFrame(
    columnIndex: number,
    isSelected: boolean,
    isTarget: boolean,
  ): Phaser.GameObjects.GameObject {
    const key = isSelected
      ? ASSET_KEYS.columnFrameSelected
      : isTarget
        ? ASSET_KEYS.columnFrameTarget
        : ASSET_KEYS.columnFrame;
    const fallbackKey = ASSET_KEYS.columnFrame;
    const exact = hasTexture(this.scene, key);
    const useKey = exact ? key : hasTexture(this.scene, fallbackKey) ? fallbackKey : null;
    if (useKey) {
      const ns = nineSliceConfig(this.scene, useKey);
      const slice = this.scene.add.nineslice(
        this.layout.colWidth / 2,
        this.layout.colHeights[columnIndex] / 2,
        useKey,
        undefined,
        this.layout.colWidth,
        this.layout.colHeights[columnIndex],
        ns.left,
        ns.right,
        ns.top,
        ns.bottom,
      );
      // State texture not delivered -> tint the base frame instead, so the
      // state stays visible (selected: warm, target: green).
      if (!exact) {
        if (isSelected) slice.setTint(0xffd9a0);
        else if (isTarget) slice.setTint(0xc4ecc9);
      }
      return slice;
    }
    const g = this.scene.add.graphics();
    this.drawFrameProcedural(g, columnIndex, isSelected, isTarget);
    return g;
  }

  private drawFrameProcedural(
    g: Phaser.GameObjects.Graphics,
    columnIndex: number,
    isSelected: boolean,
    isTarget: boolean,
  ): void {
    const w = this.layout.colWidth;
    const h = this.layout.colHeights[columnIndex];
    let fill = 0xffffff;
    let fillAlpha = 0.72;
    let stroke: number = COLORS.ink;
    if (isSelected) {
      fill = 0xfff2de;
      fillAlpha = 0.9;
      stroke = COLORS.accentWarm;
    } else if (isTarget) {
      fill = 0xe0f4e4;
      fillAlpha = 0.85;
      stroke = COLORS.accentGreen;
    }
    g.fillStyle(fill, fillAlpha);
    g.fillRoundedRect(1, 1, w - 2, h - 2, 8);
    // paper shadow
    g.fillStyle(COLORS.ink, 0.12);
    g.fillRoundedRect(4, h - 3, w - 6, 5, 3);
    strokeSketchRect(g, 0, 0, w, h, stroke, 2.5, 1.3, true);
    if (isTarget) {
      g.lineStyle(2.5, COLORS.accentGreen, 1);
      // little hand-drawn "drop here" arrow above the column
      const ax = w / 2;
      g.lineBetween(ax, -20, ax, -6);
      g.lineBetween(ax, -6, ax - 5, -12);
      g.lineBetween(ax, -6, ax + 5, -12);
    }
  }

  /** Tape strip across the top of a sealed (take-only) column. */
  private buildTapeOverlay(): Phaser.GameObjects.GameObject {
    if (hasTexture(this.scene, 'deco_tape')) {
      const img = this.scene.add.image(this.layout.colWidth / 2, 4, 'deco_tape').setAngle(-5);
      const frame = this.scene.textures.getFrame('deco_tape');
      img.setScale((this.layout.colWidth * 1.35) / frame.width);
      return img;
    }
    const g = this.scene.add.graphics();
    g.fillStyle(0xf2e3b5, 0.9);
    g.fillRect(-6, 2, this.layout.colWidth + 12, 14);
    return g;
  }

  private buildBlock(colorId: number): Phaser.GameObjects.Container {
    const cellSz = this.layout.cell;
    if (colorId === SPECIAL.INK) {
      const c = this.scene.add.container(0, 0);
      if (hasTexture(this.scene, 'block_ink')) {
        c.add(this.scene.add.image(0, 0, 'block_ink').setDisplaySize(cellSz, cellSz));
        return c;
      }
      const g = this.scene.add.graphics();
      g.fillStyle(0x3b3e49, 1);
      g.fillRoundedRect(-cellSz / 2 + 1, -cellSz / 2 + 1, cellSz - 2, cellSz - 2, cellSz / 3);
      strokeSketchRect(g, -cellSz / 2, -cellSz / 2, cellSz, cellSz, 0x23252d, 2.4, 1.6);
      c.add(g);
      return c;
    }
    if (colorId === SPECIAL.KEY) {
      const c = this.scene.add.container(0, 0);
      if (hasTexture(this.scene, 'block_key')) {
        c.add(this.scene.add.image(0, 0, 'block_key').setDisplaySize(cellSz, cellSz));
        return c;
      }
      const g = this.scene.add.graphics();
      g.fillStyle(0xfff6d8, 1);
      g.fillRoundedRect(-cellSz / 2 + 1, -cellSz / 2 + 1, cellSz - 2, cellSz - 2, 9);
      strokeSketchRect(g, -cellSz / 2, -cellSz / 2, cellSz, cellSz, 0xb8860b, 2.4, 1.2);
      c.add(g);
      if (hasTexture(this.scene, 'icon_key')) {
        c.add(this.scene.add.image(0, 0, 'icon_key').setDisplaySize(cellSz * 0.62, cellSz * 0.62));
      } else {
        c.add(
          this.scene.add
            .text(0, 0, '🔑', { fontSize: `${Math.round(cellSz * 0.5)}px` })
            .setOrigin(0.5),
        );
      }
      return c;
    }

    const cell = this.layout.cell;
    const c = this.scene.add.container(0, 0);
    const hidden = colorId < 0;

    // Artist skin: one baked texture per color (shape+pattern included).
    const skinKey = hidden ? ASSET_KEYS.blockHidden : ASSET_KEYS.block(colorId);
    if (hasTexture(this.scene, skinKey)) {
      const img = this.scene.add.image(0, 0, skinKey).setDisplaySize(cell, cell);
      c.add(img);
      return c;
    }

    const g = this.scene.add.graphics();
    const style = hidden ? null : BLOCK_STYLES[colorId];

    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(-cell / 2 + 1, -cell / 2 + 1, cell - 2, cell - 2, 9);
    g.fillStyle(COLORS.ink, 0.16);
    g.fillRoundedRect(-cell / 2 + 3, cell / 2 - 3, cell - 5, 4, 2);
    if (style) {
      fillPattern(g, -cell / 2 + 3, -cell / 2 + 3, cell - 6, cell - 6, style.pattern, style.ink);
      strokeSketchRect(g, -cell / 2, -cell / 2, cell, cell, style.ink, 2.5, 1.2);
    } else {
      fillPattern(g, -cell / 2 + 3, -cell / 2 + 3, cell - 6, cell - 6, 'stripes', 0x8a8fa3);
      strokeSketchRect(g, -cell / 2, -cell / 2, cell, cell, 0x4a4f63, 2.2, 1.2);
    }
    c.add(g);

    const glyph = this.scene.add
      .text(0, 0, hidden ? '?' : (style?.glyph ?? '?'), {
        fontFamily: FONTS.display,
        fontSize: `${Math.round(cell * 0.56)}px`,
        color: hidden ? '#4a4f63' : Phaser.Display.Color.IntegerToColor(style!.ink).rgba,
        stroke: '#ffffff',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    c.add(glyph);
    return c;
  }

  /** Faint chalk preview of the future set inside an (empty) target column. */
  private addTargetGhosts(container: Phaser.GameObjects.Container, ci: number): void {
    const color = this.model.targetColor(ci);
    if (color === null) return;
    const ghosts: Phaser.GameObjects.Container[] = [];
    for (let i = 0; i < this.model.capacity(ci); i++) {
      const g = this.buildBlock(color);
      const { x, y } = this.blockLocalPos(i, ci);
      g.setPosition(x, y).setAlpha(GAME_SETTINGS.targetColumn.ghostAlpha);
      container.add(g);
      ghosts.push(g);
    }
    this.targetGhosts.set(ci, ghosts);
  }

  /** Wrong color tapped into a target column: the pattern briefly brightens. */
  flashTargetHint(ci: number): void {
    const ghosts = this.targetGhosts.get(ci);
    if (!ghosts) return;
    for (const g of ghosts) {
      this.scene.tweens.add({
        targets: g,
        alpha: GAME_SETTINGS.targetColumn.flashAlpha,
        duration: 110,
        yoyo: true,
        repeat: 1,
        onComplete: () => g.setAlpha(GAME_SETTINGS.targetColumn.ghostAlpha),
      });
    }
  }

  /** Star badge on the set-locked column: complete N sets to open it. */
  private addSetLockDecor(container: Phaser.GameObjects.Container, ci: number): void {
    const colH = this.layout.colHeights[ci];
    const cx = this.layout.colWidth / 2;
    const stars = '\u2605'.repeat(Math.max(1, this.model.setsLeft));
    container.add(
      this.scene.add
        .text(cx, colH / 2, stars, {
          fontFamily: FONTS.body,
          fontSize: '22px',
          color: COLORS.pencilCss,
        })
        .setOrigin(0.5),
    );
  }

  private addLockDecor(container: Phaser.GameObjects.Container, ci: number): void {
    const colH = this.layout.colHeights[ci];
    const cx = this.layout.colWidth / 2;

    // Key-block levels use the artist badge on the top edge (the "dig out the
    // key" combo look); a plain locked column keeps the classic centered lock.
    const hasKeyBlock = this.model.hasBlockOfColor(SPECIAL.KEY);
    if (hasKeyBlock && hasTexture(this.scene, 'icon_lock_col')) {
      // one badge per remaining lock, side by side on the top edge
      const frame = this.scene.textures.getFrame('icon_lock_col');
      const n = Math.max(1, this.model.locksLeft);
      const w = this.layout.colWidth * (n > 1 ? 0.32 : 0.4);
      const spacing = this.layout.colWidth * 0.36;
      for (let k = 0; k < n; k++) {
        container.add(
          this.scene.add
            .image(cx + (k - (n - 1) / 2) * spacing, 6, 'icon_lock_col')
            .setOrigin(0.5, 0.62)
            .setDisplaySize(w, (w * frame.height) / frame.width),
        );
      }
    } else if (hasTexture(this.scene, ASSET_KEYS.iconLock)) {
      container.add(
        this.scene.add.image(cx, colH / 2, ASSET_KEYS.iconLock).setDisplaySize(30, 30),
      );
    } else {
      container.add(
        this.scene.add.text(cx, colH / 2, '🔒', { fontSize: '24px' }).setOrigin(0.5),
      );
    }
    const badges = hasKeyBlock && hasTexture(this.scene, 'icon_lock_col');
    if (!badges && this.model.locksLeft > 1) {
      container.add(
        this.scene.add
          .text(cx + 16, colH / 2 + 12, `×${this.model.locksLeft}`, {
            fontFamily: FONTS.body,
            fontSize: '14px',
            color: COLORS.inkCss,
          })
          .setOrigin(0.5),
      );
    }

    // sticky tag under the column: the same key icon as the booster button
    if (hasTexture(this.scene, 'icon_key')) {
      const tag = this.scene.add.container(cx, colH + 15).setAngle(-2);
      const label = this.scene.add
        .text(0, 0, UI_TEXTS.locked.tagText, {
          fontFamily: FONTS.body,
          fontSize: '13px',
          color: COLORS.inkCss,
        })
        .setOrigin(0, 0.5);
      const iconSize = 15;
      const gap = 4;
      const totalW = iconSize + gap + label.width;
      const bg = this.scene.add.graphics();
      bg.fillStyle(0xfff3b0, 1);
      bg.fillRoundedRect(-totalW / 2 - 6, -11, totalW + 12, 22, 5);
      const icon = this.scene.add
        .image(-totalW / 2 + iconSize / 2, 0, 'icon_key')
        .setDisplaySize(iconSize, iconSize);
      label.setX(-totalW / 2 + iconSize + gap);
      tag.add([bg, icon, label]);
      container.add(tag);
    } else {
      container.add(
        this.scene.add
          .text(cx, colH + 4, UI_TEXTS.locked.tag, {
            fontFamily: FONTS.body,
            fontSize: '13px',
            color: COLORS.inkCss,
            backgroundColor: '#fff3b0',
            padding: { x: 6, y: 1 },
          })
          .setOrigin(0.5, 0)
          .setAngle(-2),
      );
    }
  }

  /* ---------------- gestures: tap + drag & drop ---------------- */

  private onColumnDown(index: number, pointer: Phaser.Input.Pointer): void {
    this.onColumnPress(index);
    // press could have triggered an instant move (fast tap-to-place);
    // still arm a potential drag for this column
    this.gesture = {
      column: index,
      startX: pointer.x,
      startY: pointer.y,
      dragging: false,
      ghost: null,
    };
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const g = this.gesture;
    if (!g) return;
    if (!g.dragging) {
      const travel = Math.hypot(pointer.x - g.startX, pointer.y - g.startY);
      if (travel < GAME_SETTINGS.input.dragThresholdPx) return;
      if (!this.onDragStart(g.column)) {
        this.gesture = null;
        return;
      }
      g.dragging = true;
      g.ghost = this.buildGhost(g.column);
    }
    g.ghost?.setPosition(pointer.x, pointer.y);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    if (!g.dragging) {
      this.onColumnTap(g.column);
      return;
    }
    g.ghost?.destroy(true);
    this.onDrop(g.column, this.columnAt(pointer.x, pointer.y));
  }

  /** Floating copy of the dragged top group, following the pointer. */
  private buildGhost(column: number): Phaser.GameObjects.Container {
    const count = this.model.topGroup(column);
    const col = this.model.columns[column];
    const cell = this.layout.cell;
    const ghost = this.scene.add.container(0, 0).setDepth(900);
    for (let i = 0; i < count; i++) {
      const block = col[col.length - count + i];
      const b = this.buildBlock(block.hidden ? -1 : block.color);
      b.setPosition(0, -i * (cell + BLOCK_GAP) - cell * 0.35);
      b.setScale(1.06);
      ghost.add(b);
    }
    ghost.setAlpha(0.92);
    return ghost;
  }

  /** Column whose frame contains the point (small forgiveness margin). */
  private columnAt(x: number, y: number): number | null {
    const margin = 10;
    for (let ci = 0; ci < this.layout.positions.length; ci++) {
      const px = this.area.x + this.layout.positions[ci].x;
      const py = this.area.y + this.layout.positions[ci].y;
      if (
        x >= px - margin &&
        x <= px + this.layout.colWidth + margin &&
        y >= py - margin &&
        y <= py + this.layout.colHeights[ci] + margin
      ) {
        return ci;
      }
    }
    return null;
  }

  /* ---------------- animations ---------------- */

  /** "Erased with a rubber" clear animation, then callback. */
  animateClear(columnIndex: number, onDone: () => void): void {
    const blocks = this.blockContainers[columnIndex] ?? [];
    if (blocks.length === 0) {
      onDone();
      return;
    }
    this.spawnSparks(columnIndex);

    // Artist clear animation: sprite overlay per block, blocks hide instantly.
    if (hasAnimation(this.scene, ASSET_KEYS.animBlockClear)) {
      const col = this.columnContainers[columnIndex];
      let finished = 0;
      blocks.forEach((b, i) => {
        b.setVisible(false);
        const fx = this.scene.add
          .sprite(col.x + b.x, col.y + b.y, '__DEFAULT')
          .setDisplaySize(this.layout.cell * 1.2, this.layout.cell * 1.2)
          .setDepth(400);
        fx.play({ key: ASSET_KEYS.animBlockClear, delay: i * GAME_SETTINGS.animation.clearBlockStaggerMs });
        fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          fx.destroy();
          finished += 1;
          if (finished === blocks.length) onDone();
        });
      });
      return;
    }

    let finished = 0;
    blocks.forEach((b, i) => {
      this.scene.tweens.add({
        targets: b,
        alpha: 0,
        scale: 0.88,
        angle: 4,
        duration: GAME_SETTINGS.animation.clearBlockDurationMs,
        delay: i * GAME_SETTINGS.animation.clearBlockStaggerMs,
        ease: 'Sine.easeIn',
        onComplete: () => {
          finished += 1;
          if (finished === blocks.length) onDone();
        },
      });
    });
  }

  shakeColumn(columnIndex: number): void {
    const c = this.columnContainers[columnIndex];
    if (!c) return;
    const baseX = c.x;
    this.scene.tweens.add({
      targets: c,
      x: baseX - 5,
      yoyo: true,
      repeat: 2,
      duration: GAME_SETTINGS.animation.shakeDurationMs,
      onComplete: () => {
        c.x = baseX;
      },
    });
  }

  private pulseTween: Phaser.Tweens.Tween | null = null;
  private pulseTarget: Phaser.GameObjects.Container | null = null;

  /** Beginner hint: softly pulse a column until any interaction. */
  pulseColumn(columnIndex: number): void {
    this.clearPulse();
    const c = this.columnContainers[columnIndex];
    if (!c) return;
    this.pulseTarget = c;
    this.pulseTween = this.scene.tweens.add({
      targets: c,
      scale: 1.06,
      yoyo: true,
      repeat: -1,
      duration: GAME_SETTINGS.animation.pulseDurationMs,
      ease: 'Sine.easeInOut',
    });
  }

  clearPulse(): void {
    if (this.pulseTween) {
      this.pulseTween.stop();
      this.pulseTween = null;
    }
    if (this.pulseTarget && this.pulseTarget.active) {
      this.pulseTarget.setScale(1);
    }
    this.pulseTarget = null;
  }

  private spawnSparks(columnIndex: number): void {
    const c = this.columnContainers[columnIndex];
    if (!c) return;

    if (hasAnimation(this.scene, ASSET_KEYS.animSparkle)) {
      const fx = this.scene.add
        .sprite(c.x + this.layout.colWidth / 2, c.y + this.layout.colHeight / 3, '__DEFAULT')
        .setDepth(500);
      fx.play(ASSET_KEYS.animSparkle);
      fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.destroy());
      return;
    }

    const glyphs = ['✳', '✦', '✧', '＊'];
    for (let i = 0; i < GAME_SETTINGS.animation.sparkCount; i++) {
      const s = this.scene.add
        .text(c.x + this.layout.colWidth / 2, c.y + this.layout.colHeight / 3, glyphs[i % 4], {
          fontFamily: FONTS.display,
          fontSize: '18px',
          color: COLORS.inkCss,
        })
        .setOrigin(0.5)
        .setDepth(500);
      this.scene.tweens.add({
        targets: s,
        x: s.x + Phaser.Math.Between(-70, 70),
        y: s.y + Phaser.Math.Between(-110, -30),
        alpha: 0,
        scale: 0.4,
        angle: Phaser.Math.Between(-40, 40),
        duration: GAME_SETTINGS.animation.sparkDurationMs,
        ease: 'Sine.easeOut',
        onComplete: () => s.destroy(),
      });
    }
  }
}
