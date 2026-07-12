import { JsonLevelSource } from '../../core/game/JsonLevelSource';
import { parseBlocksLevels } from './BlocksLevelParser';
import type { BlocksLevelConfig } from './BlocksTypes';

export const BLOCKS_LEVELS_URL = 'levels/blocks_levels.json';

/** The blocks level list: fetched by the preloader, read by lobby + scene.
 * The standalone single-file build injects the JSON via the window global. */
export const blocksLevels = new JsonLevelSource<BlocksLevelConfig>({
  url: BLOCKS_LEVELS_URL,
  parse: parseBlocksLevels,
  standaloneKey: '__SORTPROTO_BLOCKS_LEVELS__',
});
