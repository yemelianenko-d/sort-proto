import Phaser from 'phaser';
import { logWarn } from '../utils/logger';
import {
  parseAssetManifest,
  type AssetManifest,
  type NineSliceConfig,
} from './assetManifest';

const REGISTRY_KEY = 'assetManifest';

/** The design-system manifest — loaded for every mechanic. */
export const SHARED_MANIFEST_URL = 'assets/shared/manifest.json';

declare global {
  interface Window {
    /** Injected by the standalone single-file build (urls are data URIs). */
    __SORTPROTO_ASSETS__?: unknown;
  }
}

/** Merge manifests so nineSliceConfig/animations see one combined registry. */
function mergeManifests(parts: AssetManifest[]): AssetManifest {
  return {
    version: 1,
    images: parts.flatMap((p) => p.images),
    atlases: parts.flatMap((p) => p.atlases),
    nineslice: Object.assign({}, ...parts.map((p) => p.nineslice)),
    animations: parts.flatMap((p) => p.animations),
  };
}

/**
 * Loads external art from the given manifests (the shared design-system one
 * plus each mechanic's bucket — see `MechanicModule.assetManifestUrl`).
 * A missing or invalid manifest is NOT an error — the game simply keeps its
 * procedural placeholder rendering (fail-gracefully by design).
 */
export async function loadExternalAssets(
  scene: Phaser.Scene,
  urls: readonly string[],
): Promise<void> {
  let manifest: AssetManifest | null = null;
  if (typeof window !== 'undefined' && window.__SORTPROTO_ASSETS__) {
    // Standalone build injects one pre-merged manifest with data-URI urls.
    try {
      manifest = parseAssetManifest(window.__SORTPROTO_ASSETS__);
    } catch (err) {
      logWarn('[assets] standalone manifest skipped:', err instanceof Error ? err.message : err);
      return;
    }
  } else {
    const parts: AssetManifest[] = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) continue; // no manifest -> procedural mode for that bucket
        parts.push(parseAssetManifest(await res.json()));
      } catch (err) {
        logWarn(`[assets] manifest ${url} skipped:`, err instanceof Error ? err.message : err);
      }
    }
    if (parts.length === 0) return;
    manifest = mergeManifests(parts);
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
