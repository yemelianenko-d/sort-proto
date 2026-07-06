import Phaser from 'phaser';
import { logWarn } from '../utils/logger';
import {
  parseAssetManifest,
  type AssetManifest,
  type NineSliceConfig,
} from './assetManifest';

const REGISTRY_KEY = 'assetManifest';
const MANIFEST_URL = 'assets/manifest.json';

declare global {
  interface Window {
    /** Injected by the standalone single-file build (urls are data URIs). */
    __SORTPROTO_ASSETS__?: unknown;
  }
}

/**
 * Loads external art listed in public/assets/manifest.json.
 * Missing or invalid manifest is NOT an error — the game simply keeps its
 * procedural placeholder rendering (fail-gracefully by design).
 */
export async function loadExternalAssets(scene: Phaser.Scene): Promise<void> {
  let manifest: AssetManifest | null = null;
  try {
    if (typeof window !== 'undefined' && window.__SORTPROTO_ASSETS__) {
      manifest = parseAssetManifest(window.__SORTPROTO_ASSETS__);
    } else {
      const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) return; // no manifest -> procedural mode
      manifest = parseAssetManifest(await res.json());
    }
  } catch (err) {
    logWarn('[assets] manifest skipped:', err instanceof Error ? err.message : err);
    return;
  }

  scene.game.registry.set(REGISTRY_KEY, manifest);
  if (manifest.images.length === 0 && manifest.atlases.length === 0) return;

  manifest.images.forEach((img) => scene.load.image(img.key, img.url));
  manifest.atlases.forEach((a) => scene.load.atlas(a.key, a.textureUrl, a.atlasUrl));

  await new Promise<void>((resolve) => {
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      logWarn(`[assets] failed to load "${file.key}" (${file.url}) — fallback stays procedural`);
    });
    scene.load.start();
  });

  // Register sprite animations described in the manifest.
  manifest.animations.forEach((a) => {
    if (scene.anims.exists(a.key) || !scene.textures.exists(a.atlas)) return;
    scene.anims.create({
      key: a.key,
      frames: scene.anims.generateFrameNames(a.atlas, {
        prefix: a.prefix,
        start: a.start,
        end: a.end,
        zeroPad: a.zeroPad,
      }),
      frameRate: a.frameRate,
      repeat: a.repeat,
    });
  });
}

/** True when the artist texture is available (else use procedural fallback). */
export function hasTexture(scene: Phaser.Scene, key: string): boolean {
  return scene.textures.exists(key);
}

export function hasAnimation(scene: Phaser.Scene, key: string): boolean {
  return scene.anims.exists(key);
}

export function nineSliceConfig(scene: Phaser.Scene, key: string): NineSliceConfig {
  const manifest = scene.game.registry.get(REGISTRY_KEY) as AssetManifest | undefined;
  return manifest?.nineslice[key] ?? { left: 24, right: 24, top: 24, bottom: 24 };
}
