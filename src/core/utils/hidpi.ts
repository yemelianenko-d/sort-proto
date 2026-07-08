import type Phaser from 'phaser';

/**
 * HiDPI rendering: the canvas backing store is sized in PHYSICAL pixels
 * (CSS size x devicePixelRatio), otherwise phones upscale a 1x canvas and
 * everything looks blurry ("мило") with crunchy small objects.
 *
 * The trick that keeps the rest of the codebase untouched: every scene's
 * main camera zooms by DPR, so all game code keeps thinking in familiar
 * CSS-pixel coordinates ("logical" pixels) while the renderer works at
 * native density. Screen->logical conversion for raw pointer coordinates
 * is a plain division (the camera is centered, so worldPoint == pointer/DPR).
 *
 * Capped at 3: covers modern retina phones (iPhone Pro Max is DPR 3) so the
 * canvas renders at native density instead of a lower-density buffer the OS
 * then upscales (which reads as "мило" — soft and washed-out). Beyond 3 the
 * fill-rate cost outweighs any visible gain.
 */
export const DPR: number =
  typeof window !== 'undefined' ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 3) : 1;

/** Canvas size in logical (CSS) pixels — what layout code should use. */
export function logicalSize(scene: Phaser.Scene): { w: number; h: number } {
  return { w: scene.scale.width / DPR, h: scene.scale.height / DPR };
}

/** Zoom the scene camera so logical coordinates render at native density. */
export function applyHiDpiCamera(scene: Phaser.Scene): void {
  const cam = scene.cameras?.main;
  if (!cam) return;
  const { w, h } = logicalSize(scene);
  cam.setZoom(DPR);
  cam.centerOn(w / 2, h / 2);
}

/** Raw pointer/screen coordinate -> logical coordinate. */
export function toLogical(v: number): number {
  return v / DPR;
}
