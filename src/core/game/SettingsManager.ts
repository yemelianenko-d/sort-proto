import { storageGet, storageSet } from '../utils/storage';
import { STORAGE_KEYS } from '../../app/gameConfig';

interface SettingsData {
  cheat: boolean;
}

/** Persisted player settings (currently: the cheat-mode switch). */
export class SettingsManager {
  private data: SettingsData = { cheat: false };

  constructor() {
    try {
      const raw = storageGet(STORAGE_KEYS.settings);
      if (raw) this.data = { ...this.data, ...(JSON.parse(raw) as Partial<SettingsData>) };
    } catch {
      /* corrupted settings -> defaults */
    }
  }

  get cheat(): boolean {
    return this.data.cheat;
  }

  setCheat(value: boolean): void {
    this.data.cheat = value;
    storageSet(STORAGE_KEYS.settings, JSON.stringify(this.data));
  }
}
