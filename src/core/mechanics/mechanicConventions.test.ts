import { describe, it, expect } from 'vitest';
import { UI_TEXTS } from '../../config/uiTexts';

/**
 * Cross-mechanic consistency guard. Runs in the plain node env, so instead of
 * importing the Phaser-carrying mechanic modules it globs their on-disk data
 * (Vite resolves `import.meta.glob` in vitest too). The MechanicModule *shape*
 * is already enforced by tsc via the interface; this covers the runtime
 * conventions tsc cannot see — namespaced asset keys, an i18n name per
 * mechanic, and a matching level file. A new mechanic that skips any of these
 * fails here instead of shipping an inconsistency. Auto-discovers mechanics
 * from their asset buckets, so it needs no edit when one is added.
 */
type Manifest = { images?: { key: string; url: string }[] };

const manifestMods = import.meta.glob('../../../public/assets/mechanics/*/manifest.json', {
  eager: true,
}) as Record<string, { default: Manifest }>;
const levelMods = import.meta.glob('../../../public/levels/*_levels.json', {
  eager: true,
}) as Record<string, unknown>;

const idOf = (path: string, re: RegExp): string => path.match(re)?.[1] ?? '';

const mechanics = Object.entries(manifestMods).map(([path, mod]) => ({
  id: idOf(path, /mechanics\/([^/]+)\/manifest\.json$/),
  manifest: mod.default,
}));
const levelIds = new Set(Object.keys(levelMods).map((p) => idOf(p, /\/([^/]+)_levels\.json$/)));

// i18n names live in a typed dict; index by dynamic id for the test.
const names = UI_TEXTS.mechanics as unknown as Record<string, { name: string } | undefined>;

describe('mechanic conventions', () => {
  it('discovers the shipped mechanics', () => {
    const ids = mechanics.map((m) => m.id);
    expect(ids).toContain('sorting');
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  for (const { id, manifest } of mechanics) {
    describe(id, () => {
      it('asset keys are namespaced with the mechanic id', () => {
        // Sorting predates the split — its keys are grandfathered (unprefixed)
        // and frozen. Every NEW mechanic must namespace to avoid key collisions.
        if (id === 'sorting') return;
        for (const img of manifest.images ?? []) {
          expect(img.key.startsWith(`${id}/`), `"${img.key}" must start with "${id}/"`).toBe(true);
          expect(img.url.includes(`assets/mechanics/${id}/`)).toBe(true);
        }
      });

      it('has an i18n name (one locale suffices — the Messages type mirrors the rest)', () => {
        expect(names[id]?.name, `mechanics.${id}.name missing from uiTexts`).toBeTruthy();
      });

      it('ships a level file', () => {
        expect(levelIds.has(id), `public/levels/${id}_levels.json missing`).toBe(true);
      });
    });
  }
});
