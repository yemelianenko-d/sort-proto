import type Phaser from 'phaser';

/** A Phaser scene class the game can register (matches `typeof Phaser.Scene`). */
export type SceneClass = typeof Phaser.Scene;

/**
 * Self-description of a puzzle mechanic — the "plug" the (future) master-lobby
 * enumerates to list, launch and track each mechanic.
 *
 * Every mechanic exports one of these from its public `index.ts`; the app
 * registry (`src/app/mechanics.ts`) collects them and `bootstrap.ts` registers
 * their scenes. Core defines the contract only and never imports a concrete
 * mechanic — the dependency direction stays App → Core → Mechanics.
 *
 * See `docs/MECHANIC_SDK.md` for the full authoring contract.
 */
export interface MechanicModule {
  /** Stable id. Namespaces levels, assets, progress and i18n (e.g. 'sorting'). */
  readonly id: string;
  /** Title for the master-lobby tile, i18n-resolved at call time. */
  readonly title: () => string;
  /** Texture key for the master-lobby tile icon (optional until art lands). */
  readonly icon?: string;
  /** Scenes this mechanic contributes; `entryScene` must be among them. */
  readonly scenes: readonly SceneClass[];
  /** Scene key the master-lobby launches to enter the mechanic. */
  readonly entryScene: string;
  /** Levels config under public/ (e.g. 'levels/sorting_levels.json'). */
  readonly levelsUrl: string;
  /**
   * Per-mechanic asset manifest under public/ (e.g.
   * 'assets/mechanics/sorting/manifest.json'). Optional until a mechanic's
   * assets are split out of the shared manifest.
   */
  readonly assetManifestUrl?: string;
}
