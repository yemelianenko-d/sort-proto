import { UI_TEXTS } from '../../config/uiTexts';

/**
 * The level-list surface a mechanic exposes to the shell (lobby, preloader,
 * future master-lobby): count and stable per-level ids. Kept minimal on
 * purpose — gameplay scenes read their own typed configs directly.
 */
export interface MechanicLevelSource {
  load(): Promise<void>;
  readonly isLoaded: boolean;
  readonly count: number;
  /** Stable id used for progress and analytics (must be unique app-wide). */
  idFor(index: number): string;
}

/**
 * Generic loader for a mechanic's external level JSON. Mirrors the (frozen,
 * sorting-specific) LevelManager: fetch + mechanic-owned parser + optional
 * standalone-build injection via a window global, with readable errors the
 * loading flow can surface. Mechanics stay browser-API-free by instantiating
 * this core helper instead of fetching themselves.
 */
export class JsonLevelSource<T extends { id: string }> implements MechanicLevelSource {
  private levels: T[] = [];
  private loaded = false;

  constructor(
    private readonly opts: {
      url: string;
      parse: (json: unknown) => T[];
      /** Window global the standalone single-file build injects (no fetch on file://). */
      standaloneKey?: string;
    },
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    if (typeof window !== 'undefined' && this.opts.standaloneKey) {
      const injected = (window as unknown as Record<string, unknown>)[this.opts.standaloneKey];
      if (injected) {
        this.levels = this.opts.parse(injected);
        this.loaded = true;
        return;
      }
    }

    let response: Response;
    try {
      response = await fetch(this.opts.url, { cache: 'no-cache' });
    } catch {
      throw new Error(UI_TEXTS.error.loadFailed(this.opts.url));
    }
    if (!response.ok) {
      throw new Error(UI_TEXTS.error.httpError(this.opts.url, response.status));
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error(UI_TEXTS.error.corrupted);
    }
    this.levels = this.opts.parse(json); // throws with a human-readable reason
    this.loaded = true;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  get count(): number {
    return this.levels.length;
  }

  byIndex(index: number): T | null {
    return index >= 0 && index < this.levels.length ? this.levels[index] : null;
  }

  idFor(index: number): string {
    // Out-of-range fallback must never collide with a real level id of any
    // mechanic (the lobby probes past the end while scanning progress).
    return this.levels[index]?.id ?? `oob_level_${index + 1}`;
  }
}
