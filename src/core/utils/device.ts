/** Device / environment helpers used by the platform layer and layout code. */

export type Orientation = 'portrait' | 'landscape';

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)
  );
}

export function getOrientation(): Orientation {
  return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
}

export function getScreenSize(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Reads iOS safe-area insets in px from a hidden probe element positioned
 * with `env(safe-area-inset-*)` (see index.html). Returns zeros elsewhere.
 */
export function getSafeAreaInsets(): SafeAreaInsets {
  const probe = document.getElementById('safe-area-probe');
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const cs = getComputedStyle(probe);
  const px = (v: string) => Number.parseFloat(v) || 0;
  return {
    top: px(cs.top),
    left: px(cs.left),
    // right/bottom are distances from the respective edges in this setup
    right: px(cs.right),
    bottom: px(cs.bottom),
  };
}

export function isStandaloneDisplayMode(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    // iOS Safari legacy flag
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
