/**
 * In-memory promise cache. Dedupes concurrent calls to the same resource
 * within the page's lifetime. No localStorage; no cross-tab persistence.
 */
export class RequestCache {
  private readonly map = new Map<string, Promise<unknown>>();

  get<T>(key: string): Promise<T> | undefined {
    return this.map.get(key) as Promise<T> | undefined;
  }

  set<T>(key: string, value: Promise<T>): Promise<T> {
    this.map.set(key, value as Promise<unknown>);
    // Evict on rejection so the next call retries instead of returning a failed promise.
    value.catch(() => {
      if (this.map.get(key) === (value as Promise<unknown>)) {
        this.map.delete(key);
      }
    });
    return value;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
