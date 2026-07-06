import { describe, it, expect } from 'vitest';
import { parseAssetManifest } from './assetManifest';

describe('parseAssetManifest', () => {
  it('parses a valid manifest with defaults', () => {
    const m = parseAssetManifest({
      version: 1,
      images: [{ key: 'bg_paper', url: 'assets/images/bg_paper.png' }],
    });
    expect(m.images).toHaveLength(1);
    expect(m.atlases).toEqual([]);
    expect(m.animations).toEqual([]);
  });

  it('rejects an image entry without key/url', () => {
    expect(() => parseAssetManifest({ images: [{ key: 'x' }] })).toThrow(/images\[0\]/);
  });

  it('rejects a broken atlas entry', () => {
    expect(() => parseAssetManifest({ atlases: [{ key: 'fx' }] })).toThrow(/atlases\[0\]/);
  });

  it('rejects a broken animation entry', () => {
    expect(() => parseAssetManifest({ animations: [{ key: 'a' }] })).toThrow(/animations\[0\]/);
  });

  it('rejects a non-object root', () => {
    expect(() => parseAssetManifest(null)).toThrow(/root/);
  });
});
