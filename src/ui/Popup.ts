import Phaser from 'phaser';
import { logicalSize } from '../core/utils/hidpi';
import { COLORS, FONTS } from '../app/gameConfig';
import { strokeSketchRect } from './sketch';
import { Button } from './Button';
import { hasTexture, nineSliceConfig } from '../core/assets/AssetLoader';
import { ASSET_KEYS } from '../core/assets/assetManifest';

export interface PopupAction {
  label: string;
  primary?: boolean;
  /** Green hatched confirm style (the concept "Далі" button). */
  success?: boolean;
  danger?: boolean;
  onClick: () => void;
}

export interface PopupOptions {
  /** 'panel' (default): white dialog; 'note': yellow sticky with tape. */
  variant?: 'panel' | 'note';
  title: string;
  /** Blue hand-drawn underline under the title (reuses deco_underline). */
  underline?: boolean;
  emoji?: string;
  /** Texture icon at the top (preferred over emoji when loaded). */
  icon?: string;
  /** Big star rating row (0..3), reuses the shared star icons. */
  stars?: number;
  body?: string;
  /** Small note line with an inline star icon: "{before} ★ {after}". */
  note?: { before: string; after: string };
  /** Custom section (e.g. a mini illustration built from game assets). */
  section?: { node: Phaser.GameObjects.Container; height: number };
  actions: PopupAction[];
}

/**
 * Universal window base (per the approved concept): one stretchable
 * nine-slice panel + composable sections. Every dialog in the game builds
 * from these same parts and the same shared icons.
 */
export class Popup extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, opts: PopupOptions) {
    super(scene, 0, 0);
    this.setDepth(1000);

    const { w, h } = logicalSize(scene);

    const dim = hasTexture(scene, 'bg_paper')
      ? scene.add
          .tileSprite(w / 2, h / 2, w, h, 'bg_paper')
          .setTileScale(0.5)
          .setTint(0x9599a3)
          .setAlpha(0.86)
          .setInteractive()
      : scene.add.rectangle(w / 2, h / 2, w, h, 0x6f7480, 0.32).setInteractive();
    this.add(dim);

    const cardW = Math.min(330, w - 40);
    const parts: Phaser.GameObjects.GameObject[] = [];
    let cursorY = 0;

    if (opts.icon && hasTexture(scene, opts.icon)) {
      parts.push(scene.add.image(0, cursorY + 21, opts.icon).setDisplaySize(42, 42));
      cursorY += 54;
    } else if (opts.emoji) {
      parts.push(scene.add.text(0, cursorY, opts.emoji, { fontSize: '42px' }).setOrigin(0.5, 0));
      cursorY += 52;
    }

    const title = scene.add
      .text(0, cursorY, opts.title, {
        fontFamily: FONTS.display,
        fontSize: '32px',
        color: COLORS.inkCss,
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5, 0);
    parts.push(title);
    cursorY += 44;

    if (opts.underline !== false && hasTexture(scene, 'deco_underline')) {
      parts.push(
        scene.add
          .image(0, cursorY, 'deco_underline')
          .setOrigin(0.5, 0)
          .setDisplaySize(Math.min(title.width * 1.05, cardW - 60), 7),
      );
      cursorY += 20;
    }

    if (opts.section) {
      opts.section.node.setY(cursorY + opts.section.height / 2);
      parts.push(opts.section.node);
      cursorY += opts.section.height + 12;
    }

    if (typeof opts.stars === 'number') {
      const size = 54;
      const gapX = 16;
      const haveIcons = hasTexture(scene, 'icon_star_full') && hasTexture(scene, 'icon_star_empty');
      for (let k = 0; k < 3; k++) {
        const x = (k - 1) * (size + gapX);
        if (haveIcons) {
          parts.push(
            scene.add
              .image(x, cursorY + size / 2 + 4, k < opts.stars ? 'icon_star_full' : 'icon_star_empty')
              .setDisplaySize(size, size),
          );
        } else {
          parts.push(
            scene.add
              .text(x, cursorY + size / 2 + 4, k < opts.stars ? '★' : '☆', {
                fontFamily: FONTS.body,
                fontSize: `${size}px`,
                color: '#d99a1f',
              })
              .setOrigin(0.5),
          );
        }
      }
      cursorY += size + 18;
    }

    if (opts.body) {
      const body = scene.add
        .text(0, cursorY, opts.body, {
          fontFamily: FONTS.display,
          fontSize: '28px',
          color: COLORS.inkCss,
          align: 'center',
          padding: { x: 8, y: 5 },
          wordWrap: { width: cardW - 48 },
        })
        .setOrigin(0.5, 0);
      parts.push(body);
      cursorY += body.height + 8;
    }

    if (opts.note) {
      const noteStyle = {
        fontFamily: FONTS.display,
        fontSize: '17px',
        color: COLORS.inkCss,
        padding: { x: 4, y: 3 },
      };
      const before = scene.add.text(0, 0, opts.note.before, noteStyle).setOrigin(0, 0.5);
      const after = scene.add.text(0, 0, opts.note.after, noteStyle).setOrigin(0, 0.5);
      const star = 15;
      const g = 4;
      const total = before.width + g + star + g + after.width;
      const ny = cursorY + 12;
      before.setPosition(-total / 2, ny);
      parts.push(before);
      if (hasTexture(scene, 'icon_star_full')) {
        parts.push(
          scene.add
            .image(-total / 2 + before.width + g + star / 2, ny, 'icon_star_full')
            .setDisplaySize(star, star),
        );
      } else {
        parts.push(
          scene.add
            .text(-total / 2 + before.width + g, ny, '★', { ...noteStyle, color: '#d99a1f' })
            .setOrigin(0, 0.5),
        );
      }
      after.setPosition(-total / 2 + before.width + g + star + g, ny);
      parts.push(after);
      cursorY += 30;
    }

    cursorY += 10;
    const btnW = cardW - 56;
    opts.actions.forEach((action) => {
      const btn = new Button(scene, 0, cursorY + 26, {
        width: btnW,
        height: 52,
        fontSize: 24,
        label: action.label,
        primary: action.primary,
        success: action.success,
        danger: action.danger,
        onClick: () => {
          this.destroy();
          action.onClick();
        },
      });
      parts.push(btn);
      cursorY += 66;
    });

    const isNote = opts.variant === 'note';
    // стікер: знизу справа загнутий кут (кутова зона nine-slice ~56px),
    // тому вміст мусить закінчуватись вище за нього
    const cardH = cursorY + (isNote ? 64 : 36);
    const card = scene.add.container(w / 2, h / 2, []);

    if (hasTexture(scene, 'ui_shadow')) {
      const ns = nineSliceConfig(scene, 'ui_shadow');
      card.add(
        scene.add
          .nineslice(5, 10, 'ui_shadow', undefined, cardW + 14, cardH + 14, ns.left, ns.right, ns.top, ns.bottom)
          .setAlpha(0.9),
      );
    } else {
      const shadow = scene.add.graphics();
      shadow.fillStyle(0x3a4154, 0.1);
      shadow.fillRoundedRect(-cardW / 2 + 7, -cardH / 2 + 12, cardW, cardH, 16);
      shadow.fillStyle(0x3a4154, 0.12);
      shadow.fillRoundedRect(-cardW / 2 + 4, -cardH / 2 + 7, cardW, cardH, 16);
      card.add(shadow);
    }
    const panelKey = isNote && hasTexture(scene, 'ui_panel_note') ? 'ui_panel_note' : ASSET_KEYS.uiPanel;
    if (isNote && !hasTexture(scene, 'ui_panel_note')) {
      // процедурний жовтий стікер (fallback)
      const bg = scene.add.graphics();
      bg.fillStyle(COLORS.noteYellow, 1);
      bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
      strokeSketchRect(bg, -cardW / 2, -cardH / 2, cardW, cardH, COLORS.ink, 2.4, 1.4);
      card.add(bg);
    } else if (hasTexture(scene, panelKey)) {
      const ns = nineSliceConfig(scene, panelKey);
      card.add(
        scene.add.nineslice(0, 0, panelKey, undefined, cardW, cardH, ns.left, ns.right, ns.top, ns.bottom),
      );
    } else {
      const bg = scene.add.graphics();
      bg.fillStyle(COLORS.paper, 1);
      bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 14);
      bg.fillStyle(COLORS.ink, 0.16);
      bg.fillRoundedRect(-cardW / 2 + 5, cardH / 2 - 4, cardW - 8, 6, 4);
      strokeSketchRect(bg, -cardW / 2, -cardH / 2, cardW, cardH, COLORS.ink, 2.6, 1.4);
      card.add(bg);
    }
    parts.forEach((obj) => {
      (obj as Phaser.GameObjects.Container).y -= cardH / 2 - 24;
      card.add(obj);
    });
    if (isNote && hasTexture(scene, 'deco_tape')) {
      const tape = scene.add.image(0, -cardH / 2 + 3, 'deco_tape').setAngle(-2);
      const frame = scene.textures.getFrame('deco_tape');
      tape.setScale(92 / frame.width);
      card.add(tape);
    }
    card.setAngle(isNote ? 1.2 : 0); // діалоги стоять рівно, як у концепті
    this.add(card);

    card.setScale(0.85);
    scene.tweens.add({ targets: card, scale: 1, duration: 220, ease: 'Back.easeOut' });

    scene.add.existing(this);
  }
}
