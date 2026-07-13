import Phaser from 'phaser';
import { BLOCK_STYLES, COLORS, FONTS } from '../../app/gameConfig';
import { GAME_SETTINGS } from '../../config/gameSettings';
import { hasTexture } from '../../core/assets/AssetLoader';
import { toLogical } from '../../core/utils/hidpi';
import { fillPattern, strokeSketchRect } from '../../ui/sketch';
import { PIECE_SHAPES } from './blocksPieces';
import { BLOCKS_SETTINGS, BLOCKS_TILE_TINTS, blocksTileKey } from './blocksSettings';
import type { BlocksModel } from './BlocksModel';
import type { BlocksViewContract, ClearedCell, GridPos } from './BlocksTypes';

/** One universal highlight/pop colour for special tiles (warm amber) — they
 * must never flash a per-piece colour that changes every clear. */
const SPECIAL_HIGHLIGHT = 0xf7b733;

export const TILE_KEY = (color: number) => blocksTileKey(color);
const FRAME_KEY = 'blocks/board_frame';
/** Fraction of the frame texture taken by the border band (measured by
 * tools/art/prepare-blocks-board.mjs) — the playfield aligns to its inside. */
const FRAME_BAND_FRACTION = 0.021;

/** A tray piece currently dragged by the pointer. */
interface ActivePiece {
  slot: number;
  container: Phaser.GameObjects.Container;
  pieceW: number;
  pieceH: number;
}

/**
 * Render layer of the blocks mechanic. Per the concept: a clean (straight)
 * blue board outline over the transparent notebook paper, tray pieces at
 * board-tile size, and drag'n'drop-only input (the developer's decision:
 * no tap-select) — the piece lifts on press, rides above the finger on touch
 * devices and drops on release.
 */
export class BlocksView implements BlocksViewContract {
  onPieceDragStart: (slot: number) => boolean = () => false;
  onPieceDrop: (slot: number, cell: GridPos | null) => boolean = () => false;

  /** Board rect in scene coords (doodle exclusion zone). */
  contentBounds = { x: 0, y: 0, w: 0, h: 0 };

  private boardRoot: Phaser.GameObjects.Container;
  private boardG: Phaser.GameObjects.Graphics;
  private tilesLayer: Phaser.GameObjects.Container;
  private ghostLayer: Phaser.GameObjects.Container;
  /** Line-clear preview highlight — drawn ABOVE the tiles during a drag. */
  private highlightG: Phaser.GameObjects.Graphics;
  private trayRoot: Phaser.GameObjects.Container;
  /** Decor that must sit BEHIND the whole board (bottom corners): a separate
   * container at a lower depth than boardRoot so the board draws over it
   * regardless of the board wash's transparency. */
  private underDecor: Phaser.GameObjects.Container;
  /** Blueprint annotations (labels + art sprites) recreated on relayout. */
  private annotations: Phaser.GameObjects.GameObject[] = [];
  /** Artist frame (blocks/board_frame), recreated on every relayout. */
  private frameImage: Phaser.GameObjects.Image | null = null;

  private cell = 40;
  private boardX = 0;
  private boardY = 0;
  private trayY = 0;
  /** How far the board was pushed down past centre (so the scene can keep the
   * score panel put while the board+tray+decor drop). */
  appliedDrop = 0;
  private slotW = 0;
  private trayH = 0;
  /** Tray piece hit rects in scene coords, null for empty slots. */
  private slotHits: ({ x: number; y: number; w: number; h: number } | null)[] = [];
  private trayPieces: (Phaser.GameObjects.Container | null)[] = [];

  private active: ActivePiece | null = null;
  private lastGhostAnchor: GridPos | null = null;
  /** Touch devices lift the dragged piece above the finger; a mouse cursor
   * does not cover the piece, so on desktop it stays under the pointer. */
  private readonly liftCells =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
      ? BLOCKS_SETTINGS.layout.dragLiftCells
      : 0;

  private readonly onDown = (p: Phaser.Input.Pointer) => this.pointerDown(p);
  private readonly onMove = (p: Phaser.Input.Pointer) => this.pointerMove(p);
  private readonly onUp = (p: Phaser.Input.Pointer) => this.pointerUp(p);

  constructor(
    private scene: Phaser.Scene,
    private model: BlocksModel,
  ) {
    this.underDecor = scene.add.container(0, 0).setDepth(-1); // behind boardRoot (depth 0)
    this.boardRoot = scene.add.container(0, 0);
    this.boardG = scene.add.graphics();
    this.tilesLayer = scene.add.container(0, 0);
    this.ghostLayer = scene.add.container(0, 0);
    this.highlightG = scene.add.graphics();
    // z-order: wash/grid, ghost preview, tiles, line-clear highlight (top)
    this.boardRoot.add([this.boardG, this.ghostLayer, this.tilesLayer, this.highlightG]);
    this.trayRoot = scene.add.container(0, 0);

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp);
  }

  /* ---------------- layout ---------------- */

  setArea(x: number, y: number, w: number, h: number): void {
    this.releaseActive(false);
    const { rows, cols } = this.model;
    const L = BLOCKS_SETTINGS.layout;
    // reserve room on both sides for the blueprint decor so it never spills off
    // a narrow screen; the board shrinks to fit inside w - 2*decorMargin
    const usableW = Math.max(cols * 18, w - 2 * L.decorMargin);
    this.cell = Math.max(
      18,
      Math.min(L.maxCell, Math.floor(Math.min(usableW / cols, h / (rows + L.trayHeightCells)))),
    );
    const boardW = this.cell * cols;
    const boardH = this.cell * rows;
    this.trayH = this.cell * (L.trayHeightCells - 0.4);
    const contentH = boardH + this.cell * 0.4 + this.trayH;
    this.boardX = x + (w - boardW) / 2;
    // centre vertically, then drop by boardDrop into the free space below
    // (clamped so the content never spills past the area's bottom edge)
    const centred = Math.max(0, (h - contentH) / 2);
    this.appliedDrop = Math.min(centred, L.boardDrop);
    this.boardY = y + centred + this.appliedDrop;
    this.trayY = this.boardY + boardH + this.cell * 0.4;
    this.slotW = boardW / BLOCKS_SETTINGS.traySize;
    this.contentBounds = { x: this.boardX, y: this.boardY, w: boardW, h: contentH };

    this.boardRoot.setPosition(this.boardX, this.boardY);
    this.underDecor.setPosition(this.boardX, this.boardY); // same origin as boardRoot
    this.trayRoot.setPosition(this.boardX, this.trayY);
    this.drawBoard();
    this.rebuild();
  }

  /** The board is a technical drawing in the notebook (per the approved
   * concept): a double blueprint outline with dimension lines ("8" with end
   * ticks), ruler marks under the top edge, a 90° angle note bottom-left and
   * a right-angle symbol bottom-right. A paper-toned wash mutes the notebook
   * grid underneath so it does not clash with the board's own cells. */
  private drawBoard(): void {
    const { rows, cols } = this.model;
    const g = this.boardG;
    const w = this.cell * cols;
    const h = this.cell * rows;
    g.clear();
    this.annotations.forEach((t) => t.destroy());
    this.annotations = [];
    this.underDecor.removeAll(true);
    this.frameImage?.destroy();
    this.frameImage = null;

    g.fillStyle(COLORS.paper, BLOCKS_SETTINGS.layout.boardWashAlpha);
    g.fillRoundedRect(-2, -2, w + 4, h + 4, 4);
    if (BLOCKS_SETTINGS.layout.boardTintAlpha > 0) {
      // EXPERIMENT: darken the playfield (under grid + tiles) so tiles pop
      g.fillStyle(BLOCKS_SETTINGS.layout.boardTint, BLOCKS_SETTINGS.layout.boardTintAlpha);
      g.fillRoundedRect(-2, -2, w + 4, h + 4, 4);
    }
    g.lineStyle(1.4, COLORS.grid, 0.4);
    for (let c = 1; c < cols; c++) g.lineBetween(c * this.cell, 3, c * this.cell, h - 3);
    for (let r = 1; r < rows; r++) g.lineBetween(3, r * this.cell, w - 3, r * this.cell);

    if (hasTexture(this.scene, FRAME_KEY)) {
      // artist frame: sized so the playfield sits exactly inside its border
      // band (the game keeps drawing its own grid — the art has no cells)
      const scale = 1 / (1 - 2 * FRAME_BAND_FRACTION);
      this.frameImage = this.scene.add
        .image(w / 2, h / 2, FRAME_KEY)
        .setDisplaySize(w * scale, h * scale);
      this.boardRoot.addAt(this.frameImage, 1); // above boardG, below tiles
    } else {
      // procedural fallback: double blueprint outline, solid outer + fine inner
      g.lineStyle(3, COLORS.grid, 0.95);
      g.strokeRoundedRect(-2, -2, w + 4, h + 4, 4);
      g.lineStyle(1.2, COLORS.grid, 0.8);
      g.strokeRoundedRect(2.5, 2.5, w - 5, h - 5, 2);
    }
    // ruler ticks hanging from the top edge (one per column)
    g.lineStyle(1.2, COLORS.grid, 0.6);
    for (let c = 1; c < cols; c++) g.lineBetween(c * this.cell, 4, c * this.cell, 12);

    this.drawDimensions(g, w, h, rows, cols);
  }

  /** Dimension lines, datum circles and angle notes around the board.
   * Art-first (the sliced decor sheets), procedural sketch fallback. The
   * size digits are ALWAYS drawn by the game — they must match the level. */
  private drawDimensions(
    g: Phaser.GameObjects.Graphics,
    w: number,
    h: number,
    rows: number,
    cols: number,
  ): void {
    const a = 0.65; // annotation ink alpha
    const off = BLOCKS_SETTINGS.layout.decorGap; // decor distance outside the board edge
    const dash = (x1: number, y1: number, x2: number, y2: number, seg = 6, gap = 5) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      for (let d = 0; d < len; d += seg + gap) {
        const e = Math.min(d + seg, len);
        g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
      }
    };
    const label = (x: number, y: number, text: string, size = 17): void => {
      const t = this.scene.add
        .text(x, y, text, {
          fontFamily: FONTS.display,
          fontSize: `${size}px`,
          color: COLORS.pencilCss,
          padding: { x: 4, y: 3 },
        })
        .setOrigin(0.5)
        .setAlpha(0.8);
      this.boardRoot.add(t);
      this.annotations.push(t);
    };
    const art = (key: string) => hasTexture(this.scene, `blocks/${key}`);
    const img = (
      key: string,
      x: number,
      y: number,
      dw: number,
      dh: number,
      flipX = false,
      below = false,
    ): void => {
      const im = this.scene.add
        .image(x, y, `blocks/${key}`)
        .setDisplaySize(dw, dh)
        .setFlipX(flipX);
      if (below) {
        // a lower-depth container: the whole board (wash, grid, frame) draws
        // OVER these — used for the bottom corners so they tuck behind it
        this.underDecor.add(im);
      } else {
        // annotations live UNDER the frame art (index 1 = right above boardG)
        this.boardRoot.addAt(im, 1);
        this.annotations.push(im);
      }
    };

    g.lineStyle(1.3, COLORS.grid, a);

    // top dimension line + count label (edge-to-edge over the board; the
    // line's ink axis sits at fy 0.462 of the trimmed sprite)
    const dimY = -24;
    if (art('dim_line_h')) {
      const lw = w + 10; // 10px wider than the board (5px past each edge)
      const lh = (39 * lw) / 1024;
      img('dim_line_h', w / 2, dimY + (0.5 - 0.462) * lh, lw, lh);
    } else {
      dash(0, dimY, w, dimY);
      g.lineBetween(0, dimY - 5, 0, dimY + 5);
      g.lineBetween(w, dimY - 5, w, dimY + 5);
      g.lineBetween(w / 2, dimY - 4, w / 2, dimY + 4);
    }
    label(w / 2, dimY - 16, String(cols));

    // datum circles at the top corners (one sprite, mirrored on the right).
    // Circle centres sit ON the shared vertical axes of the bottom corner
    // annotations (x = -26 / w+26) at the dimension line's height — the
    // concept's alignment. Circle centre in the sprite: (0.507, 0.80).
    if (art('corner_datum')) {
      const dh = 46;
      const dw = (69 / 170) * dh;
      const cy = dimY - (0.8 - 0.5) * dh;
      img('corner_datum', -off - (0.507 - 0.5) * dw, cy, dw, dh);
      img('corner_datum', w + off + (0.507 - 0.5) * dw, cy, dw, dh, true);
    } else {
      g.strokeCircle(-off, dimY, 6);
      g.strokeCircle(w + off, dimY, 6);
    }

    // right dimension line + count label (edge-to-edge along the board; the
    // line's ink axis sits at fx 0.419 of the trimmed sprite)
    const dimX = w + off;
    if (art('dim_line_v')) {
      const lh = h + 10; // 10px taller than the board (5px past each edge)
      const lw = (43 * lh) / 1024;
      img('dim_line_v', dimX + (0.5 - 0.419) * lw, h / 2, lw, lh);
    } else {
      dash(dimX, 0, dimX, h);
      g.lineBetween(dimX - 5, 0, dimX + 5, 0);
      g.lineBetween(dimX - 5, h, dimX + 5, h);
    }
    label(dimX + 9, h / 2, String(rows));

    // 90° angle note (bottom-left) — artist sprite, drawn UNDER the board
    if (art('corner_angle')) {
      const ah = 92;
      const aw = (435 / 512) * ah;
      // measured node (vertical line × bottom line) at (0.046, 0.949) of the
      // sprite → anchored on the left axis, 20px lower, drawn UNDER the board
      img('corner_angle', -off + (0.5 - 0.046) * aw, h + 46 - (0.949 - 0.5) * ah, aw, ah, false, true);
    } else {
      const ax = -off - 6;
      const ay = h + 32;
      g.lineBetween(ax, ay, ax, ay - 36);
      g.lineBetween(ax, ay, ax + 30, ay);
      g.beginPath();
      g.arc(ax, ay, 18, -Math.PI / 2, 0);
      g.strokePath();
      label(ax - 22, ay - 18, '90°', 15);
    }

    // right-angle symbol (bottom-right, outside)
    if (art('corner_square')) {
      const sh = 58;
      const sw = (512 / 500) * sh;
      // measured datum crosshair at (0.664, 0.778) of the sprite → anchored
      // on the right axis, 20px lower, drawn UNDER the board
      img('corner_square', w + off - (0.664 - 0.5) * sw, h + 46 - (0.778 - 0.5) * sh, sw, sh, false, true);
    } else {
      const sx = w + off + 2;
      const sy = h + 18;
      g.lineBetween(sx, sy, sx, sy - 12);
      g.lineBetween(sx, sy, sx + 12, sy);
      g.lineBetween(sx + 4, sy, sx + 4, sy - 4);
      g.lineBetween(sx, sy - 4, sx + 4, sy - 4);
    }
  }

  /* ---------------- rebuild ---------------- */

  rebuild(opts: { placedCells?: GridPos[]; refilled?: boolean } = {}): void {
    this.releaseActive(false);
    this.clearGhost();
    this.tilesLayer.setVisible(true); // undo hideBoardTiles (win celebration)
    this.rebuildTiles(opts.placedCells ?? []);
    this.rebuildTray(opts.refilled === true);
  }

  private rebuildTiles(placed: GridPos[]): void {
    this.tilesLayer.removeAll(true);
    const placedSet = new Set(placed.map((p) => p.row * this.model.cols + p.col));
    for (let r = 0; r < this.model.rows; r++) {
      for (let c = 0; c < this.model.cols; c++) {
        const cellState = this.model.grid[r][c];
        if (!cellState) continue;
        const tile = this.makeTile(cellState.color, this.cell - 1, cellState.special);
        tile.setPosition(c * this.cell + this.cell / 2, r * this.cell + this.cell / 2);
        this.tilesLayer.add(tile);
        if (placedSet.has(r * this.model.cols + c)) {
          // scale relative to the tile's own base scale — setDisplaySize on the
          // art texture already set a non-1 scale, absolute values would blow
          // the 128px source up to full size
          const base = tile.scale;
          tile.setScale(base * 0.82);
          this.scene.tweens.add({
            targets: tile,
            scale: base,
            duration: GAME_SETTINGS.animation.landDurationMs,
            ease: 'Back.easeOut',
          });
        }
      }
    }
  }

  private rebuildTray(popIn: boolean): void {
    this.trayRoot.removeAll(true);
    this.slotHits = [];
    this.trayPieces = [];
    // ONE uniform preview size for the whole tray: the largest that still fits
    // every current piece in its slot, capped at the preview scale. Sizing per
    // piece (old behaviour) made a 5-wide and a dot look different — the player
    // complained the tray tiles were mismatched.
    let miniScale: number = BLOCKS_SETTINGS.layout.trayScale;
    for (const p of this.model.tray) {
      if (!p) continue;
      const g = PIECE_SHAPES[p.shape];
      miniScale = Math.min(
        miniScale,
        (this.slotW - 12) / (g.cols * this.cell),
        (this.trayH - 8) / (g.rows * this.cell),
      );
    }
    const mini = this.cell * miniScale;
    for (let slot = 0; slot < this.model.tray.length; slot++) {
      const piece = this.model.tray[slot];
      if (!piece) {
        this.slotHits.push(null);
        this.trayPieces.push(null);
        continue;
      }
      const geo = PIECE_SHAPES[piece.shape];
      const pw = geo.cols * mini;
      const ph = geo.rows * mini;
      const cx = this.slotW * slot + this.slotW / 2;
      const cy = this.trayH / 2;
      const pieceC = this.scene.add.container(cx, cy);
      geo.cells.forEach(({ r, c }, i) => {
        const special = piece.specials?.find((s) => s.cellIndex === i)?.symbol;
        const t = this.makeTile(piece.color, mini - 1, special);
        t.setPosition(c * mini + mini / 2 - pw / 2, r * mini + mini / 2 - ph / 2);
        pieceC.add(t);
      });
      this.trayRoot.add(pieceC);
      this.trayPieces.push(pieceC);
      const hitW = Math.max(44, pw + 12);
      const hitH = Math.max(44, ph + 12);
      this.slotHits.push({
        x: this.boardX + cx - hitW / 2,
        y: this.trayY + cy - hitH / 2,
        w: hitW,
        h: hitH,
      });
      if (popIn) {
        pieceC.setScale(0);
        this.scene.tweens.add({
          targets: pieceC,
          scale: 1,
          duration: GAME_SETTINGS.animation.landDurationMs,
          delay: slot * 60,
          ease: 'Back.easeOut',
        });
      }
    }
  }

  /**
   * A tile object. A `special` symbol renders the wooden special-tile art
   * (`blocks/special_N`) — collected when its line clears — else a colour tile:
   * artist texture, else a sketch block in the colour's ink+pattern.
   */
  private makeTile(
    color: number,
    size: number,
    special?: number,
  ): Phaser.GameObjects.Container | Phaser.GameObjects.Image {
    if (special !== undefined) {
      const key = `blocks/special_${special}`;
      if (hasTexture(this.scene, key)) {
        return this.scene.add.image(0, 0, key).setDisplaySize(size, size);
      }
      return this.makeSpecialFallback(size, special);
    }
    if (hasTexture(this.scene, TILE_KEY(color))) {
      return this.scene.add.image(0, 0, TILE_KEY(color)).setDisplaySize(size, size);
    }
    const style = BLOCK_STYLES[color % BLOCK_STYLES.length];
    const c = this.scene.add.container(0, 0);
    const g = this.scene.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(-size / 2, -size / 2, size, size, size * 0.18);
    fillPattern(g, -size / 2 + 2, -size / 2 + 2, size - 4, size - 4, style.pattern, style.ink);
    strokeSketchRect(g, -size / 2, -size / 2, size, size, style.ink, 2, 1.1);
    c.add(g);
    c.setSize(size, size);
    return c;
  }

  /** Procedural special tile: a cream wooden base with a symbol glyph, used
   * only if the special art is missing. Symbol colours mirror the artwork. */
  private makeSpecialFallback(size: number, symbol: number): Phaser.GameObjects.Container {
    const palette = [0x2f6fd6, 0xe8791f, 0xd21f5b, 0x2f9e44, 0x6a3fb0];
    const ink = palette[symbol % palette.length];
    const c = this.scene.add.container(0, 0);
    const g = this.scene.add.graphics();
    g.fillStyle(0xf3e6cb, 1);
    g.fillRoundedRect(-size / 2, -size / 2, size, size, size * 0.16);
    g.lineStyle(Math.max(2, size * 0.06), 0x9a6b3f, 1);
    g.strokeRoundedRect(-size / 2 + 1, -size / 2 + 1, size - 2, size - 2, size * 0.16);
    // a small filled marker in the symbol's colour (readable at any size)
    g.fillStyle(ink, 0.92);
    g.fillCircle(0, 0, size * 0.16);
    c.add(g);
    c.setSize(size, size);
    return c;
  }

  /* ---------------- input: drag'n'drop only ---------------- */

  private slotAt(px: number, py: number): number | null {
    for (let s = 0; s < this.slotHits.length; s++) {
      const r = this.slotHits[s];
      if (r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return s;
    }
    return null;
  }

  private pointerDown(pointer: Phaser.Input.Pointer): void {
    const px = toLogical(pointer.x);
    const py = toLogical(pointer.y);
    const slot = this.slotAt(px, py);
    if (slot === null) return;
    this.releaseActive(false); // a stray leftover must not survive a new press
    this.holdPiece(slot, px, py);
  }

  private holdPiece(slot: number, px: number, py: number): void {
    if (!this.model.tray[slot] || !this.onPieceDragStart(slot)) return;
    const piece = this.model.tray[slot]!;
    const geo = PIECE_SHAPES[piece.shape];
    const pieceW = geo.cols * this.cell;
    const pieceH = geo.rows * this.cell;

    const container = this.scene.add.container(0, 0).setDepth(900).setAlpha(0.96);
    geo.cells.forEach(({ r, c }, i) => {
      const special = piece.specials?.find((s) => s.cellIndex === i)?.symbol;
      const t = this.makeTile(piece.color, this.cell - 1, special);
      t.setPosition(c * this.cell + this.cell / 2 - pieceW / 2, r * this.cell + this.cell / 2 - pieceH / 2);
      container.add(t);
    });
    container.setScale(BLOCKS_SETTINGS.layout.trayScale);
    this.scene.tweens.add({ targets: container, scale: 1, duration: 110, ease: 'Sine.easeOut' });
    this.trayPieces[slot]?.setVisible(false);

    this.active = { slot, container, pieceW, pieceH };
    this.updateActivePosition(px, py, true);
  }

  private pointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.active || !pointer.isDown) return;
    this.updateActivePosition(toLogical(pointer.x), toLogical(pointer.y), true);
  }

  private pointerUp(pointer: Phaser.Input.Pointer): void {
    const a = this.active;
    if (!a) return;
    const px = toLogical(pointer.x);
    const py = toLogical(pointer.y) - this.liftCells * this.cell;
    this.tryPlaceActive(this.anchorCellFor(px, py, a.pieceW, a.pieceH));
  }

  /** Move the held piece with the pointer (touch lift) and update the ghost. */
  private updateActivePosition(px: number, py: number, withGhost: boolean): void {
    const a = this.active;
    if (!a) return;
    const y = py - this.liftCells * this.cell;
    a.container.setPosition(px, y);
    if (!withGhost) return;
    const anchor = this.anchorCellFor(px, y, a.pieceW, a.pieceH);
    const same =
      (anchor === null && this.lastGhostAnchor === null) ||
      (anchor !== null &&
        this.lastGhostAnchor !== null &&
        anchor.row === this.lastGhostAnchor.row &&
        anchor.col === this.lastGhostAnchor.col);
    if (same) return;
    this.lastGhostAnchor = anchor;
    this.clearGhost();
    if (anchor && this.model.canPlace(a.slot, anchor.row, anchor.col)) this.drawGhost(a.slot, anchor);
  }

  /** Grid cell of the piece's top-left tile when the piece centre is (px,py). */
  private anchorCellFor(px: number, py: number, pieceW: number, pieceH: number): GridPos | null {
    const tlx = px - pieceW / 2 + this.cell / 2;
    const tly = py - pieceH / 2 + this.cell / 2;
    const col = Math.round((tlx - this.boardX - this.cell / 2) / this.cell);
    const row = Math.round((tly - this.boardY - this.cell / 2) / this.cell);
    if (row < 0 || col < 0 || row >= this.model.rows || col >= this.model.cols) return null;
    return { row, col };
  }

  /** Try to place the active piece; on failure return it to the tray
   * (with a board shake when the player aimed at the board). */
  private tryPlaceActive(anchor: GridPos | null): void {
    const a = this.active;
    if (!a) return;
    this.clearGhost();
    this.active = null; // the contract callback may rebuild synchronously
    const accepted = anchor !== null && this.onPieceDrop(a.slot, anchor);
    if (accepted) {
      a.container.destroy(); // rebuild already redrew board + tray
      return;
    }
    // off-board tap = quiet deselect; an on-board miss already shook the
    // board via the controller — either way the piece floats home
    this.returnToTray(a);
  }

  private returnToTray(a: ActivePiece): void {
    const homeX = this.boardX + this.slotW * a.slot + this.slotW / 2;
    const homeY = this.trayY + this.trayH / 2;
    this.scene.tweens.add({
      targets: a.container,
      x: homeX,
      y: homeY,
      scale: BLOCKS_SETTINGS.layout.trayScale,
      duration: BLOCKS_SETTINGS.animation.returnMs,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        a.container.destroy();
        this.trayPieces[a.slot]?.setVisible(true);
      },
    });
  }

  /** Drop any held piece; animated = float back, false = instant. */
  private releaseActive(animated: boolean): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.clearGhost();
    if (animated) {
      this.returnToTray(a);
    } else {
      a.container.destroy();
      this.trayPieces[a.slot]?.setVisible(true);
    }
  }

  private drawGhost(slot: number, anchor: GridPos): void {
    const piece = this.model.tray[slot];
    if (!piece) return;
    const geo = PIECE_SHAPES[piece.shape];
    geo.cells.forEach(({ r, c }, i) => {
      const special = piece.specials?.find((s) => s.cellIndex === i)?.symbol;
      const t = this.makeTile(piece.color, this.cell - 1, special);
      t.setPosition(
        (anchor.col + c) * this.cell + this.cell / 2,
        (anchor.row + r) * this.cell + this.cell / 2,
      );
      t.setAlpha(BLOCKS_SETTINGS.animation.ghostAlpha);
      this.ghostLayer.add(t);
    });
    // line-clear preview: the tiles of a would-complete line turn SOLID —
    // each in its OWN colour at full saturation (the hatched sketch tiles
    // "charge up") — plus a subtle neutral glow along the bottom edge. The
    // gap cells being filled by the ghost read in the piece's colour.
    const { rows, cols } = this.model.previewClears(slot, anchor.row, anchor.col);
    if (rows.length === 0 && cols.length === 0) return;
    const pieceTint = BLOCKS_TILE_TINTS[piece.color] ?? 0xffe6a3;
    const ghostCells = new Set(
      geo.cells.map(({ r, c }) => (anchor.row + r) * this.model.cols + (anchor.col + c)),
    );
    const boardW = this.cell * this.model.cols;
    const boardH = this.cell * this.model.rows;
    const g = this.highlightG;
    const painted = new Set<number>();
    const paintCell = (row: number, col: number) => {
      const key = row * this.model.cols + col;
      if (painted.has(key)) return;
      painted.add(key);
      const cell = this.model.grid[row][col];
      // special tiles get ONE universal highlight (warm amber) so they don't
      // flash a different colour every time; colour tiles glow in their own
      // tint; empty gap cells (filled by the ghost) glow in the piece colour.
      const tint = cell
        ? cell.special !== undefined
          ? SPECIAL_HIGHLIGHT
          : (BLOCKS_TILE_TINTS[cell.color] ?? pieceTint)
        : ghostCells.has(key)
          ? pieceTint
          : null;
      if (tint === null) return;
      g.fillStyle(tint, 0.45);
      g.fillRoundedRect(col * this.cell + 3, row * this.cell + 3, this.cell - 6, this.cell - 6, 7);
    };
    for (const r of rows) for (let c = 0; c < this.model.cols; c++) paintCell(r, c);
    for (const c of cols) for (let r = 0; r < this.model.rows; r++) paintCell(r, c);
    // gentle neutral "lit from below" bar along each completing line
    const underGlow = (x: number, y: number, w: number, h: number) => {
      g.fillStyle(0xffe6a3, 0.28);
      g.fillRoundedRect(x + 2, y + h - 8, w - 4, 8, 4);
    };
    for (const r of rows) underGlow(0, r * this.cell, boardW, this.cell);
    for (const c of cols) underGlow(c * this.cell, 0, this.cell, boardH);
  }

  private clearGhost(): void {
    this.lastGhostAnchor = null;
    this.ghostLayer.removeAll(true);
    this.highlightG.clear();
  }

  /** Hide the rendered board tiles (win celebration: the scene spawns flying
   * copies of every tile, so the originals must vanish — otherwise the tile
   * "stays behind" while its copy flies). Rebuild() restores visibility. */
  hideBoardTiles(): void {
    this.tilesLayer.setVisible(false);
  }

  /** Scene-space centre of a board cell (for the collected-token fly-out). */
  cellWorldXY(row: number, col: number): { x: number; y: number } {
    return {
      x: this.boardX + col * this.cell + this.cell / 2,
      y: this.boardY + row * this.cell + this.cell / 2,
    };
  }

  /** Board cell size in scene pixels (for sizing flying tokens). */
  get cellSize(): number {
    return this.cell;
  }

  /* ---------------- feedback & animations ---------------- */

  animateLineClear(cells: ClearedCell[], onDone: () => void, pieceColor?: number): void {
    if (cells.length === 0) {
      onDone();
      return;
    }
    const A = GAME_SETTINGS.animation;

    // Clear feedback (Block-Blast style): every cleared tile pops in ITS OWN
    // colour, whether one line or several — no rainbow, no piece-colour
    // repaint. Special tiles pop in the universal amber. `pieceColor` is kept
    // in the signature for the controller but no longer recolours the clear.
    void pieceColor;
    const flashTint = (cell: ClearedCell): number =>
      cell.special !== undefined ? SPECIAL_HIGHLIGHT : BLOCKS_TILE_TINTS[cell.color] ?? 0xffe6a3;

    cells.forEach((cell, i) => {
      const x = cell.col * this.cell + this.cell / 2;
      const y = cell.row * this.cell + this.cell / 2;
      const delay = i * (A.clearBlockStaggerMs / 2);
      const t = this.makeTile(cell.color, this.cell - 1, cell.special);
      t.setPosition(x, y);
      this.tilesLayer.add(t);
      // paint-over flash in the pattern colour, above the fading tile. Drawn
      // around its own origin so it can run THE SAME shrink/spin tween as the
      // tile — they must vanish as one, not the flash lingering behind.
      const flash = this.scene.add.graphics({ x, y });
      flash.fillStyle(flashTint(cell), 1);
      flash.fillRoundedRect(-this.cell / 2 + 2, -this.cell / 2 + 2, this.cell - 4, this.cell - 4, 7);
      flash.setAlpha(0.85);
      this.tilesLayer.add(flash);
      this.scene.tweens.add({
        targets: flash,
        alpha: 0,
        scale: 0.7,
        angle: 6,
        delay,
        duration: A.clearBlockDurationMs,
        ease: 'Sine.easeIn',
        onComplete: () => flash.destroy(),
      });
      this.scene.tweens.add({
        targets: t,
        alpha: 0,
        scale: t.scale * 0.7, // relative: art tiles carry a setDisplaySize scale
        angle: 6,
        delay,
        duration: A.clearBlockDurationMs,
        ease: 'Sine.easeIn',
        onComplete: () => t.destroy(),
      });
    });
    const total = (cells.length - 1) * (A.clearBlockStaggerMs / 2) + A.clearBlockDurationMs;
    this.scene.time.delayedCall(total, onDone);
  }

  shakeBoard(): void {
    const A = GAME_SETTINGS.animation;
    this.scene.tweens.add({
      targets: this.boardRoot,
      x: this.boardX - 5,
      duration: A.shakeDurationMs,
      yoyo: true,
      repeat: 2,
      onComplete: () => this.boardRoot.setX(this.boardX),
    });
  }

  destroy(): void {
    this.releaseActive(false);
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown);
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp);
    this.underDecor.destroy(true);
    this.boardRoot.destroy(true); // owns highlightG
    this.trayRoot.destroy(true);
  }
}
