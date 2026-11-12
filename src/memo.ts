/**
 * Short-lived memos: the first caller of a key starts the computation, the
 * others wait for the same promise, then read the result until it expires.
 */

interface Slot {
  expires: number;
  drop(): void;
}

/** The values of one computation, each served `ttlMs` unless told otherwise. */
export interface Memo<T> {
  /**
   * The value under `key`, computed by `load` when absent or expired. A
   * failed load is forgotten at once so the next call retries it.
   */
  cached(key: string, load: () => Promise<T>, ttlMs?: number): Promise<T>;
  clear(): void;
}

/**
 * Memos of several computations under one bound of `maxEntries` values: when
 * it is reached, the oldest value goes first, whichever memo holds it.
 */
export interface MemoPool {
  memo<T>(): Memo<T>;
  clear(): void;
}

export function createMemoPool(
  maxEntries: number,
  defaultTtlMs: number,
): MemoPool {
  const slots = new Set<Slot>();

  function evict(now: number): void {
    for (const slot of slots) {
      if (slot.expires <= now) slot.drop();
    }
    while (slots.size >= maxEntries) {
      const oldest = slots.values().next().value;
      if (oldest === undefined) break;
      oldest.drop();
    }
  }

  function memo<T>(): Memo<T> {
    const entries = new Map<string, { slot: Slot; value: Promise<T> }>();
    return {
      cached(key, load, ttlMs = defaultTtlMs) {
        const now = Date.now();
        const hit = entries.get(key);
        if (hit && hit.slot.expires > now) return hit.value;
        evict(now);
        const value = load();
        const slot: Slot = {
          expires: now + ttlMs,
          drop: () => {
            slots.delete(slot);
            if (entries.get(key)?.slot === slot) entries.delete(key);
          },
        };
        slots.add(slot);
        entries.set(key, { slot, value });
        value.catch(() => slot.drop());
        return value;
      },
      clear: () => {
        for (const { slot } of entries.values()) slot.drop();
      },
    };
  }

  return {
    memo,
    clear: () => {
      for (const slot of slots) slot.drop();
    },
  };
}

/** A memo of `maxEntries` values of one computation. */
export function createMemo<T>(
  maxEntries: number,
  defaultTtlMs: number,
): Memo<T> {
  return createMemoPool(maxEntries, defaultTtlMs).memo<T>();
}
