/**
 * Shared jsdom cookie jar for SDK specs.
 *
 * jsdom's `document.cookie` does not persist writes in this setup and never
 * exposes attributes, so every cookie-touching spec used to hand-roll a jar
 * that recorded the value only. That made the Cluster G D2 contract —
 * `Domain=.brand.com`, 30-day `Max-Age`, `Path=/`, `SameSite=Lax` — impossible
 * to assert. This jar records the full attribute set of every write.
 *
 * Not a `.spec.ts` file, so vitest's `include` glob does not collect it.
 */

export interface RecordedCookie {
  /** Decoded cookie value. */
  value: string;
  /** Raw (still percent-encoded) value exactly as written. */
  rawValue: string;
  /** `Domain=` attribute, or null when the write was host-only. */
  domain: string | null;
  /** `Max-Age=` attribute as a number, or null when absent. */
  maxAge: number | null;
  /** `Path=` attribute, or null when absent. */
  path: string | null;
  /** `SameSite=` attribute, or null when absent. */
  sameSite: string | null;
  /** True when the write carried the `Secure` flag. */
  secure: boolean;
  /** The complete `document.cookie = ...` string for this write. */
  raw: string;
}

export interface CookieJar {
  /** Attribute-recording view of the most recent write for `name`. */
  get(name: string): RecordedCookie | undefined;
  /** Seed a cookie as if a previous page load had set it (host-only, no attributes). */
  seed(name: string, value: string): void;
  /** Every raw write string, oldest first — deletions included. */
  writes: string[];
  /** Cookie names currently in the jar. */
  names(): string[];
  /** Drop all cookies and recorded writes. */
  clear(): void;
  /** Restore jsdom's native `document.cookie` accessor. */
  restore(): void;
}

export function installCookieJar(): CookieJar {
  const store = new Map<string, RecordedCookie>();
  const writes: string[] = [];

  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get(): string {
      return Array.from(store.entries())
        .map(([name, c]) => `${name}=${c.rawValue}`)
        .join('; ');
    },
    set(cookieStr: string) {
      writes.push(cookieStr);

      const parts = cookieStr.split(';');
      const nameValue = parts[0] ?? '';
      const attrs = parts.slice(1);
      const eq = nameValue.indexOf('=');
      const name = (eq === -1 ? nameValue : nameValue.slice(0, eq)).trim();
      const rawValue = eq === -1 ? '' : nameValue.slice(eq + 1).trim();
      if (!name) return;

      const attr = (key: string): string | null => {
        for (const a of attrs) {
          const t = a.trim();
          const i = t.indexOf('=');
          const k = (i === -1 ? t : t.slice(0, i)).trim().toLowerCase();
          if (k === key) return i === -1 ? '' : t.slice(i + 1).trim();
        }
        return null;
      };

      const maxAgeRaw = attr('max-age');
      const maxAge = maxAgeRaw === null || maxAgeRaw === '' ? null : Number(maxAgeRaw);
      if (maxAge === 0) {
        store.delete(name);
        return;
      }

      let value = rawValue;
      try {
        value = decodeURIComponent(rawValue);
      } catch {
        // Malformed encoding: keep the raw form.
      }

      store.set(name, {
        value,
        rawValue,
        domain: attr('domain'),
        maxAge,
        path: attr('path'),
        sameSite: attr('samesite'),
        secure: attrs.some((a) => a.trim().toLowerCase() === 'secure'),
        raw: cookieStr,
      });
    },
  });

  return {
    get: (name) => store.get(name),
    seed(name, value) {
      store.set(name, {
        value,
        rawValue: encodeURIComponent(value),
        domain: null,
        maxAge: null,
        path: null,
        sameSite: null,
        secure: false,
        raw: `${name}=${encodeURIComponent(value)}`,
      });
    },
    writes,
    names: () => Array.from(store.keys()),
    clear() {
      store.clear();
      writes.length = 0;
    },
    restore() {
      Reflect.deleteProperty(document, 'cookie');
    },
  };
}
