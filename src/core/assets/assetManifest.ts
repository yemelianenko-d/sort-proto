/**
 * External art manifest (config-driven skinning).
 *
 * The game renders procedural "sketch" placeholders by default. When the
 * artist delivers files, they are dropped into public/assets/ and listed in
 * public/assets/manifest.json — no code changes. Any key that is missing
 * from the manifest keeps its procedural fallback, so partial deliveries
 * are fine and any asset can be replaced by overwriting one file.
 */

/** Texture keys the game looks up. Must match the artist spec. */
export const ASSET_KEYS = {
  background: 'bg_paper',
  block: (colorId: number) => `block_${colorId}`,
  blockHidden: 'block_hidden',
  columnFrame: 'col_frame',
  columnFrameSelected: 'col_frame_selected',
  columnFrameTarget: 'col_frame_target',
  uiButton: 'ui_button',
  uiButtonPrimary: 'ui_button_primary',
  uiPanel: 'ui_panel',
  iconLock: 'icon_lock',
  animBlockClear: 'anim_block_clear',
  animSparkle: 'anim_sparkle',
} as const;

export interface ManifestImage {
  key: string;
  url: string;
}

export interface ManifestAtlas {
  key: string;
  textureUrl: string;
  atlasUrl: string; // TexturePacker "JSON Hash"
}

export interface NineSliceConfig {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ManifestAnimation {
  key: string;
  atlas: string; // atlas key the frames live in
  prefix: string; // frame name prefix, e.g. "block_clear_"
  start: number;
  end: number;
  zeroPad: number;
  frameRate: number;
  repeat: number; // -1 loop, 0 once
}

export interface AssetManifest {
  version: number;
  images: ManifestImage[];
  atlases: ManifestAtlas[];
  nineslice: Record<string, NineSliceConfig>;
  animations: ManifestAnimation[];
}

/** Validates the manifest; throws a readable error (shown as a warning). */
export function parseAssetManifest(json: unknown): AssetManifest {
  if (typeof json !== 'object' || json === null) {
    throw new Error('assets/manifest.json: root must be an object.');
  }
  const m = json as Record<string, unknown>;
  const images = Array.isArray(m.images) ? (m.images as ManifestImage[]) : [];
  const atlases = Array.isArray(m.atlases) ? (m.atlases as ManifestAtlas[]) : [];
  const animations = Array.isArray(m.animations) ? (m.animations as ManifestAnimation[]) : [];
  const nineslice = (m.nineslice ?? {}) as Record<string, NineSliceConfig>;

  images.forEach((img, i) => {
    if (!img || typeof img.key !== 'string' || typeof img.url !== 'string') {
      throw new Error(`assets/manifest.json: images[${i}] needs string "key" and "url".`);
    }
  });
  atlases.forEach((a, i) => {
    if (!a || typeof a.key !== 'string' || typeof a.textureUrl !== 'string' || typeof a.atlasUrl !== 'string') {
      throw new Error(`assets/manifest.json: atlases[${i}] needs "key", "textureUrl", "atlasUrl".`);
    }
  });
  animations.forEach((a, i) => {
    if (!a || typeof a.key !== 'string' || typeof a.atlas !== 'string' || typeof a.prefix !== 'string') {
      throw new Error(`assets/manifest.json: animations[${i}] needs "key", "atlas", "prefix".`);
    }
  });
  return { version: Number(m.version) || 1, images, atlases, nineslice, animations };
}
