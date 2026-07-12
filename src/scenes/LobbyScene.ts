import Phaser from 'phaser';
import { COLORS, FONTS, SCENE_KEYS, readAppFlags } from '../app/gameConfig';
import { MECHANICS } from '../app/mechanics';
import type { MechanicModule } from '../core/mechanics/MechanicModule';
import type { GameController } from '../core/game/GameController';
import { UI_TEXTS, LOCALES, getLocale, setLocale } from '../config/uiTexts';
import { PaperBackground, strokeSketchRect } from '../ui/sketch';
import { Button } from '../ui/Button';
import { Popup } from '../ui/Popup';
import { setContainerTapArea } from '../ui/containerTapArea';
import { hasTexture } from '../core/assets/AssetLoader';
import { scatterDoodles } from '../ui/doodles';
import { SPECIAL } from '../mechanics/sorting/SortingTypes';
import { GAME_SETTINGS } from '../config/gameSettings';
import { applyHiDpiCamera, logicalSize, toLogical } from '../core/utils/hidpi';

const PER_ROW = 5;
const CELL_GAP_X = 14;
const CELL_GAP_Y = 18;
const TAP_TOLERANCE = 10;

/**
 * Lobby per the approved concept: fixed header (settings, title with accents
 * and underline, progress), a masked scrollable endless level grid, and a
 * fixed Play button with a scroll hint at the bottom.
 */
export class LobbyScene extends Phaser.Scene {
  private game_!: GameController;
  /** Mechanic this lobby drives (from `?mechanic=`; default = the first,
   * sorting). Until the master-lobby lands, the lobby itself is per-mechanic. */
  private module!: MechanicModule;
  private paper!: PaperBackground;
  private doodles!: Phaser.GameObjects.Container;
  private doodleSeed = 0;
  private header!: Phaser.GameObjects.Container;
  private gridWrap!: Phaser.GameObjects.Container;
  private bottom!: Phaser.GameObjects.Container;
  private maskShape!: Phaser.GameObjects.Graphics;

  private scrollY = 0;
  private minScroll = 0;
  private gridTop = 0;
  /** Внутрішній верхній відступ ґріда (місце під кутові штрихи). */
  private gridPadTop = 0;
  private gridBottom = 0;
  private dragging = false;
  private dragStartY = 0;
  private dragStartScroll = 0;
  private dragDist = 0;
  private userScrolled = false;
  private hintTop: Phaser.GameObjects.Graphics | null = null;
  private hintBottom: Phaser.GameObjects.Graphics | null = null;

  constructor() {
    super(SCENE_KEYS.lobby);
  }

  create(): void {
    this.game_ = this.registry.get('game') as GameController;
    const wanted = readAppFlags().mechanic;
    this.module = MECHANICS.find((m) => m.id === wanted) ?? MECHANICS[0];
    this.paper = new PaperBackground(this);
    this.doodles = this.add.container(0, 0).setDepth(-8);
    this.doodleSeed = Math.floor(Math.random() * 2 ** 31);
    this.gridWrap = this.add.container(0, 0).setDepth(1);
    this.header = this.add.container(0, 0).setDepth(10);
    this.bottom = this.add.container(0, 0).setDepth(10);

    this.maskShape = this.make.graphics({ x: 0, y: 0 }, false);
    this.gridWrap.setMask(this.maskShape.createGeometryMask());

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      const py = toLogical(p.y);
      if (py >= this.gridTop && py <= this.gridBottom) {
        this.dragging = true;
        this.dragStartY = py;
        this.dragStartScroll = this.scrollY;
        this.dragDist = 0;
      }
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown) return;
      this.dragDist = Math.abs(toLogical(p.y) - this.dragStartY);
      if (this.dragDist > TAP_TOLERANCE) this.userScrolled = true;
      this.setScroll(this.dragStartScroll + (toLogical(p.y) - this.dragStartY));
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.dragging = false;
    });
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        this.userScrolled = true;
        this.setScroll(this.scrollY - dy * 0.6);
      },
    );

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    });
    applyHiDpiCamera(this);
    const { w, h } = logicalSize(this);
    this.layout(w, h);
  }

  private onResize(): void {
    applyHiDpiCamera(this);
    const { w, h } = logicalSize(this);
    this.layout(w, h);
  }

  private setScroll(value: number): void {
    this.scrollY = Phaser.Math.Clamp(value, this.minScroll, 0);
    this.gridWrap.y = this.scrollY;
    // індикатори: стрілка є лише коли в той бік справді є рівні
    this.hintTop?.setVisible(this.scrollY < -4);
    this.hintBottom?.setVisible(this.scrollY > this.minScroll + 4);
  }

  /** Dots + chevron scroll indicator (dir: -1 = up, 1 = down). */
  private drawScrollHint(x: number, y: number, dir: -1 | 1): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(COLORS.pencil, 0.75);
    for (let d = 0; d < 3; d++) g.fillCircle(x, y + dir * d * 7, 2);
    const tipY = y + dir * 25;
    g.lineStyle(2.2, COLORS.pencil, 0.85);
    g.lineBetween(x - 6, tipY - dir * 6, x, tipY);
    g.lineBetween(x + 6, tipY - dir * 6, x, tipY);
    return g;
  }

  /* ---------------- layout ---------------- */

  private layout(w: number, h: number): void {
    const safe = this.game_.platform.device.safeArea();
    this.paper.resize(w, h);
    this.header.removeAll(true);
    this.bottom.removeAll(true);
    this.gridWrap.removeAll(true);

    const cx = w / 2;

    // --- header ---
    this.header.add(
      new Button(this, safe.left + 34, safe.top + 34, {
        width: 44,
        height: 44,
        label: UI_TEXTS.settings.button,
        iconKey: 'icon_settings',
        iconOnly: true,
        onClick: () => this.openSettings(),
      }),
    );

    if (this.scale.fullscreen.available) {
      this.header.add(
        new Button(this, w - safe.right - 34, safe.top + 34, {
          width: 44,
          height: 44,
          label: '⛶',
          fontSize: 22,
          onClick: () => this.scale.toggleFullscreen(),
        }),
      );
    }

    // Вертикальне центрування: на високих екранах (fullscreen, десктоп)
    // контент не липне до верху — рахуємо очікувану висоту блоку і зсуваємо
    // все вниз на половину надлишку (кутові кнопки лишаються в кутах).
    // Lobby header = the active mechanic's own name (Блоки / Сортування).
    const mainPart = this.module.title();
    const titleGap = 62; // title.y -> progress row
    const cellSize0 = this.cellSizeFor(w);
    const rowH0 = cellSize0 + CELL_GAP_Y;
    const cheat0 = this.game_.settings.cheat;
    const gridTop0 = safe.top + 64 + titleGap + 68;
    const fit0 = Math.floor((h - safe.bottom - gridTop0 - (44 + 58 + 26 + (cheat0 ? 52 : 0))) / rowH0);
    const rows0 = Phaser.Math.Clamp(fit0, 2, 6);
    const playBottom0 = gridTop0 + rows0 * rowH0 - CELL_GAP_Y / 2 + 12 + 31 + 14 + 29 + 29;
    const contentBottom0 = playBottom0 + (cheat0 ? 45 : 0);
    const topShift = Math.max(0, Math.floor((h - safe.bottom - contentBottom0) / 2));

    const maxTitleW = w - 56;
    const title = this.add
      .text(cx, safe.top + 64 + topShift, mainPart, {
        fontFamily: FONTS.display,
        fontSize: '52px',
        color: COLORS.inkCss,
        fontStyle: 'bold',
        padding: { x: 12, y: 8 }, // рукописні гліфи виходять за метрики
      })
      .setOrigin(0.5)
      .setAngle(-1.5);
    if (title.displayWidth > maxTitleW) title.setScale(maxTitleW / title.displayWidth);
    this.header.add(title);

    this.header.add(this.drawTitleAccent(title.x - title.displayWidth / 2 - 18, title.y, -1));
    this.header.add(this.drawTitleAccent(title.x + title.displayWidth / 2 + 18, title.y, 1));

    const titleBottom = title.y + title.displayHeight / 2;
    if (hasTexture(this, 'deco_underline')) {
      const uw = Math.min(Math.max(title.displayWidth, 180) * 1.05, w - 56);
      this.header.add(
        this.add.image(cx, titleBottom + 4, 'deco_underline').setDisplaySize(uw, 8),
      );
    }

    // progress: "Пройдено: N  •  [★] S"
    const nextIndex = this.nextLevelIndex();
    const doneText = this.add
      .text(0, 0, UI_TEXTS.lobby.progressDone(nextIndex), {
        fontFamily: FONTS.display,
        fontSize: '22px',
        color: COLORS.inkCss,
        padding: { x: 8, y: 5 },
      })
      .setOrigin(0, 0.5);
    const starsText = this.add
      .text(0, 0, `${this.game_.progress.totalStars()}`, {
        fontFamily: FONTS.display,
        fontSize: '22px',
        color: COLORS.inkCss,
        padding: { x: 8, y: 5 },
      })
      .setOrigin(0, 0.5);
    const starSize = 20;
    const gap = 7;
    const groupGap = 24; // між "Пройдено" і блоком зірок
    const total = doneText.width + groupGap + starSize + gap + starsText.width;
    const py = title.y + titleGap;
    doneText.setPosition(cx - total / 2, py);
    this.header.add(doneText);
    if (hasTexture(this, 'icon_star_full')) {
      this.header.add(
        this.add
          .image(cx - total / 2 + doneText.width + groupGap + starSize / 2, py, 'icon_star_full')
          .setDisplaySize(starSize, starSize),
      );
    } else {
      this.header.add(
        this.add
          .text(cx - total / 2 + doneText.width + groupGap, py, '★', {
            fontFamily: FONTS.body,
            fontSize: '20px',
            color: '#d99a1f',
          })
          .setOrigin(0, 0.5),
      );
    }
    starsText.setPosition(cx - total / 2 + doneText.width + groupGap + starSize + gap, py);
    this.header.add(starsText);

    // --- grid: up to 6 visible rows; arrow and Play sit right under it ---
    this.gridTop = py + 68;
    const cellSize = this.cellSizeFor(w);
    // headroom під кутові штрихи поточної клітинки (інакше маска їх зріже)
    this.gridPadTop = Math.round(cellSize * 0.26);
    const rowH = cellSize + CELL_GAP_Y;
    const cheat = this.game_.settings.cheat;
    const reservedBelow = 44 + 58 + 26 + (cheat ? 52 : 0); // стрілка + кнопка (+ чит-скидання)
    const fitRows = Math.floor((h - safe.bottom - this.gridTop - reservedBelow) / rowH);
    const visibleRows = Phaser.Math.Clamp(fitRows, 2, 6);
    this.gridBottom = this.gridTop + visibleRows * rowH - CELL_GAP_Y / 2;

    // стрілки: верхня між "Пройдено" і сіткою, нижня між сіткою і "Грати"
    this.hintTop = this.drawScrollHint(cx, this.gridTop - 14, -1);
    this.header.add(this.hintTop);
    this.hintBottom = this.drawScrollHint(cx, this.gridBottom + 12, 1);
    this.bottom.add(this.hintBottom);

    // кнопка "Грати" одразу під нижньою стрілкою
    const playY = this.gridBottom + 12 + 31 + 14 + 29;
    const available = this.levelCount();
    const allDone = nextIndex >= available;
    this.bottom.add(
      new Button(this, cx, playY, {
        width: Math.min(240, w - 64),
        height: 58,
        label: allDone ? UI_TEXTS.lobby.playAgain : UI_TEXTS.lobby.play,
        fontSize: 28,
        primary: true,
        iconKey: 'icon_play',
        iconScale: 0.72,
        onClick: () => {
          this.enterFullscreenOnTouch();
          this.startLevel(allDone ? available - 1 : nextIndex);
        },
      }),
    );
    if (cheat) {
      this.bottom.add(
        new Button(this, cx, playY + 54, {
          width: 210,
          height: 40,
          label: UI_TEXTS.cheat.reset,
          danger: true,
          fontSize: 18,
          onClick: () => {
            this.game_.progress.clear();
            this.userScrolled = false;
            this.layout(w, h);
          },
        }),
      );
    }
    this.maskShape.clear();
    this.maskShape.fillStyle(0xffffff, 1);
    this.maskShape.fillRect(0, this.gridTop, w, Math.max(0, this.gridBottom - this.gridTop));

    // фонові дудли: лише у вільних зонах, не під елементами
    const gridW = PER_ROW * cellSize + (PER_ROW - 1) * CELL_GAP_X;
    scatterDoodles(this, this.doodles, w, h, [
      { x: 0, y: 0, w, h: this.gridTop - 30 },
      { x: w / 2 - gridW / 2 - 12, y: this.gridTop - 34, w: gridW + 24, h: this.gridBottom - this.gridTop + 46 },
      { x: cx - Math.min(240, w - 64) / 2 - 14, y: playY - 42, w: Math.min(240, w - 64) + 28, h: 84 },
    ], this.doodleSeed);

    const contentHeight = this.buildGrid(w, nextIndex);
    this.minScroll = Math.min(0, this.gridBottom - this.gridTop - contentHeight);
    if (this.userScrolled) {
      this.setScroll(this.scrollY); // re-clamp after resize
    } else {
      // поточний рівень тримаємо у верхній третині видимої зони
      const cell = this.cellSizeFor(w);
      const row = Math.floor(Math.min(nextIndex, this.levelCount() - 1) / PER_ROW);
      const rowWorldY = this.gridPadTop + this.gridTop + cell / 2 + row * (cell + CELL_GAP_Y);
      const desiredY = this.gridTop + (this.gridBottom - this.gridTop) * 0.28;
      this.setScroll(desiredY - rowWorldY);
    }
  }

  private cellSizeFor(w: number): number {
    return Math.min(66, (Math.min(w, 430) - 32 - (PER_ROW - 1) * CELL_GAP_X) / PER_ROW);
  }

  /** Builds all level cells into gridWrap; returns content height. */
  private buildGrid(w: number, nextIndex: number): number {
    const availableCount = this.levelCount();
    const cellSize = this.cellSizeFor(w);
    const gridW = PER_ROW * cellSize + (PER_ROW - 1) * CELL_GAP_X;
    const startX = w / 2 - gridW / 2 + cellSize / 2;
    // Sorting is endless (generated past the curated set); other mechanics
    // show exactly their curated levels.
    const windowCount = this.module.levels ? availableCount : GAME_SETTINGS.lobby.totalCells;

    for (let i = 0; i < windowCount; i++) {
      const row = Math.floor(i / PER_ROW);
      const col = i % PER_ROW;
      const x = startX + col * (cellSize + CELL_GAP_X);
      const y = this.gridPadTop + this.gridTop + cellSize / 2 + row * (cellSize + CELL_GAP_Y);
      this.gridWrap.add(this.buildCell(i, nextIndex, availableCount, x, y, cellSize));
    }
    const rows = Math.ceil(windowCount / PER_ROW);
    return this.gridPadTop + rows * (cellSize + CELL_GAP_Y);
  }


  /** Compact mechanic glyphs for the cheat mode: I=ink K=keys L=lock T=tape C=color-target S=set-unlock. */
  private mechanicGlyphs(index: number): string {
    if (this.module.id !== 'sorting') return ''; // glyphs describe sorting specials only
    if (index >= this.game_.levels.count) return ''; // avoid generating endless levels here
    const cfg = this.game_.levels.byIndex(index);
    if (!cfg) return '';
    const flat = cfg.columns.flat();
    const keys = flat.filter((c) => c === SPECIAL.KEY).length;
    const parts: string[] = [];
    if (flat.includes(SPECIAL.INK)) parts.push('I');
    if (cfg.lockedColumn) {
      const locks = cfg.lockedColumnLocks ?? 1;
      parts.push(keys > 0 ? (locks > 1 ? `K${locks}` : 'K') : 'L');
    }
    if (cfg.tapedColumns?.length) parts.push('T');
    if (cfg.targetColumns?.length) parts.push(cfg.targetColumns.length > 1 ? `C${cfg.targetColumns.length}` : 'C');
    const seals = (cfg.sealedColumns ?? []).reduce((a, s) => a + s.chains.length, 0);
    if (seals > 0) parts.push(seals > 1 ? `S${seals}` : 'S');
    return parts.join(' ');
  }
  private buildCell(
    i: number,
    nextIndex: number,
    availableCount: number,
    x: number,
    y: number,
    cellSize: number,
  ): Phaser.GameObjects.Container {
    const id = this.levelIdFor(i);
    const completed = this.game_.progress.isCompleted(id);
    const isCurrent = i === nextIndex && !completed && i < availableCount;
    const locked = !completed && !isCurrent;

    const cell = this.add.container(x, y).setAngle(i % 2 === 0 ? 1.2 : -1.2);

    const exactSkin = completed
      ? 'lvl_cell_done'
      : isCurrent
        ? 'lvl_cell_current'
        : locked
          ? 'lvl_cell_locked'
          : 'lvl_cell';
    const skin = hasTexture(this, exactSkin)
      ? exactSkin
      : hasTexture(this, 'lvl_cell')
        ? 'lvl_cell'
        : null;
    if (skin) {
      const img = this.add.image(0, 0, skin).setDisplaySize(cellSize, cellSize);
      if (skin !== exactSkin) {
        if (isCurrent) img.setTint(0xffe9a8);
        else if (locked) img.setTint(0xd8d8de).setAlpha(0.75);
        else if (completed) img.setTint(0xd6f0da);
      }
      cell.add(img);
    } else {
      const g = this.add.graphics();
      g.fillStyle(isCurrent ? COLORS.noteYellow : 0xffffff, locked ? 0.5 : 1);
      g.fillRoundedRect(-cellSize / 2 + 2, -cellSize / 2 + 2, cellSize - 4, cellSize - 4, cellSize / 4);
      const stroke = completed ? COLORS.accentGreen : locked ? COLORS.pencil : COLORS.ink;
      strokeSketchRect(g, -cellSize / 2, -cellSize / 2, cellSize, cellSize, stroke, 2.2, 1.6);
      cell.add(g);
    }

    // number
    const numberColor = completed ? '#2e7a3f' : locked ? '#8a8f9c' : COLORS.inkCss;
    const hasSubRow = completed || locked;
    cell.add(
      this.add
        .text(0, hasSubRow ? -cellSize * 0.15 : -cellSize * 0.02, String(i + 1), {
          fontFamily: FONTS.display,
          fontSize: `${Math.round(cellSize * (hasSubRow ? 0.44 : 0.52))}px`,
          color: numberColor,
        })
        .setOrigin(0.5),
    );

    // cheat mode: which mechanics live on this level
    if (this.game_.settings.cheat) {
      const glyphs = this.mechanicGlyphs(i);
      if (glyphs) {
        cell.add(
          this.add
            .text(0, -cellSize * 0.38, glyphs, {
              fontFamily: FONTS.body,
              fontSize: `${Math.max(9, Math.round(cellSize * 0.14))}px`,
              color: '#b0512e',
            })
            .setOrigin(0.5),
        );
      }
    }

    if (completed) {
      const stars = this.game_.progress.starsFor(id);
      const s = cellSize * 0.24;
      if (hasTexture(this, 'icon_star_full') && hasTexture(this, 'icon_star_empty')) {
        for (let k = 0; k < 3; k++) {
          cell.add(
            this.add
              .image((k - 1) * (s + 3), cellSize * 0.29, k < stars ? 'icon_star_full' : 'icon_star_empty')
              .setDisplaySize(s, s),
          );
        }
      } else {
        cell.add(
          this.add
            .text(0, cellSize * 0.26, '★'.repeat(stars) + '☆'.repeat(3 - stars), {
              fontFamily: FONTS.body,
              fontSize: `${Math.round(cellSize * 0.18)}px`,
              color: '#d99a1f',
            })
            .setOrigin(0.5),
        );
      }
    }

    if (locked) {
      const lockKey = hasTexture(this, 'icon_lock_gray')
        ? 'icon_lock_gray'
        : hasTexture(this, 'icon_lock')
          ? 'icon_lock'
          : null;
      const s = cellSize * 0.28;
      if (lockKey) {
        cell.add(this.add.image(0, cellSize * 0.27, lockKey).setDisplaySize(s, s).setAlpha(0.9));
      } else {
        cell.add(
          this.add
            .text(0, cellSize * 0.24, '🔒', { fontSize: `${Math.round(s)}px` })
            .setOrigin(0.5)
            .setAlpha(0.7),
        );
      }
    }

    if (isCurrent) {
      // штрихи "виростають" з верхніх кутів клітинки вгору-назовні
      this.addSparkle(cell, -cellSize / 2 + 2, -cellSize / 2 + 2, cellSize * 0.28, true);
      this.addSparkle(cell, cellSize / 2 - 2, -cellSize / 2 + 2, cellSize * 0.28, false);
    }

    if (!locked || this.game_.settings.cheat) {
      setContainerTapArea(cell, cellSize, cellSize, 'centered');
      cell.on('pointerup', () => {
        if (this.dragDist < TAP_TOLERANCE) this.startLevel(i);
      });
    }
    return cell;
  }

  /* ---------------- helpers ---------------- */

  /** Curated level count of the active mechanic. */
  private levelCount(): number {
    return this.module.levels?.count ?? this.game_.levels.count;
  }

  /** Progress/level id of index `i` in the active mechanic. */
  private levelIdFor(i: number): string {
    return this.module.levels?.idFor(i) ?? this.game_.levels.idFor(i);
  }

  /** First not-yet-completed level index (clamped to the available set). */
  private nextLevelIndex(): number {
    let i = 0;
    while (this.game_.progress.isCompleted(this.levelIdFor(i))) i += 1;
    return i;
  }

  /** Small hand-drawn accent marks beside the title (per the concept). */
  private drawTitleAccent(x: number, y: number, side: 1 | -1): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.lineStyle(3.2, COLORS.ink, 0.9);
    for (let k = 0; k < 2; k++) {
      const sx = x + side * k * 8;
      const sy = y + 10 - k * 4;
      g.lineBetween(sx, sy, sx + side * 7, sy - 12);
    }
    return g;
  }

  /** Sparkle decor with true texture aspect (no squishing). */
  private addSparkle(
    parent: Phaser.GameObjects.Container,
    cornerX: number,
    cornerY: number,
    width: number,
    flip: boolean,
  ): void {
    if (!hasTexture(this, 'deco_sparkle')) return;
    const frame = this.textures.getFrame('deco_sparkle');
    // Точка сходження штрихів у текстурі — низ-ліво (~0.12, 0.90); при flipX
    // вона дзеркалиться в низ-право. Якоримо саме нею у верхній кут клітинки,
    // щоб віяло "виростало" з кута вгору-назовні, а не стирчало збоку.
    const img = this.add
      .image(cornerX, cornerY, 'deco_sparkle')
      .setOrigin(flip ? 0.88 : 0.12, 0.9)
      .setScale(width / frame.width)
      .setFlipX(flip);
    parent.add(img);
  }

  /** Android/touch: entering the game doubles as the fullscreen gesture —
   * the screen just clears, no extra taps. Desktop is left alone (forcing
   * fullscreen there is rude), iOS has no Fullscreen API for games. */
  private enterFullscreenOnTouch(): void {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (!touch || !this.scale.fullscreen.available || this.scale.isFullscreen) return;
    try {
      this.scale.startFullscreen();
    } catch {
      /* gesture edge cases: silently keep playing windowed */
    }
  }

  private openSettings(): void {
    const cardW = Math.min(330, logicalSize(this).w - 40);
    new Popup(this, {
      icon: 'icon_settings',
      emoji: '⚙️',
      title: UI_TEXTS.settings.title,
      section: this.buildSettingsSection(cardW - 76),
      actions: [
        {
          label: UI_TEXTS.settings.ok,
          // чит-режим впливає на лоббі -> перерендер після закриття
          onClick: () => this.layout(logicalSize(this).w, logicalSize(this).h),
        },
      ],
    });
  }

  /** Рядок-перемикач "Чит-режим" (значення зберігається між сесіями). */
  private buildCheatToggle(width: number): {
    node: Phaser.GameObjects.Container;
    height: number;
  } {
    const node = this.add.container(0, 0);
    const label = this.add
      .text(-width / 2, 0, UI_TEXTS.settings.cheat, {
        fontFamily: FONTS.display,
        fontSize: '22px',
        color: COLORS.inkCss,
        padding: { x: 6, y: 4 },
      })
      .setOrigin(0, 0.5);
    const trackX = width / 2 - 48;
    const track = this.add.graphics();
    const knob = this.add.graphics();
    const draw = () => {
      const on = this.game_.settings.cheat;
      track.clear();
      track.fillStyle(on ? 0x9ed4a6 : 0xd6dae3, 1);
      track.fillRoundedRect(trackX, -12, 48, 24, 12);
      track.lineStyle(2.2, COLORS.ink, 0.9);
      track.strokeRoundedRect(trackX, -12, 48, 24, 12);
      knob.clear();
      knob.fillStyle(0xffffff, 1);
      knob.fillCircle(trackX + (on ? 36 : 12), 0, 9);
      knob.lineStyle(2, COLORS.ink, 0.9);
      knob.strokeCircle(trackX + (on ? 36 : 12), 0, 9);
    };
    draw();
    const hit = this.add
      .rectangle(trackX + 24, 0, 68, 40, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => {
      this.game_.settings.setCheat(!this.game_.settings.cheat);
      draw();
    });
    node.add([label, track, knob, hit]);
    return { node, height: 44 };
  }

  private langMenu: Phaser.GameObjects.Container | null = null;
  private langBackdrop: Phaser.GameObjects.Rectangle | null = null;

  /** Settings body: aligned rows (label left, control right) — a language
   * dropdown above the cheat toggle. */
  private buildSettingsSection(width: number): {
    node: Phaser.GameObjects.Container;
    height: number;
  } {
    const node = this.add.container(0, 0);
    const rowGap = 24;
    const lang = this.buildLanguageRow(width);
    const cheat = this.buildCheatToggle(width);
    cheat.node.setY(lang.height + rowGap);
    node.add([lang.node, cheat.node]);
    return { node, height: lang.height + rowGap + cheat.height };
  }

  /** Language row: label + a dropdown button that opens a menu of locales. */
  private buildLanguageRow(width: number): {
    node: Phaser.GameObjects.Container;
    height: number;
  } {
    const node = this.add.container(0, 0);
    const label = this.add
      .text(-width / 2, 0, UI_TEXTS.settings.language, {
        fontFamily: FONTS.display,
        fontSize: '22px',
        color: COLORS.inkCss,
        padding: { x: 6, y: 4 },
      })
      .setOrigin(0, 0.5);
    node.add(label);

    const bh = 36;
    const bw = Math.min(168, width * 0.58);
    const btn = this.add.container(width / 2 - bw / 2, 0);
    const g = this.add.graphics();
    g.fillStyle(0xeef0f4, 1);
    g.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    g.lineStyle(2, COLORS.ink, 0.85);
    g.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    const cur = LOCALES.find((l) => l.code === getLocale())?.label ?? '';
    const t = this.add
      .text(-bw / 2 + 14, 0, cur, { fontFamily: FONTS.body, fontSize: '16px', color: COLORS.inkCss })
      .setOrigin(0, 0.5);
    const chev = this.add
      .text(bw / 2 - 15, -1, '▾', { fontFamily: FONTS.body, fontSize: '17px', color: COLORS.inkCss })
      .setOrigin(0.5);
    const hit = this.add
      .rectangle(0, 0, bw, bh, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => this.openLangMenu(btn, bw, bh));
    btn.add([g, t, chev, hit]);
    node.add(btn);
    return { node, height: bh };
  }

  /** Opens the language dropdown as a scene overlay anchored under the button,
   * with a full-screen backdrop that closes it on an outside tap. */
  private openLangMenu(btn: Phaser.GameObjects.Container, bw: number, bh: number): void {
    if (this.langMenu) {
      this.closeLangMenu();
      return;
    }
    const { w, h } = logicalSize(this);
    const m = btn.getWorldTransformMatrix();
    const wx = m.tx;
    const wy = m.ty;
    const backdrop = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.001).setInteractive().setDepth(1998);
    backdrop.on('pointerup', () => this.closeLangMenu());
    const menu = this.add.container(0, 0).setDepth(2000);
    const optH = 34;
    const optGap = 6;
    LOCALES.forEach((loc, i) => {
      const oy = wy + bh / 2 + 8 + i * (optH + optGap);
      const on = loc.code === getLocale();
      const og = this.add.graphics();
      og.fillStyle(on ? 0xdff0e2 : 0xffffff, 1);
      og.fillRoundedRect(wx - bw / 2, oy, bw, optH, 9);
      og.lineStyle(2, COLORS.ink, 0.85);
      og.strokeRoundedRect(wx - bw / 2, oy, bw, optH, 9);
      const ot = this.add
        .text(wx - bw / 2 + 14, oy + optH / 2, loc.label, {
          fontFamily: FONTS.body,
          fontSize: '16px',
          color: COLORS.inkCss,
        })
        .setOrigin(0, 0.5);
      const oh = this.add
        .rectangle(wx, oy + optH / 2, bw, optH, 0xffffff, 0)
        .setInteractive({ useHandCursor: true });
      oh.on('pointerup', () => {
        this.closeLangMenu();
        if (loc.code !== getLocale()) {
          setLocale(loc.code);
          this.scene.restart(); // re-render the lobby in the new language
        }
      });
      menu.add([og, ot, oh]);
    });
    this.langMenu = menu;
    this.langBackdrop = backdrop;
  }

  private closeLangMenu(): void {
    this.langMenu?.destroy(true);
    this.langMenu = null;
    this.langBackdrop?.destroy();
    this.langBackdrop = null;
  }

  private startLevel(index: number): void {
    this.game_.state.currentMechanic = this.module.id; // analytics base tag
    this.scene.start(this.module.entryScene, { levelIndex: index });
  }
}
