/**
 * Short-lived memos: the first caller of a key starts the computation, the
 * others wait for the same promise, then read the result until it expires.
 */

interface Entry {
  expires: number;
  value: Promise<unknown>;
}

/** A memo of `maxEntries` values, each served `ttlMs` unless told otherwise. */
export interface Memo {
  /**
   * The value under `key`, computed by `load` when absent or expired. A
   * failed load is forgotten at once so the next call retries it.
   */
  cached<T>(key: string, load: () => Promise<T>, ttlMs?: number): Promise<T>;
  clear(): void;
}

export function createMemo(maxEntries: number, defaultTtlMs: number): Memo {
  const entries = new Map<string, Entry>();

  function evictExpired(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.expires <= now) entries.delete(key);
    }
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    cached<T>(
      key: string,
      load: () => Promise<T>,
      ttlMs = defaultTtlMs,
    ): Promise<T> {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && hit.expires > now) return hit.value as Promise<T>;
      evictExpired(now);
      const value = load();
      entries.set(key, { expires: now + ttlMs, value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
    clear: () => entries.clear(),
  };
}
