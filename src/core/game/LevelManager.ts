import { LEVELS_URL } from '../../app/gameConfig';
import { parseSortingLevels } from '../../mechanics/sorting/SortingLevelParser';
import { generateSortingLevel } from '../../mechanics/sorting/SortingLevelGenerator';
import type { SortingLevelConfig } from '../../mechanics/sorting/SortingTypes';

/**
 * Loads level configs from an external JSON file and exposes lookup helpers.
 * Throws a descriptive Error when the file is missing or invalid — the
 * loading flow turns that into a visible error screen instead of a crash.
 */
declare global {
  interface Window {
    /** Injected by the standalone single-file build instead of fetch(). */
    __SORTPROTO_LEVELS__?: unknown;
  }
}

export class LevelManager {
  private levels: SortingLevelConfig[] = [];
  private loaded = false;
  /** Deterministic endless levels beyond the curated JSON (cached). */
  private generated = new Map<number, SortingLevelConfig>();

  async load(): Promise<void> {
    // Standalone build embeds the config directly (no HTTP available on file://).
    if (typeof window !== 'undefined' && window.__SORTPROTO_LEVELS__) {
      this.levels = parseSortingLevels(window.__SORTPROTO_LEVELS__);
      this.loaded = true;
      return;
    }

    let response: Response;
    try {
      response = await fetch(LEVELS_URL, { cache: 'no-cache' });
    } catch {
      throw new Error(`Не вдалося завантажити конфіг рівнів (${LEVELS_URL}): мережа недоступна.`);
    }
    if (!response.ok) {
      throw new Error(`Конфіг рівнів не знайдено (${LEVELS_URL}): HTTP ${response.status}.`);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error('Конфіг рівнів пошкоджено: файл не є валідним JSON.');
    }
    this.levels = parseSortingLevels(json); // throws with a human-readable reason
    this.loaded = true;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** Number of hand-curated levels; playable levels are endless. */
  get count(): number {
    return this.levels.length;
  }

  byIndex(index: number): SortingLevelConfig | null {
    if (index < 0) return null;
    if (index < this.levels.length) return this.levels[index];
    let generated = this.generated.get(index);
    if (!generated) {
      generated = generateSortingLevel(index);
      this.generated.set(index, generated);
    }
    return generated;
  }

  /** Stable id scheme for any index (level_001, level_002, ...). */
  idFor(index: number): string {
    return `level_${String(index + 1).padStart(3, '0')}`;
  }

  byId(id: string): SortingLevelConfig | null {
    const index = this.indexOf(id);
    return index >= 0 ? this.byIndex(index) : null;
  }

  indexOf(id: string): number {
    const match = /^level_(\d+)$/.exec(id);
    return match ? Number(match[1]) - 1 : -1;
  }

  all(): readonly SortingLevelConfig[] {
    return this.levels;
  }
}
