/**
 * Formatter registry. Used by `data-format="name[:arg1[:arg2…]]"` on bound
 * elements. The built-in set covers the vast majority of partner needs;
 * custom formatters can be registered via `window.gh.format.register`.
 *
 * Failure modes are intentionally non-throwing — a malformed format spec
 * or an unconvertible value falls back to `String(value)` so a single bad
 * binding never breaks the rest of the page.
 */

export type Formatter = (value: unknown, ...args: string[]) => string;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toFractionDigits(arg: string | undefined, fallback: number): number {
  if (arg === undefined) return fallback;
  const n = Number(arg);
  return Number.isFinite(n) && n >= 0 ? Math.min(20, Math.floor(n)) : fallback;
}

export const builtinFormatters: Record<string, Formatter> = {
  /**
   * `currency` — uses Intl.NumberFormat with style=currency.
   *
   *   currency               → USD, locale default
   *   currency:USD           → explicit currency, locale default
   *   currency:USD:en-US     → explicit currency + locale
   */
  currency(value, currencyCode, locale) {
    const n = toNumber(value);
    if (n === null) return value == null ? '' : String(value);
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode ?? 'USD',
      }).format(n);
    } catch {
      return n.toFixed(2);
    }
  },

  /**
   * `number` — Intl.NumberFormat with optional digit count.
   *
   *   number       → locale default
   *   number:2     → exactly 2 decimals
   *   number:0:en  → integer, en locale
   */
  number(value, decimals, locale) {
    const n = toNumber(value);
    if (n === null) return value == null ? '' : String(value);
    const opts: Intl.NumberFormatOptions = {};
    if (decimals !== undefined) {
      const d = toFractionDigits(decimals, NaN);
      if (Number.isFinite(d)) {
        opts.minimumFractionDigits = d;
        opts.maximumFractionDigits = d;
      }
    }
    try {
      return new Intl.NumberFormat(locale, opts).format(n);
    } catch {
      return String(n);
    }
  },

  /**
   * `percent` — value is interpreted as a fraction (0.25 → "25%").
   *
   *   percent       → 0 decimals
   *   percent:1     → 1 decimal
   */
  percent(value, decimals, locale) {
    const n = toNumber(value);
    if (n === null) return value == null ? '' : String(value);
    const d = toFractionDigits(decimals, 0);
    try {
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }).format(n);
    } catch {
      return `${(n * 100).toFixed(d)}%`;
    }
  },

  uppercase(value) {
    return value == null ? '' : String(value).toUpperCase();
  },

  lowercase(value) {
    return value == null ? '' : String(value).toLowerCase();
  },

  /**
   * `bool` — render one of two strings based on truthiness.
   *
   *   bool:Yes:No
   */
  bool(value, truthy = 'true', falsy = 'false') {
    return value ? truthy : falsy;
  },

  /**
   * `join` — join an array. Arg is the separator.
   *
   *   join          → ", "
   *   join: -       → " - "
   */
  join(value, separator = ', ') {
    return Array.isArray(value) ? value.map(String).join(separator) : value == null ? '' : String(value);
  },
};

export class FormatRegistry {
  private readonly formatters = new Map<string, Formatter>(
    Object.entries(builtinFormatters),
  );

  register(name: string, fn: Formatter): void {
    this.formatters.set(name, fn);
  }

  has(name: string): boolean {
    return this.formatters.has(name);
  }

  apply(value: unknown, spec: string | null | undefined): string {
    if (!spec) return value == null ? '' : String(value);
    const parts = spec.split(':');
    const name = parts[0]!;
    const args = parts.slice(1);
    const fn = this.formatters.get(name);
    if (!fn) return value == null ? '' : String(value);
    try {
      return fn(value, ...args);
    } catch {
      return value == null ? '' : String(value);
    }
  }

  // Convenience accessors for the built-ins, lets us expose typed methods on the SDK.
  currency(value: unknown, currency = 'USD', locale?: string): string {
    return builtinFormatters['currency']!(value, currency, ...(locale ? [locale] : []));
  }
  number(value: unknown, decimals?: number, locale?: string): string {
    const args: string[] = [];
    if (decimals !== undefined) args.push(String(decimals));
    if (locale) args.push(locale);
    return builtinFormatters['number']!(value, ...args);
  }
  percent(value: unknown, decimals?: number, locale?: string): string {
    const args: string[] = [];
    if (decimals !== undefined) args.push(String(decimals));
    if (locale) args.push(locale);
    return builtinFormatters['percent']!(value, ...args);
  }
}
