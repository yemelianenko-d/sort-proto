/**
 * Public API of the sorting mechanic module.
 * Everything outside /mechanics/sorting must import only from here —
 * this is the "mechanics module contract" for the future puzzle hub.
 */
export { SortingScene } from './SortingScene';
export { sortingModule } from './sortingModule';
export { SortingModel } from './SortingModel';
export { SortingController } from './SortingController';
export { parseSortingLevels } from './SortingLevelParser';
export type {
  SortingLevelConfig,
  SortingLevelsFile,
  SortingViewContract,
  BlockState,
  ColumnState,
  MoveResult,
  ColorId,
} from './SortingTypes';
