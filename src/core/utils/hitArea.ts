/**
 * Pure math for Phaser Container hit areas (no Phaser import — unit-testable
 * in Node).
 *
 * Phaser quirk (Container.js + InputManager.pointWithinHitArea): a Container
 * has a fixed origin of 0.5, so after setSize(w, h) its displayOrigin is
 * (w/2, h/2), and the input manager ADDS that offset to the local pointer
 * point before testing it against the hit area. The hit rectangle therefore
 * must be expressed in that shifted space:
 *   - children drawn centered around (0,0)  -> rect(0, 0, w, h)
 *   - children drawn from (0,0) to (w,h)    -> rect(w/2, h/2, w, h)
 */
export type ContainerChildrenLayout = 'centered' | 'topLeft';

export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeContainerHitRect(
  width: number,
  height: number,
  layout: ContainerChildrenLayout,
): HitRect {
  const x = layout === 'topLeft' ? width / 2 : 0;
  const y = layout === 'topLeft' ? height / 2 : 0;
  return { x, y, width, height };
}
