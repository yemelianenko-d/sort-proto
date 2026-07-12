import type { MechanicModule } from '../core/mechanics/MechanicModule';
import { sortingModule } from '../mechanics/sorting';
import { blocksModule } from '../mechanics/blocks';

/**
 * The composition root's list of shipped mechanics.
 *
 * Adding a mechanic = import its module and add one entry here (plus its
 * `src/mechanics/<id>/` folder, its `public/assets/mechanics/<id>/` bucket and
 * its levels file). `bootstrap.ts` registers every module's scenes; the future
 * master-lobby renders one tile per entry. This is the single shared file both
 * mechanic owners touch — keep edits to it one line per mechanic.
 */
export const MECHANICS: readonly MechanicModule[] = [sortingModule, blocksModule];
