import Phaser from 'phaser';
import { COLORS, FONTS, SCENE_KEYS } from '../app/gameConfig';
import { PaperBackground } from '../ui/sketch';
import { UI_TEXTS } from '../config/uiTexts';
import { Button } from '../ui/Button';
import { ResponsiveContainer } from '../ui/ResponsiveContainer';

interface ErrorData {
  message: string;
}

/** Visible error state (bad level config, failed load) instead of a crash. */
export class ErrorScene extends Phaser.Scene {
  private message: string = UI_TEXTS.error.unknown;

  constructor() {
    super(SCENE_KEYS.error);
  }

  init(data: Partial<ErrorData>): void {
    if (data.message) this.message = data.message;
  }

  create(): void {
    const paper = new PaperBackground(this);
    const content = this.add.container(0, 0);

    new ResponsiveContainer(this, (w, h) => {
      paper.resize(w, h);
      content.removeAll(true);

      content.add(
        this.add
          .text(w / 2, h / 2 - 110, '¯\\_(ツ)_/¯', {
            fontFamily: FONTS.body,
            fontSize: '34px',
            color: COLORS.pencilCss,
          })
          .setOrigin(0.5),
      );
      content.add(
        this.add
          .text(w / 2, h / 2 - 56, UI_TEXTS.error.title, {
            fontFamily: FONTS.display,
            fontSize: '30px',
            color: COLORS.inkCss,
          })
          .setOrigin(0.5),
      );
      content.add(
        this.add
          .text(w / 2, h / 2 - 10, this.message, {
            fontFamily: FONTS.body,
            fontSize: '16px',
            color: COLORS.pencilCss,
            align: 'center',
            wordWrap: { width: Math.min(360, w - 48) },
          })
          .setOrigin(0.5, 0),
      );
      content.add(
        new Button(this, w / 2, h / 2 + 110, {
          width: 220,
          height: 54,
          label: UI_TEXTS.error.retry,
          primary: true,
          onClick: () => this.scene.start(SCENE_KEYS.preload),
        }),
      );
    });
  }
}
