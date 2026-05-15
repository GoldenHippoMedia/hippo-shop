/**
 * Resolve a dot-path against an object. Supports array indices written
 * either as numbers (`items.0.name`) or bracket-style segments aren't
 * supported on purpose — keep the surface tiny and AI-friendly.
 *
 *   getByPath({ a: { b: [{ c: 1 }] } }, 'a.b.0.c') → 1
 *   getByPath({ a: null }, 'a.b')                  → undefined
 *   getByPath(anything, '')                        → anything
 *
 * Returns `undefined` whenever a segment can't be traversed. Never throws.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let current: unknown = obj;
  // Manual split to avoid an allocation when the path has no separators.
  let start = 0;
  for (let i = 0; i <= path.length; i++) {
    if (i === path.length || path.charCodeAt(i) === 46 /* '.' */) {
      if (current == null || (typeof current !== 'object' && typeof current !== 'function')) {
        return undefined;
      }
      const segment = path.slice(start, i);
      if (segment === '') return undefined;
      current = (current as Record<string, unknown>)[segment];
      start = i + 1;
    }
  }
  return current;
}

/** Strict variant that throws on missing segments — used by tests. */
export function getByPathOrThrow(obj: unknown, path: string): unknown {
  const value = getByPath(obj, path);
  if (value === undefined) {
    throw new Error(`path "${path}" did not resolve`);
  }
  return value;
}
