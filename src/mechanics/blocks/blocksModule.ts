import type { MechanicModule } from '../../core/mechanics/MechanicModule';
import { SCENE_KEYS } from '../../app/gameConfig';
import { UI_TEXTS } from '../../config/uiTexts';
import { BlocksScene } from './BlocksScene';
import { blocksLevels, BLOCKS_LEVELS_URL } from './blocksLevels';

/**
 * Blocks mechanic self-description for the mechanics registry / master-lobby.
 * Until the master-lobby lands, open it with `?mechanic=blocks`.
 */
export const blocksModule: MechanicModule = {
  id: 'blocks',
  title: () => UI_TEXTS.mechanics.blocks.name,
  scenes: [BlocksScene],
  entryScene: SCENE_KEYS.blocks,
  levelsUrl: BLOCKS_LEVELS_URL,
  assetManifestUrl: 'assets/mechanics/blocks/manifest.json',
  levels: blocksLevels,
};
