import Phaser from 'phaser';
import {
  computeContainerHitRect,
  type ContainerChildrenLayout,
} from '../core/utils/hitArea';

export type { ContainerChildrenLayout } from '../core/utils/hitArea';

/**
 * Applies a correct tap area to a Container (see core/utils/hitArea.ts for
 * the displayOrigin explanation and the unit-tested math).
 */
export function setContainerTapArea(
  container: Phaser.GameObjects.Container,
  width: number,
  height: number,
  layout: ContainerChildrenLayout,
): void {
  const r = computeContainerHitRect(width, height, layout);
  container.setSize(width, height);
  container.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(r.x, r.y, r.width, r.height),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: true,
  });
}
