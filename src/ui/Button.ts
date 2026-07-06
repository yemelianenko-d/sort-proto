import Phaser from 'phaser';
import { COLORS, FONTS } from '../app/gameConfig';
import { strokeSketchRect, fillPattern } from './sketch';
import { setContainerTapArea } from './containerTapArea';
import { hasTexture as hasTextureCheck } from '../core/assets/AssetLoader';
import { hasTexture, nineSliceConfig } from '../core/assets/AssetLoader';
import { ASSET_KEYS } from '../core/assets/assetManifest';

export interface ButtonOptions {
  width: number;
  height: number;
  label: string;
  fontSize?: number;
  primary?: boolean;
  /** Green hatched confirm button (falls back to a procedural hatch). */
  success?: boolean;
  /** Red skin for negative/destructive actions (restart, quit, reset). */
  danger?: boolean;
  /** Light in-game chip (boosters): the pre-dialog clean look. */
  light?: boolean;
  /** Multiplier for the icon size (default 1). */
  iconScale?: number;
  labelColor?: string;
  /** Texture icon key; used when the texture is loaded, else label fallback. */
  iconKey?: string;
  /** Render only the icon (label is a fallback for missing texture). */
  iconOnly?: boolean;
  onClick: () => void;
}

/**
 * Hand-drawn button. Uses a single pointer pipeline (Phaser pointer events),
 * so mouse and touch behave identically.
 */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private labelText: Phaser.GameObjects.Text;
  private opts: ButtonOptions;
  private enabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, opts: ButtonOptions) {
    super(scene, x, y);
    this.opts = opts;

    this.bg = scene.add.graphics();
    this.labelText = scene.add
      .text(0, 0, opts.label, {
        fontFamily: FONTS.display,
        fontSize: `${opts.fontSize ?? 22}px`,
        color: opts.labelColor ?? COLORS.inkCss,
        padding: { x: 8, y: 5 },
      })
      .setOrigin(0.5);

    this.add([this.bg, this.labelText]);

    const iconSize = Math.min(opts.width, opts.height) * 0.62 * (opts.iconScale ?? 1);
    if (opts.iconKey && hasTextureCheck(scene, opts.iconKey)) {
      const icon = scene.add.image(0, 0, opts.iconKey).setDisplaySize(iconSize, iconSize);
      if (opts.iconOnly) {
        this.labelText.setVisible(false);
      } else {
        const gap = 9;
        const total = iconSize + gap + this.labelText.width;
        icon.setX(-total / 2 + iconSize / 2);
        this.labelText.setX(-total / 2 + iconSize + gap + this.labelText.width / 2);
      }
      this.add(icon);
    }

    this.redraw();

    setContainerTapArea(this, opts.width, opts.height, 'centered');
    this.on('pointerdown', () => {
      if (!this.enabled) return;
      this.setScale(0.95);
    });
    this.on('pointerup', () => {
      if (!this.enabled) return;
      this.setScale(1);
      this.opts.onClick();
    });
    this.on('pointerout', () => this.setScale(1));

    scene.add.existing(this);
  }

  setLabel(label: string): this {
    this.labelText.setText(label);
    return this;
  }

  setEnabled(value: boolean): this {
    this.enabled = value;
    this.setAlpha(value ? 1 : 0.35);
    return this;
  }

  private redraw(): void {
    const { width: w, height: h, primary, success, light, danger } = this.opts;

    if (danger) {
      if (hasTexture(this.scene, 'ui_button_danger')) {
        const ns = nineSliceConfig(this.scene, 'ui_button_danger');
        const cl = Math.min(ns.left, Math.floor(w * 0.32));
        const ct = Math.min(ns.top, Math.floor(h * 0.32));
        this.addAt(
          this.scene.add.nineslice(0, 0, 'ui_button_danger', undefined, w, h, cl, cl, ct, ct),
          0,
        );
        this.bg.clear();
      } else {
        this.bg.clear();
        this.bg.fillStyle(0xf6d9d5, 1);
        this.bg.fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 10);
        fillPattern(this.bg, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 'stripes', 0xe0a49b);
        strokeSketchRect(this.bg, -w / 2, -h / 2, w, h, 0xb23317, 2.6, 1.2);
      }
      return;
    }

    if (light && hasTexture(this.scene, 'ui_button_light')) {
      const ns = nineSliceConfig(this.scene, 'ui_button_light');
      const cl = Math.min(ns.left, Math.floor(w * 0.32));
      const ct = Math.min(ns.top, Math.floor(h * 0.32));
      this.addAt(this.scene.add.nineslice(0, 0, 'ui_button_light', undefined, w, h, cl, cl, ct, ct), 0);
      this.bg.clear();
      return;
    }

    if (success || primary) {
      if (hasTexture(this.scene, 'ui_button_success')) {
        const ns = nineSliceConfig(this.scene, 'ui_button_success');
        const cl = Math.min(ns.left, Math.floor(w * 0.32));
        const ct = Math.min(ns.top, Math.floor(h * 0.32));
        this.addAt(
          this.scene.add.nineslice(0, 0, 'ui_button_success', undefined, w, h, cl, cl, ct, ct),
          0,
        );
        this.bg.clear();
      } else {
        this.bg.clear();
        this.bg.fillStyle(0xdff2dc, 1);
        this.bg.fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 10);
        fillPattern(this.bg, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 'stripes', 0x9ed4a6);
        strokeSketchRect(this.bg, -w / 2, -h / 2, w, h, 0x2e7a3f, 2.6, 1.2);
      }
      return;
    }

    // Near-square buttons: a dedicated square skin (synthesized from the
    // wide one) instead of squeezing a 3:1 texture into 1:1.
    const isSquare = Math.max(w, h) / Math.min(w, h) < 1.35;
    if (!primary && isSquare && hasTexture(this.scene, 'ui_button_square')) {
      this.addAt(this.scene.add.image(0, 0, 'ui_button_square').setDisplaySize(w, h), 0);
      this.bg.clear();
      return;
    }

    const skinKey = primary ? ASSET_KEYS.uiButtonPrimary : ASSET_KEYS.uiButton;
    const useKey = hasTexture(this.scene, skinKey)
      ? skinKey
      : hasTexture(this.scene, ASSET_KEYS.uiButton)
        ? ASSET_KEYS.uiButton
        : null;
    if (useKey) {
      const ns = nineSliceConfig(this.scene, useKey);
      // clamp corners so small buttons never get overlapping corner zones
      const cl = Math.min(ns.left, Math.floor(w * 0.32));
      const cr = Math.min(ns.right, Math.floor(w * 0.32));
      const ct = Math.min(ns.top, Math.floor(h * 0.32));
      const cb = Math.min(ns.bottom, Math.floor(h * 0.32));
      const slice = this.scene.add.nineslice(0, 0, useKey, undefined, w, h, cl, cr, ct, cb);
      this.addAt(slice, 0);
      this.bg.clear();
      return;
    }

    this.bg.clear();
    if (primary) {
      this.bg.fillStyle(COLORS.noteYellow, 1);
      this.bg.fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 10);
    } else {
      this.bg.fillStyle(0xffffff, 0.9);
      this.bg.fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 10);
    }
    // soft "paper shadow"
    this.bg.fillStyle(COLORS.ink, 0.16);
    this.bg.fillRoundedRect(-w / 2 + 4, h / 2 - 3, w - 6, 4, 3);
    strokeSketchRect(this.bg, -w / 2, -h / 2, w, h, COLORS.ink, 2.4, 1.2);
  }
}
