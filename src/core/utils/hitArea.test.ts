import { describe, it, expect } from 'vitest';
import { computeContainerHitRect } from './hitArea';

/**
 * Regression tests for the Container hit-area math.
 * Phaser's pointWithinHitArea adds displayOrigin (w/2, h/2) to the local
 * pointer point; these tests simulate that exact translation.
 */
function phaserTestedPoint(localX: number, localY: number, w: number, h: number) {
  return { x: localX + w / 2, y: localY + h / 2 };
}
function inside(r: { x: number; y: number; width: number; height: number }, p: { x: number; y: number }) {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

describe('computeContainerHitRect', () => {
  it('centered children: visual area maps exactly onto the rect', () => {
    const w = 80;
    const h = 60;
    const r = computeContainerHitRect(w, h, 'centered');
    // visual button spans local -w/2..w/2
    expect(inside(r, phaserTestedPoint(0, 0, w, h))).toBe(true); // center
    expect(inside(r, phaserTestedPoint(-w / 2 + 1, -h / 2 + 1, w, h))).toBe(true); // top-left px
    expect(inside(r, phaserTestedPoint(w / 2 - 1, h / 2 - 1, w, h))).toBe(true); // bottom-right px
    expect(inside(r, phaserTestedPoint(w / 2 + 5, 0, w, h))).toBe(false); // just outside
    expect(inside(r, phaserTestedPoint(-w / 2 - 5, 0, w, h))).toBe(false);
  });

  it('top-left children: visual area maps exactly onto the rect', () => {
    const w = 70;
    const h = 180;
    const r = computeContainerHitRect(w, h, 'topLeft');
    // visual column spans local 0..w, 0..h
    expect(inside(r, phaserTestedPoint(1, 1, w, h))).toBe(true); // top-left px
    expect(inside(r, phaserTestedPoint(w - 1, h - 1, w, h))).toBe(true); // bottom-right px
    expect(inside(r, phaserTestedPoint(w / 2, h / 2, w, h))).toBe(true); // center
    expect(inside(r, phaserTestedPoint(-5, 10, w, h))).toBe(false); // left of column
    expect(inside(r, phaserTestedPoint(w + 5, 10, w, h))).toBe(false); // right of column
  });
});
