import type { MechanicModule } from '../../core/mechanics/MechanicModule';
import { SCENE_KEYS, LEVELS_URL } from '../../app/gameConfig';
import { UI_TEXTS } from '../../config/uiTexts';
import { SortingScene } from './SortingScene';

/**
 * Sorting mechanic self-description for the mechanics registry / master-lobby.
 * See `src/core/mechanics/MechanicModule.ts` for the contract and
 * `docs/MECHANIC_SDK.md` for how a new mechanic authors its own.
 */
export const sortingModule: MechanicModule = {
  id: 'sorting',
  title: () => UI_TEXTS.mechanics.sorting.name,
  scenes: [SortingScene],
  entryScene: SCENE_KEYS.sorting,
  levelsUrl: LEVELS_URL,
  assetManifestUrl: 'assets/mechanics/sorting/manifest.json',
};
