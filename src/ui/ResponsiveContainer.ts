import Phaser from 'phaser';
import { applyHiDpiCamera, logicalSize } from '../core/utils/hidpi';

export type LayoutFn = (width: number, height: number) => void;

/**
 * Small helper that keeps scene layout in sync with the canvas size
 * (Scale.RESIZE mode). Automatically unsubscribes on scene shutdown,
 * so restarting scenes never accumulates resize listeners.
 */
export class ResponsiveContainer {
  private handler: () => void;

  constructor(
    private scene: Phaser.Scene,
    private layout: LayoutFn,
  ) {
    this.handler = () => this.apply();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.handler);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.handler);
    });
    this.apply();
  }

  apply(): void {
    applyHiDpiCamera(this.scene);
    const { w, h } = logicalSize(this.scene);
    this.layout(w, h);
  }
}
