/**
 * Safe key/value storage.
 *
 * localStorage can throw (private mode, quota, WebView policies), so every
 * call is guarded and falls back to an in-memory map. The interface is
 * intentionally tiny so it can later be re-implemented over Capacitor
 * Preferences or a backend without touching gameplay code.
 */
const memory = new Map<string, string>();

function hasLocalStorage(): boolean {
  try {
    const probe = '__probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const useLocal = typeof window !== 'undefined' && hasLocalStorage();

export function storageGet(key: string): string | null {
  try {
    if (useLocal) return window.localStorage.getItem(key);
  } catch {
    /* fall through to memory */
  }
  return memory.get(key) ?? null;
}

export function storageSet(key: string, value: string): void {
  try {
    if (useLocal) {
      window.localStorage.setItem(key, value);
      return;
    }
  } catch {
    /* fall through to memory */
  }
  memory.set(key, value);
}

export function storageRemove(key: string): void {
  try {
    if (useLocal) window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  memory.delete(key);
}
