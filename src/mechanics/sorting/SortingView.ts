import Phaser from 'phaser';
import { toLogical } from '../../core/utils/hidpi';
import { BLOCK_STYLES, BLOCK_TINTS, COLORS, FONTS } from '../../app/gameConfig';
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
  /** Tape overlays per taped column index (for the reject wiggle). */
  private tapeOverlays = new Map<number, Phaser.GameObjects.GameObject>();
  /** Done-column tape containers, kept so the completion can animate them. */
  private doneTapes = new Map<number, Phaser.GameObjects.Container>();
  /** Data for the just-removed seal so the break animation can rebuild it
   * fresh (never a live object that a rebuild could destroy mid-tween). */
  private ghostChain: { column: number; index: number; value: number } | null = null;
  /** Seal emblem bands per sealed column (for the reject rattle). */
  private chainSprites = new Map<number, Phaser.GameObjects.Container[]>();
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
  /** Cached slot permutation (presentational). Computed once per level while
   * the locked column is still locked, then reused on every rebuild — so
   * unlocking a column can't reshuffle the board. */
  private displayPerm: number[] | null = null;
  private displayPermKey = '';

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

  /** World-space bounds of the actual columns (for doodle exclusion). */
  get contentBounds(): { x: number; y: number; w: number; h: number } {
    const l = this.layout;
    if (!l || l.positions.length === 0) {
      return { x: this.area.x, y: this.area.y, w: this.area.width, h: this.area.height };
    }
    const xs = l.positions.map((p) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + l.colWidth;
    const maxH = Math.max(...l.colHeights);
    const minY = Math.min(...l.positions.map((p) => p.y));
    return { x: this.area.x + minX, y: this.area.y + minY, w: maxX - minX, h: maxH };
  }

  /* ---------------- building ---------------- */

  rebuild(
    opts: {
      selected?: number;
      landedColumn?: number;
      landedCount?: number;
      revealed?: number[];
      hideTopGroup?: number;
      ghostChain?: { column: number; value: number; index: number };
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
    this.applyDisplayPermutation();

    const selected = opts.selected ?? -1;
    const hideColumn = opts.hideTopGroup ?? -1;
    const hideCount = hideColumn >= 0 ? this.model.topGroup(hideColumn) : 0;
    const targets = selected >= 0 ? new Set(this.model.validTargets(selected)) : new Set<number>();

    this.targetGhosts.clear();
    this.tapeOverlays.clear();
    this.doneTapes.clear();
    this.chainSprites.clear();
    // A break move's rebuild records the ghost; later bare rebuilds (e.g. from
    // markColumnDone) must NOT wipe it, or the break animation is lost.
    if (opts.ghostChain) this.ghostChain = { ...opts.ghostChain };
    this.model.columns.forEach((column, ci) => {
      const pos = this.layout.positions[ci];
      const container = this.scene.add.container(this.area.x + pos.x, this.area.y + pos.y);

      container.add(this.buildFrame(ci, selected === ci, targets.has(ci)));
      if (this.model.targetColor(ci) !== null && !this.isColumnDone(ci)) {
        this.addTargetGhosts(container, ci);
      }

      const liftGroup = selected === ci && hideColumn !== ci ? this.model.topGroup(ci) : 0;
      // vault: blocks inside a still-closed locked/chained column are visible
      // but disabled — faded so "you can see it, you can't touch it" reads
      const vaulted = this.model.lockedColumn === ci || this.model.isSealed(ci);
      const blocks: Phaser.GameObjects.Container[] = [];
      column.forEach((block, bi) => {
        const b = this.buildBlock(block.hidden ? -1 : block.color);
        if (vaulted) b.setAlpha(0.55);
        if (hideColumn === ci && bi >= column.length - hideCount) b.setVisible(false);
        const { x, y } = this.blockLocalPos(bi, ci);
        b.setPosition(x, y);
        if (liftGroup > 0 && bi >= column.length - liftGroup) {
          b.y -= 12;
          b.setScale(1.03);
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
      if (this.model.isSealed(ci)) this.addChainDecor(container, ci);
      if (this.model.isTaped(ci)) {
        const tape = this.buildTapeOverlay();
        container.add(tape);
        this.tapeOverlays.set(ci, tape);
      }
      // done clip sits IN FRONT, clamped over the top edge (loop above, arms
      // over the first block) — added last so it renders on top
      if (this.isColumnDone(ci)) this.addDoneTape(container, ci);

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
  /** Shuffles which board slot each column occupies, seeded by the level id.
   * The generator appends special columns (locked, chained, empties) in a
   * fixed order, so without this the mechanics always sit on the same board
   * positions. Purely presentational: `layout.positions[ci]` still answers
   * "where does column ci live", so game logic and input are untouched. */
  private applyDisplayPermutation(): void {
    const n = this.layout.positions.length;
    if (n <= 2) return;
    const key = `${this.model.levelId}:${n}`;
    if (this.displayPermKey !== key || !this.displayPerm) {
      this.displayPerm = this.computeDisplayPermutation(n);
      this.displayPermKey = key;
    }
    const slotOf = this.displayPerm;
    this.layout = {
      ...this.layout,
      positions: slotOf.map((s) => this.layout.positions[s]),
      colHeights: slotOf.map((s) => this.layout.colHeights[s]),
    };
  }

  /** Builds the presentational slot permutation for the level. Deterministic
   * from the level id, with the locked (key) column pinned to the right edge.
   * Called once (while the column is still locked) and cached by the caller;
   * recomputing after an unlock would drop the pin and visibly reshuffle. */
  private computeDisplayPermutation(n: number): number[] {
    let seed = 0;
    const id = this.model.levelId;
    for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) | 0;
    const rnd = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const slotOf = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [slotOf[i], slotOf[j]] = [slotOf[j], slotOf[i]];
    }
    // convention: the locked (key) column always sits on the right edge, so
    // the player learns where the access objective lives. Find the rightmost
    // board slot (max x, bottom row on tie) and force the locked column onto
    // it, swapping whichever column currently holds it.
    const locked = this.model.lockedColumn;
    if (locked !== null && locked >= 0 && locked < n) {
      let rightSlot = 0;
      for (let s = 1; s < n; s++) {
        const p = this.layout.positions[s];
        const b = this.layout.positions[rightSlot];
        if (p.x > b.x + 0.5 || (Math.abs(p.x - b.x) <= 0.5 && p.y > b.y)) rightSlot = s;
      }
      const cur = slotOf[locked];
      if (cur !== rightSlot) {
        const other = slotOf.indexOf(rightSlot);
        slotOf[locked] = rightSlot;
        slotOf[other] = cur;
      }
    }
    return slotOf;
  }

  private buildFrame(
    columnIndex: number,
    isSelected: boolean,
    isTarget: boolean,
  ): Phaser.GameObjects.GameObject {
    const targetInk = this.model.targetColor(columnIndex);
    // A colored target column always keeps its own colored frame — even when it
    // is a valid drop target for the current selection. Swapping to the generic
    // col_frame_target there made its outline visibly thinner then thicker again
    // on select/deselect (the two green frames have different stroke widths).
    const wantsColorFrame =
      !isSelected && targetInk !== null && hasTexture(this.scene, ASSET_KEYS.columnFrameTint);
    const w = this.layout.colWidth;
    const h = this.layout.colHeights[columnIndex];
    const mk = (key: string): Phaser.GameObjects.NineSlice => {
      const ns = nineSliceConfig(this.scene, key);
      return this.scene.add.nineslice(w / 2, h / 2, key, undefined, w, h, ns.left, ns.right, ns.top, ns.bottom);
    };

    if (hasTexture(this.scene, ASSET_KEYS.columnFrame)) {
      // Selected AND colored-target columns keep the base panel (crisp outline +
      // opaque white fill) and lay a tinted OUTLINE over it from the tintable
      // frame. Using the tint frame ALONE (as the colored target did) left a
      // faint, see-through, hard-edged border — paper/doodles showed through and
      // the jagged bake read as "pixelated". Tinting the base itself would flood
      // the whole column. The outline sits exactly on the base's frame geometry.
      const baseWithOutline = (tint: number): Phaser.GameObjects.Container => {
        const cont = this.scene.add.container(0, 0);
        cont.add(mk(ASSET_KEYS.columnFrame));
        if (hasTexture(this.scene, ASSET_KEYS.columnFrameTint)) {
          const outline = mk(ASSET_KEYS.columnFrameTint);
          outline.setTint(tint);
          cont.add(outline);
        }
        return cont;
      };
      if (isSelected) return baseWithOutline(0xf6a94a);
      if (wantsColorFrame) return baseWithOutline(BLOCK_TINTS[targetInk!]);

      const useTargetTex = isTarget && hasTexture(this.scene, ASSET_KEYS.columnFrameTarget);
      const key = useTargetTex ? ASSET_KEYS.columnFrameTarget : ASSET_KEYS.columnFrame;
      const slice = mk(key);
      if (isTarget && !useTargetTex) slice.setTint(0xc4ecc9); // target fallback
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

  /** Cover across the top of a sealed (take-only) column. The mechanic is
   * unchanged — only the look: a folded paper flap (tape_flap) if delivered,
   * else the washi tape, else a procedural strip. */
  private buildTapeOverlay(): Phaser.GameObjects.GameObject {
    const w = this.layout.colWidth;
    if (hasTexture(this.scene, ASSET_KEYS.tapeFlap)) {
      const img = this.scene.add.image(w / 2, -11, ASSET_KEYS.tapeFlap).setOrigin(0.5, 0);
      const frame = this.scene.textures.getFrame(ASSET_KEYS.tapeFlap);
      img.setScale((w * 0.9 - 3) / frame.width); // a touch narrower than the column
      return img;
    }
    if (hasTexture(this.scene, 'deco_tape')) {
      const img = this.scene.add.image(w / 2, 4, 'deco_tape').setAngle(-5);
      const frame = this.scene.textures.getFrame('deco_tape');
      img.setScale((w * 1.35) / frame.width);
      return img;
    }
    const g = this.scene.add.graphics();
    g.fillStyle(0xf2e3b5, 0.9);
    g.fillRect(-6, 2, w + 12, 14);
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

    // маленька стрілка кольору колонки над верхнім краєм: "цей колір — сюди".
    // Компактна: висота 14px < міжрядного зазору (26px), тож на мобільних
    // розкладках у 2-3 ряди вона не налазить на колонки верхнього ряду.
    const cx = this.layout.colWidth / 2;
    // Match the block art colour exactly: BLOCK_TINTS is sampled from the block
    // art, so the arrow reads as the same colour as the blocks that go here.
    const ar = this.scene.add.graphics();
    ar.lineStyle(3, BLOCK_TINTS[color], 1);
    ar.lineBetween(cx, -18, cx, -4);
    ar.lineBetween(cx, -4, cx - 5, -11);
    ar.lineBetween(cx, -4, cx + 5, -11);
    container.add(ar);
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

  /** A completed set that stays in place under the no-clear rule: full,
   * one non-special color, and an open (not locked/chained) column. */
  private isColumnDone(ci: number): boolean {
    const col = this.model.columns[ci];
    if (!col || col.length !== this.model.capacity(ci)) return false;
    if (ci === this.model.lockedColumn || this.model.isSealed(ci)) return false;
    const first = col[0].color;
    if (first === SPECIAL.INK || first === SPECIAL.KEY) return false;
    return col.every((b) => b.color === first && !b.hidden);
  }

  /** Paperclip on a completed column (concept #1), extracted from the artist
   * frame asset. Rendered BEHIND the blocks: the loop and upper body ride
   * above the column top while the bottom dips behind the first block, so the
   * "clipped over the edge" occlusion is real. Missing asset -> nothing. */
  /** Completed column indicator (concept #2): the same washi tape used by the
   * tape mechanic (deco_tape asset), stuck across the top edge with a
   * "Готово ✓" label. Flat on top — no occlusion tricks. */
  private addDoneTape(container: Phaser.GameObjects.Container, _ci: number): Phaser.GameObjects.Container {
    const w = this.layout.colWidth;
    const cell = this.layout.cell;

    // Bookmark ribbon draped down the centre of the finished column, notched
    // tail just below the bottom edge. Vertical nine-slice so the THICKNESS is
    // constant on every column (cell-relative, not height-relative — scaling the
    // whole image by height made tall columns' ribbons fat) and the green check
    // + tail stay undistorted while only the plain middle stretches to fit.
    // Falls back to the washi tape below when the asset is absent.
    if (hasTexture(this.scene, ASSET_KEYS.doneRibbon)) {
      const colH = this.layout.colHeights[_ci];
      const frame = this.scene.textures.getFrame(ASSET_KEYS.doneRibbon);
      const thickness = cell * 0.5; // constant width
      const s = thickness / frame.width;
      const topCap = 12; // texture px: plain top
      const botCap = 104; // texture px: the green check + notched tail
      const marker = this.scene.add.container(w * 0.5, 0);
      const ribbon = this.scene.add
        .nineslice(0, 0, ASSET_KEYS.doneRibbon, undefined, frame.width, (colH * 1.05) / s, 0, 0, topCap, botCap)
        .setOrigin(0.5, 0)
        .setScale(s);
      marker.add(ribbon);
      marker.setDepth(80);
      container.add(marker);
      this.doneTapes.set(_ci, marker);
      return marker;
    }

    const tape = this.scene.add.container(w * 0.5, 3); // straddles the top edge
    tape.setAngle(-5);

    let tapeH = Math.max(28, cell * 0.46);
    if (hasTexture(this.scene, 'deco_tape')) {
      const img = this.scene.add.image(0, 0, 'deco_tape');
      const frame = this.scene.textures.getFrame('deco_tape');
      const scale = (w * 1.3) / frame.width;
      img.setScale(scale);
      tapeH = frame.height * scale;
      tape.add(img);
    } else {
      const tapeW = w * 1.16;
      const g = this.scene.add.graphics();
      g.fillStyle(0xd8c299, 0.94);
      g.fillRect(-tapeW / 2, -tapeH / 2, tapeW, tapeH);
      g.fillStyle(0xffffff, 0.12);
      g.fillRect(-tapeW / 2, -tapeH / 2, tapeW, tapeH * 0.4);
      g.lineStyle(2, 0xb69a68, 0.9);
      g.strokeRect(-tapeW / 2, -tapeH / 2, tapeW, tapeH);
      tape.add(g);
    }

    const label = this.scene.add
      .text(0, 0, 'Готово ✓', {
        fontFamily: FONTS.display,
        fontSize: `${Math.round(Math.min(tapeH * 0.5, cell * 0.34))}px`,
        color: COLORS.inkCss,
      })
      .setOrigin(0.5);
    tape.add(label);

    tape.setDepth(70);
    container.add(tape);
    this.doneTapes.set(_ci, tape);
    return tape;
  }

  /** A move just completed this column: rebuild, then play a quick "tape
   * slaps on" animation (drops in slightly bigger, tilted and faint, then
   * settles with a little overshoot). */
  markColumnDone(column: number): void {
    this.rebuild();
    const marker = this.doneTapes.get(column);
    if (!marker) return;

    // Ribbon: unroll it downward — grow the nine-slice height from the top so it
    // unfurls to full length (constant thickness, ends exactly on the resting
    // ribbon, no snap). The top + check/tail caps stay put; the middle grows.
    if (hasTexture(this.scene, ASSET_KEYS.doneRibbon)) {
      const ribbon = marker.getAt(0) as Phaser.GameObjects.NineSlice;
      const fullH = ribbon.height;
      ribbon.height = Math.min(fullH, 118); // start: just the top + check & tail
      this.scene.tweens.add({
        targets: ribbon,
        height: fullH,
        duration: GAME_SETTINGS.animation.ribbonUnrollMs,
        ease: 'Cubic.easeOut',
      });
      return;
    }

    // Washi-tape fallback: the original "slaps on" animation.
    const finalAngle = marker.angle;
    const finalY = marker.y;
    marker.setScale(1.2);
    marker.setAngle(finalAngle - 9);
    marker.setAlpha(0.45);
    marker.y = finalY - 7;
    this.scene.tweens.add({
      targets: marker,
      scaleX: 1,
      scaleY: 1,
      angle: finalAngle,
      alpha: 1,
      y: finalY,
      duration: 260,
      ease: 'Back.easeOut',
    });
  }


  /** The taped column just emptied: the tape peels from one end, curls and
   * flutters away. Plays as an overlay right after the rebuild removed it. */
  animateTapePeel(ci: number): void {
    const asset = hasTexture(this.scene, ASSET_KEYS.tapeFlap)
      ? ASSET_KEYS.tapeFlap
      : hasTexture(this.scene, 'deco_tape')
        ? 'deco_tape'
        : null;
    if (!asset) return;
    const pos = this.layout.positions[ci];
    if (!pos) return;
    const frame = this.scene.textures.getFrame(asset);
    const isFlap = asset === ASSET_KEYS.tapeFlap;
    const scale = (this.layout.colWidth * (isFlap ? 1.06 : 1.35)) / frame.width;
    // anchored near the left end so the peel rotates around it
    const cx = this.area.x + pos.x + this.layout.colWidth / 2;
    const cy = this.area.y + pos.y + (isFlap ? frame.height * scale * 0.4 : 4);
    const tape = this.scene.add
      .image(cx - frame.width * scale * 0.42, cy, asset)
      .setOrigin(0.08, 0.5)
      .setScale(scale)
      .setAngle(isFlap ? 0 : -5)
      .setDepth(40);
    this.root.add(tape);

    // 1) peel up around the anchored end
    this.scene.tweens.add({
      targets: tape,
      angle: -46,
      y: cy - 6,
      scaleY: scale * 0.82, // slight curl
      duration: 240,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        // 2) let go: flutters up-right and fades
        this.scene.tweens.add({
          targets: tape,
          x: tape.x + 30,
          y: tape.y - 44,
          angle: -85,
          alpha: 0,
          duration: 300,
          ease: 'Sine.easeOut',
          onComplete: () => tape.destroy(),
        });
      },
    });
  }

  /** Rejected drop into a taped column: the tape wiggles briefly. */
  wiggleTape(ci: number): void {
    const tape = this.tapeOverlays.get(ci) as Phaser.GameObjects.Image | undefined;
    if (!tape) return;
    const baseAngle = tape.angle;
    this.scene.tweens.add({
      targets: tape,
      angle: baseAngle - 7,
      duration: 70,
      yoyo: true,
      repeat: 2,
      onComplete: () => tape.setAngle(baseAngle),
    });
  }

  /** Dead-weight keys after the last lock opened: a hidden one first flips
   * face-up, then the key fades away; a visible one just fades. */
  animateKeyDissolve(entries: { col: number; slot: number; hidden: boolean }[]): void {
    for (const e of entries) {
      const pos = this.layout.positions[e.col];
      if (!pos) continue;
      const { x, y } = this.blockLocalPos(e.slot, e.col);
      const wx = this.area.x + pos.x + x;
      const wy = this.area.y + pos.y + y;

      const dissolve = (sprite: Phaser.GameObjects.Container, delay: number) => {
        this.scene.tweens.add({
          targets: sprite,
          alpha: 0,
          scale: 0.55,
          y: wy - 14,
          delay,
          duration: 320,
          ease: 'Sine.easeIn',
          onComplete: () => sprite.destroy(),
        });
      };

      if (e.hidden) {
        // flip: hidden skin closes, the key opens, holds a beat, then fades
        const back = this.buildBlock(-1).setPosition(wx, wy).setDepth(30);
        this.root.add(back);
        this.scene.tweens.add({
          targets: back,
          scaleX: 0,
          duration: 140,
          ease: 'Sine.easeIn',
          onComplete: () => {
            back.destroy();
            const key = this.buildBlock(SPECIAL.KEY).setPosition(wx, wy).setDepth(30);
            key.scaleX = 0;
            this.root.add(key);
            this.scene.tweens.add({
              targets: key,
              scaleX: 1,
              duration: 160,
              ease: 'Back.easeOut',
            });
            dissolve(key, 420);
          },
        });
      } else {
        const key = this.buildBlock(SPECIAL.KEY).setPosition(wx, wy).setDepth(30);
        this.root.add(key);
        dissolve(key, 120);
      }
    }
  }

  /** Booster on a level with a key block: the sequence plays on the STALE
   * view (rebuild is deferred by the caller): the lock pops off, the key
   * block flips face-up, breaks apart, and the blocks above fall down. */
  animateKeyBreak(
    entries: { col: number; slot: number; hidden: boolean }[],
    lockColumn: number,
    onDone: () => void,
  ): void {
    // the lock jumps off right away
    const lockPos = this.layout.positions[lockColumn];
    if (lockPos) {
      this.popLock(
        this.area.x + lockPos.x + this.layout.colWidth / 2,
        this.area.y + lockPos.y + this.layout.colHeights[lockColumn] / 2,
      );
    }

    let pending = entries.length;
    const finish = () => {
      pending -= 1;
      if (pending <= 0) onDone();
    };
    if (pending === 0) {
      onDone();
      return;
    }

    for (const e of entries) {
      const sprite = this.blockContainers[e.col]?.[e.slot];
      const pos = this.layout.positions[e.col];
      if (!sprite || !pos) {
        finish();
        continue;
      }
      const wx = this.area.x + pos.x + this.blockLocalPos(e.slot, e.col).x;
      const wy = this.area.y + pos.y + this.blockLocalPos(e.slot, e.col).y;

      const breakThenFall = (keySprite: Phaser.GameObjects.Container) => {
        // 2) quick break: a pop, shards fly out, the block vanishes
        this.scene.tweens.add({
          targets: keySprite,
          scale: 1.18,
          angle: -8,
          duration: 90,
          yoyo: false,
          onComplete: () => {
            this.spawnShards(wx, wy);
            this.scene.tweens.add({
              targets: keySprite,
              alpha: 0,
              scale: 0.35,
              angle: 18,
              duration: 130,
              ease: 'Sine.easeIn',
              onComplete: () => {
                keySprite.destroy();
                // 3) quick fall of everything above the broken key
                const step = this.layout.cell + BLOCK_GAP;
                const above = (this.blockContainers[e.col] ?? []).slice(e.slot + 1);
                if (above.length === 0) {
                  finish();
                  return;
                }
                let falling = above.length;
                above.forEach((b) => {
                  this.scene.tweens.add({
                    targets: b,
                    y: b.y + step,
                    duration: 140,
                    ease: 'Cubic.easeIn',
                    onComplete: () => {
                      falling -= 1;
                      if (falling <= 0) finish();
                    },
                  });
                });
              },
            });
          },
        });
      };

      if (e.hidden) {
        // 1) the key becomes visible: the face-down block flips into the key
        this.scene.tweens.add({
          targets: sprite,
          scaleX: 0,
          duration: 110,
          ease: 'Sine.easeIn',
          onComplete: () => {
            sprite.setVisible(false);
            const key = this.buildBlock(SPECIAL.KEY).setPosition(wx, wy).setDepth(30);
            key.scaleX = 0;
            this.root.add(key);
            this.scene.tweens.add({
              targets: key,
              scaleX: 1,
              duration: 130,
              ease: 'Back.easeOut',
              onComplete: () => breakThenFall(key),
            });
          },
        });
      } else {
        breakThenFall(sprite as Phaser.GameObjects.Container);
      }
    }
  }

  /** A few hand-drawn shards flying out of a broken block. */
  private spawnShards(x: number, y: number): void {
    for (let i = 0; i < 5; i++) {
      const g = this.scene.add.graphics().setDepth(35);
      g.fillStyle(0xd9a521, 0.95);
      const size = 4 + Math.random() * 4;
      g.fillRoundedRect(-size / 2, -size / 2, size, size, 2);
      g.setPosition(x, y);
      this.root.add(g);
      const ang = Math.random() * Math.PI * 2;
      const dist = 22 + Math.random() * 20;
      this.scene.tweens.add({
        targets: g,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist + 10,
        alpha: 0,
        angle: (Math.random() - 0.5) * 90,
        duration: 260 + Math.random() * 120,
        ease: 'Cubic.easeOut',
        onComplete: () => g.destroy(),
      });
    }
  }

  /** Rejected action on the chained column: the chains rattle briefly. */
  rattleChains(ci: number): void {
    for (const img of this.chainSprites.get(ci) ?? []) {
      if (!img.active) continue;
      const base = img.angle;
      this.scene.tweens.add({
        targets: img,
        angle: base + (base <= 0 ? -5 : 5),
        duration: 55,
        yoyo: true,
        repeat: 3,
        onComplete: () => img.setAngle(base),
      });
    }
  }

  /** The completed set breaks the seal: a colored spark flies from the cleared
   * column to the ghost emblem, which then pops off — a quick swell, tilt and
   * drop as it fades away. */
  animateChainBreak(fromColumn: number, onDone: () => void): void {
    const ghost = this.ghostChain;
    this.ghostChain = null;
    const colPos = ghost ? this.layout.positions[ghost.column] : undefined;
    const fromPos = this.layout.positions[fromColumn];
    if (!ghost || !colPos || !fromPos) {
      onDone();
      return;
    }
    // onDone MUST run exactly once, even if a tween is dropped (e.g. a rebuild
    // destroys a target, or the game loop pauses): a hard timer backstops it so
    // the controller's `busy` flag can never stick and freeze the game.
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      onDone();
    };

    const { cx, y0, step } = this.sealBandGeom();
    const gx = this.area.x + colPos.x + cx;
    const gy = this.area.y + colPos.y + y0 + ghost.index * step;
    const sx = this.area.x + fromPos.x + this.layout.colWidth / 2;
    const sy = this.area.y + fromPos.y + this.layout.colHeights[fromColumn] / 2;

    const tint = BLOCK_TINTS[ghost.value] ?? COLORS.pencil;
    const spark = this.scene.add.graphics().setDepth(40);
    spark.fillStyle(tint, 1);
    spark.fillCircle(0, 0, 5);
    spark.setPosition(sx, sy);
    this.root.add(spark);

    // a FRESH emblem at the seal's slot (never a live object a rebuild owns)
    const band = this.buildSealBand(ghost.value).setPosition(gx, gy).setDepth(41);
    this.root.add(band);

    this.scene.tweens.add({
      targets: spark,
      x: gx,
      y: gy,
      duration: 230,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        spark.destroy();
        this.scene.tweens.add({
          targets: band,
          scaleX: 1.16,
          scaleY: 1.16,
          angle: 8,
          duration: 120,
          ease: 'Back.easeOut',
          onComplete: () => {
            this.scene.tweens.add({
              targets: band,
              y: gy + 34,
              angle: 26,
              alpha: 0,
              scaleX: 0.9,
              scaleY: 0.9,
              duration: 300,
              ease: 'Cubic.easeIn',
              onComplete: () => {
                band.destroy();
                finish();
              },
            });
          },
        });
      },
    });
    // backstop: clear busy shortly after the animation's nominal length
    this.scene.time.delayedCall(820, () => {
      if (!done) band.destroy();
      finish();
    });
  }

  /** A dug-out key flies in an arc to the locked column; a lock pops off. */
  animateKeyToLock(fromColumn: number, lockColumn: number): void {
    const fromPos = this.layout.positions[fromColumn];
    const lockPos = this.layout.positions[lockColumn];
    if (!fromPos || !lockPos) return;
    const start = this.blockLocalPos(this.model.columns[fromColumn].length, fromColumn);
    const sx = this.area.x + fromPos.x + start.x;
    const sy = this.area.y + fromPos.y + start.y;
    const tx = this.area.x + lockPos.x + this.layout.colWidth / 2;
    const ty = this.area.y + lockPos.y + this.layout.colHeights[lockColumn] / 2;

    const key = hasTexture(this.scene, 'icon_key')
      ? (this.scene.add.image(sx, sy, 'icon_key').setDisplaySize(26, 26) as Phaser.GameObjects.Image)
      : (this.scene.add.text(sx, sy, '🔑', { fontSize: '20px' }).setOrigin(0.5) as unknown as Phaser.GameObjects.Image);
    key.setDepth(40);
    this.root.add(key);

    // little hop up, then an arced flight to the lock
    this.scene.tweens.add({
      targets: key,
      y: sy - 22,
      scale: key.scale * 1.15,
      duration: 120,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: key,
          x: tx,
          duration: 300,
          ease: 'Sine.easeInOut',
        });
        this.scene.tweens.add({
          targets: key,
          y: ty,
          angle: 30,
          duration: 300,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            key.destroy();
            this.popLock(tx, ty);
          },
        });
      },
    });
  }

  /** The lock jumps off the column and fades — the key just opened it. */
  private popLock(x: number, y: number): void {
    const lock = hasTexture(this.scene, ASSET_KEYS.iconLock)
      ? (this.scene.add.image(x, y, ASSET_KEYS.iconLock).setDisplaySize(30, 30) as Phaser.GameObjects.Image)
      : (this.scene.add.text(x, y, '🔒', { fontSize: '24px' }).setOrigin(0.5) as unknown as Phaser.GameObjects.Image);
    lock.setDepth(41);
    this.root.add(lock);
    this.scene.tweens.add({
      targets: lock,
      y: y - 26,
      angle: -28,
      alpha: 0,
      scale: lock.scale * 1.25,
      duration: 380,
      ease: 'Sine.easeOut',
      onComplete: () => lock.destroy(),
    });
  }

  /** Vertical geometry of the seal stack (shared by decor + break animation).
   * Emblem is nearly full-width but short of the frame so the fishtail ends
   * don't merge with it; uniform scale keeps the medallion round. */
  private sealBandGeom(): { cx: number; y0: number; step: number } {
    const wDisp = this.layout.colWidth * 0.96 + 2;
    const frame = hasTexture(this.scene, ASSET_KEYS.seal)
      ? this.scene.textures.getFrame(ASSET_KEYS.seal)
      : null;
    const bandH = frame ? 163 * (wDisp / frame.width) : 26; // art is 163 tall in the 256² texture
    return { cx: this.layout.colWidth / 2, y0: 42, step: bandH * 0.95 };
  }

  /** Builds one seal emblem band (at local 0,0): gray ribbon + light medallion
   * socket + the target-colour block. Used for decor and the break ghost. */
  private buildSealBand(value: number): Phaser.GameObjects.Container {
    const wDisp = this.layout.colWidth * 0.96 + 2;
    const frame = hasTexture(this.scene, ASSET_KEYS.seal)
      ? this.scene.textures.getFrame(ASSET_KEYS.seal)
      : null;
    const scale = frame ? wDisp / frame.width : 1;
    const bandH = frame ? 163 * scale : 26;
    const sockR = frame ? 56 * scale : bandH * 0.4; // measured cream-centre radius
    const bd = frame ? sockR * 1.35 : bandH * 0.5; // block fits inside the cream
    const band = this.scene.add.container(0, 0);
    if (frame) {
      band.add(this.scene.add.image(0, 0, ASSET_KEYS.seal).setScale(scale));
    } else {
      const g = this.scene.add.graphics();
      g.fillStyle(COLORS.pencil, 0.85);
      g.fillRoundedRect(-this.layout.colWidth / 2 - 4, -5, this.layout.colWidth + 8, 10, 5);
      band.add(g);
    }
    const socket = this.scene.add.graphics();
    socket.fillStyle(0xf1ede3, 0.95);
    socket.fillCircle(0, 0, sockR);
    band.add(socket);
    const emblem = this.buildBlock(value >= 0 ? value : 0);
    emblem.setScale(bd / this.layout.cell);
    emblem.postFX.addColorMatrix().saturate(0.35); // deepen the block's colour a touch
    band.add(emblem);
    return band;
  }

  /** Seals across a sealed column: a gray emblem ribbon per seal, each carrying
   * a block in the colour of the set that removes it; the column opens when the
   * last seal falls. Stacks straight down the closed column. */
  private addChainDecor(container: Phaser.GameObjects.Container, ci: number): void {
    const { cx, y0, step } = this.sealBandGeom();
    const bands: Phaser.GameObjects.Container[] = [];
    this.model.chainsLeft(ci).forEach((value, k) => {
      const band = this.buildSealBand(value).setPosition(cx, y0 + k * step);
      container.add(band);
      bands.push(band);
    });
    this.chainSprites.set(ci, bands);
  }

  private addLockDecor(container: Phaser.GameObjects.Container, ci: number): void {
    const colH = this.layout.colHeights[ci];
    const cx = this.layout.colWidth / 2;

    // The one and only locked look: N centered locks stacked vertically
    // (one per remaining lock). A small key silhouette beside a lock means
    // "a key for this lock is somewhere in the pile" — so the player can
    // decide whether the booster is worth spending.
    const n = Math.max(1, this.model.locksLeft);
    const keysInPile = this.model.columns.reduce(
      (acc, col) => acc + col.filter((b) => b.color === SPECIAL.KEY).length,
      0,
    );
    const hints = Math.min(keysInPile, n);
    const gap = 40;
    for (let k = 0; k < n; k++) {
      const ly = colH / 2 + (k - (n - 1) / 2) * gap;
      if (hasTexture(this.scene, ASSET_KEYS.iconLock)) {
        container.add(this.scene.add.image(cx, ly, ASSET_KEYS.iconLock).setDisplaySize(30, 30));
      } else {
        container.add(
          this.scene.add.text(cx, ly, '🔒', { fontSize: '24px' }).setOrigin(0.5),
        );
      }
      if (k < hints && hasTexture(this.scene, 'icon_key')) {
        container.add(
          this.scene.add
            .image(cx + 20, ly + 10, 'icon_key')
            .setDisplaySize(15, 15)
            .setAlpha(0.9),
        );
      }
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
      startX: toLogical(pointer.x),
      startY: toLogical(pointer.y),
      dragging: false,
      ghost: null,
    };
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const g = this.gesture;
    if (!g) return;
    if (!g.dragging) {
      const travel = Math.hypot(toLogical(pointer.x) - g.startX, toLogical(pointer.y) - g.startY);
      if (travel < GAME_SETTINGS.input.dragThresholdPx) return;
      if (!this.onDragStart(g.column)) {
        this.gesture = null;
        return;
      }
      g.dragging = true;
      g.ghost = this.buildGhost(g.column);
    }
    g.ghost?.setPosition(toLogical(pointer.x), toLogical(pointer.y));
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
    this.onDrop(g.column, this.columnAt(toLogical(pointer.x), toLogical(pointer.y)));
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
