/**
 * Sandbox-safe logging.
 *
 * Embedded/preview environments may ship a partial console (e.g. no
 * `console.info`). Every log call goes through these helpers, which pick the
 * first available method and silently no-op when console is missing.
 */
type ConsoleMethod = (...args: unknown[]) => void;

function pick(...names: string[]): ConsoleMethod {
  const c = globalThis.console as unknown as Record<string, unknown> | undefined;
  if (c) {
    for (const name of names) {
      if (typeof c[name] === 'function') {
        return (c[name] as ConsoleMethod).bind(c);
      }
    }
  }
  return () => {};
}

export const logInfo: ConsoleMethod = pick('info', 'log');
export const logWarn: ConsoleMethod = pick('warn', 'log');
export const logError: ConsoleMethod = pick('error', 'log');
