# Cluster G — Superfunnel.ai Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Hippo Shop SDK participate correctly in Golden Hippo's existing session and attribution model — adopting an inbound `?sessionid=`, emitting `Page View` funnel events, and exposing a destination's absolute URL — so Superfunnel.ai-hosted pages on a brand subdomain hand off to checkout with attribution intact.

**Architecture:** The SDK's session layer is realigned with `hippo-builder-funnel`, the canonical implementation: `hippo_session_id` cookie at the registrable root domain, UUID v4 ids, a three-step resolution ladder (URL → cookie → mint), and an unconditional session POST carrying `affParameters.sessionId`. A new `events.ts` emits the 36-field `Page View` payload to Altern through a Kong-fronted route, gated on a funnel id resolved from the destination DTO. `GH-Commerce-Service` gains a public session route on the already-unauthenticated `HippoShopController`, passes through the Salesforce ids it already fetches and discards, and adds the destination URL via SOQL.

**Tech Stack:** TypeScript, pnpm workspaces, Nx, tsup, vitest (SDK) / jest (commerce service), changesets, Express, Zod, Prisma, Salesforce REST.

**Spec:** [`docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md`](../specs/2026-08-18-cluster-g-superfunnel-pilot-design.md)

## Global Constraints

- **SDK v4 is a clean break.** There are no production consumers of the 3.x line. Do not add compatibility shims, dual-writes, or deprecation aliases. If a shipped Cluster F behaviour is wrong, replace it rather than deprecating it.
- **Branching.** `hippo-shop` work is on `feat/cluster-g-superfunnel-pilot`, branched off `feat/cluster-f-session-utm-checkout-handoff` because **Cluster F is unmerged** (PR #17 open). This ships as **one PR to `main`** carrying corrected-F plus G; PR #17 closes as superseded. `ROADMAP.md` wrongly records F as shipped — fix it.
- **Commerce work is off `prerelease`**, in a git worktree. The main clone has another branch checked out; never `git checkout`/`switch`/`stash` there.
- **Release ordering.** `@goldenhippo/hippo-shop-types@4.0.0` must publish **before** the commerce pin bump. Within the commerce repo the pin bump (`^3.0.0` → `^4.0.0`) and the Zod schema change **must be the same commit** — `HippoShop.spec.ts:503-519` asserts bidirectional `Equals<z.infer<typeof ZHippoShopDestinationDTO>, HippoShopDestinationDTO>`, so either change alone fails `tsc`.
- **A new SDK major needs a new CDN line.** The `gh-hippo-shop-sdk-v4` Cloudflare Pages project and Kong `/sdk/v4/*` route must exist **before** the publish. The v3 cut failed on exactly this (`ROADMAP.md:98`). Kong is owned outside this plan.
- **Every failure path stays non-fatal.** Network errors, blocked cookies, malformed inputs, a failed SOQL lookup — none may throw uncaught or break page render. Attribution degrades; the page does not.
- **`affParameters` is destructive-on-write.** Every key present overwrites stored attribution. Empty values must be **omitted**, never sent as `""`.
- **Never read, write, or reason about `connect.sid`.** It is `httpOnly` and belongs to the API.

## File Structure

**`hippo-shop` — SDK**

| File | Responsibility |
|---|---|
| `packages/sdk/src/session.ts` | Session resolution ladder, cookie lifecycle, the unconditional session POST |
| `packages/sdk/src/url-params.ts` | Landing-URL parsing: attribution model, click-id table, the `?sessionid=` reader |
| `packages/sdk/src/checkout.ts` | Destination base resolution, outbound link composition, `data-gh-checkout` bindings |
| `packages/sdk/src/events.ts` *(new)* | 36-field `FunnelEvent` shape, `formatVisitDate`, UA detection, page-view build/gate/dedupe/emit |
| `packages/sdk/src/client.ts` | HTTP transport; gains the keepalive event POST path |
| `packages/sdk/src/runtime.ts` | Bind lifecycle, resource collection, MutationObserver, rebind scheduling |
| `packages/sdk/src/index.ts` | Boot, `window.gh` surface, session thunk wiring |
| `packages/sdk/src/config.ts` | Script-tag attribute parsing — **no change**. D5 requires `data-gh-step` / `data-gh-funnel-id` to be read from the live DOM at emit time, not frozen into the boot-time `GhConfig` snapshot. |
| `packages/sdk/src/bindings.ts` | Resource collection — treats `data-gh-checkout` as a destination reference (Task 30) |
| `packages/sdk/test/helpers/cookie-jar.ts` *(new)* | Shared cookie fake that records `Domain`/`Max-Age`/`SameSite` |

**`hippo-shop` — types**

| File | Responsibility |
|---|---|
| `packages/types/src/destination.ts` | `HippoShopDestinationDTO` gains `id`, `funnelId`, `url`; Pre/Post-Purchase docblock fix |
| `packages/types/src/funnel.ts` | `HippoShopFunnelStepDTO` gains `id` |

**`GH-Commerce-Service`** (worktree off `prerelease`)

| File | Responsibility |
|---|---|
| `src/controllers/hippo-shop/HippoShop.controller.ts` | Public `POST /v1/session` route + handler |
| `src/services/hippo-shop/HippoShop.service.ts` | Destination identity pass-through, destination URL SOQL, DTO serialization |
| `src/services/session/Session.service.ts` | Response-key fix, negative visitor-lookup cache, log removal |
| `src/controllers/session/Session.controller.ts` | Log removal |
| `src/controllers/hippo-shop/HippoShop.spec.ts` | Zod DTO mirrors — must change in the same commit as the pin bump (bidirectional `Equals` guards) |
| `src/services/destination/DestinationUrl.config.ts` *(new)* | The sObject/field strings, isolated so an empty value issues no query |
| `src/services/destination/DestinationUrl.service.ts` *(new)* | Brand-scoped SOQL lookup for the destination URL; never fails the response |
| `package.json` | Types pin `^3.0.0` → `^4.0.0` (same commit as the Zod change) |

---
### Task 1: Shared cookie-jar test helper that records cookie attributes

**Files:**
- Create: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/helpers/cookie-jar.ts`
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/cookies.spec.ts` (line 1 import list; append a new `describe` after line 129)

**Interfaces:**
- Produces: `installCookieJar(): CookieJar`, `interface CookieJar { get(name: string): RecordedCookie | undefined; seed(name: string, value: string): void; writes: string[]; names(): string[]; clear(): void; restore(): void }`, `interface RecordedCookie { value: string; rawValue: string; domain: string | null; maxAge: number | null; path: string | null; sameSite: string | null; secure: boolean; raw: string }`
- Consumes: `writeCookie`, `readCookie`, `deleteCookie` from `packages/sdk/src/cookies.ts` (unchanged)

Three hand-rolled jars exist today (`test/cookies.spec.ts:70-101`, `test/session.spec.ts:73-98`, `test/session.spec.ts:183-203`); none records `Domain`, `Max-Age` or `SameSite`, so the D2 root-domain contract is currently unassertable. This task adds the recording jar; Task 4 deletes both copies; Tasks 5–6 use the shared jar in `session.spec.ts`.

- [ ] **Step 1: Write the failing test** — replace line 1 of `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/cookies.spec.ts` with the import below, then append the `describe` block to the end of that file (after line 129).

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
```

```ts
import { installCookieJar, type CookieJar } from './helpers/cookie-jar';

describe('cookie attributes (recorded by the shared jar helper)', () => {
  let jar: CookieJar;

  beforeEach(() => {
    jar = installCookieJar();
    setHostname('info.example.com');
  });

  afterEach(() => {
    jar.restore();
  });

  it('records Domain, Max-Age, Path, SameSite and Secure for a write', () => {
    writeCookie('hippo_session_id', 'abc-123', {
      maxAgeSec: 2_592_000,
      domain: '.example.com',
    });
    const rec = jar.get('hippo_session_id');
    expect(rec).toBeDefined();
    expect(rec!.value).toBe('abc-123');
    expect(rec!.domain).toBe('.example.com');
    expect(rec!.maxAge).toBe(2_592_000);
    expect(rec!.path).toBe('/');
    expect(rec!.sameSite).toBe('Lax');
    expect(rec!.secure).toBe(true);
  });

  it('records a host-only write as domain null', () => {
    writeCookie('host_only', 'v', { maxAgeSec: 60, domain: null });
    expect(jar.get('host_only')!.domain).toBeNull();
  });

  it('seed() makes a cookie readable through readCookie', () => {
    jar.seed('hippo_session_id', 'seeded-id');
    expect(readCookie('hippo_session_id')).toBe('seeded-id');
  });

  it('Max-Age=0 removes the cookie from the jar', () => {
    writeCookie('gone', 'v', { maxAgeSec: 60, domain: null });
    deleteCookie('gone', null);
    expect(jar.get('gone')).toBeUndefined();
    expect(jar.names()).not.toContain('gone');
  });

  it('keeps every raw write string in order', () => {
    writeCookie('a', '1', { maxAgeSec: 60, domain: null });
    writeCookie('b', '2', { maxAgeSec: 60, domain: '.example.com' });
    expect(jar.writes).toHaveLength(2);
    expect(jar.writes[1]).toContain('Domain=.example.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/cookies.spec.ts
```

Expected failure: the whole file errors before any test runs — `Failed to resolve import "./helpers/cookie-jar" from "test/cookies.spec.ts". Does the file exist?`

- [ ] **Step 3: Write minimal implementation** — create `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/helpers/cookie-jar.ts` with exactly this content:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/cookies.spec.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/test/helpers/cookie-jar.ts packages/sdk/test/cookies.spec.ts && git commit -m "test(sdk): shared cookie jar helper that records cookie attributes"
```

---

### Task 2: `SESSION_ID_PATTERN` and `readSessionIdFromUrl`

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/url-params.ts` (append after line 137, end of file)
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/url-params.spec.ts` (append after line 103, end of file)

**Interfaces:**
- Produces: `SESSION_ID_PATTERN: RegExp` (`/^[A-Za-z0-9._-]{1,128}$/`), `readSessionIdFromUrl(search: string): string | null`
- Consumes: nothing. Deliberately **not** a member of `ParsedParams` — the session id travels in its own `affParameters.sessionId` slot, so folding it into the parsed params would double-send it.

- [ ] **Step 1: Write the failing test** — append to the end of `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/url-params.spec.ts`. The second `import` statement is legal ESM and keeps this block independent of the Cluster G attribution rewrite of the same file's first import.

```ts
import { readSessionIdFromUrl, SESSION_ID_PATTERN } from '../src/url-params';

describe('readSessionIdFromUrl', () => {
  it('returns the value of ?sessionid= when it passes the pattern', () => {
    expect(readSessionIdFromUrl('?sessionid=3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455')).toBe(
      '3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455',
    );
  });

  it('accepts a search string with no leading question mark', () => {
    expect(readSessionIdFromUrl('sessionid=abc.DEF-123_456')).toBe('abc.DEF-123_456');
  });

  it('accepts the legacy 26-digit numeric shape', () => {
    expect(readSessionIdFromUrl('?sessionid=12345678901234567890123456')).toBe(
      '12345678901234567890123456',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(readSessionIdFromUrl('?sessionid=%20abc123%20')).toBe('abc123');
  });

  it('returns null when the param is absent', () => {
    expect(readSessionIdFromUrl('?utm_source=fb')).toBeNull();
    expect(readSessionIdFromUrl('')).toBeNull();
  });

  it('returns null for a blank value', () => {
    expect(readSessionIdFromUrl('?sessionid=')).toBeNull();
    expect(readSessionIdFromUrl('?sessionid=%20%20')).toBeNull();
  });

  it('is case-sensitive on the key — ?SessionId= is ignored', () => {
    expect(readSessionIdFromUrl('?SessionId=abc123')).toBeNull();
    expect(readSessionIdFromUrl('?SESSIONID=abc123')).toBeNull();
  });

  it('rejects values carrying cookie-attribute delimiters', () => {
    expect(readSessionIdFromUrl('?sessionid=abc%3B%20Max-Age%3D0')).toBeNull();
    expect(readSessionIdFromUrl('?sessionid=a%2Cb')).toBeNull();
    expect(readSessionIdFromUrl('?sessionid=a%3Db')).toBeNull();
  });

  it('caps the value at 128 characters', () => {
    expect(readSessionIdFromUrl(`?sessionid=${'a'.repeat(128)}`)).toBe('a'.repeat(128));
    expect(readSessionIdFromUrl(`?sessionid=${'a'.repeat(129)}`)).toBeNull();
  });

  it('SESSION_ID_PATTERN rejects whitespace, CR/LF and the empty string', () => {
    expect(SESSION_ID_PATTERN.test('a b')).toBe(false);
    expect(SESSION_ID_PATTERN.test('a\nb')).toBe(false);
    expect(SESSION_ID_PATTERN.test('')).toBe(false);
    expect(SESSION_ID_PATTERN.test('3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/url-params.spec.ts
```

Expected failure: `SyntaxError: The requested module '/src/url-params.ts' does not provide an export named 'SESSION_ID_PATTERN'` (the whole file fails to load).

- [ ] **Step 3: Write minimal implementation** — append to the end of `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/url-params.ts`:

```ts
/**
 * Allowlist for URL-sourced session ids, matching the funnel app's
 * `SESSION_ID_PATTERN` (`hippo-builder-funnel` session.service.ts:23).
 * Permissive enough for every legitimate handoff shape (UUIDv4, legacy
 * 26-digit numeric, hyphenated alphanumeric) but excludes cookie-attribute
 * delimiters (`;`, `=`, `,`, whitespace, CR/LF): the funnel writes this value
 * into `document.cookie` unencoded, so a crafted `?sessionid=` could otherwise
 * inject attributes such as `Max-Age=0`. The 128-char cap bounds header size.
 */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Read `?sessionid=` from a query string. Returns the trimmed value when it
 * passes SESSION_ID_PATTERN, else null — absent, blank and malformed are the
 * same answer to the caller, which falls through to the cookie.
 *
 * The key is matched **case-sensitively** (`URLSearchParams.get` is exact)
 * because the funnel reads `sessionid` case-sensitively (session.service.ts:85).
 *
 * Deliberately NOT a `ParsedParams` field: the resolved id is posted in its own
 * `affParameters.sessionId` slot, so parsing it here as well would double-send it.
 *
 * @param search A query string, with or without the leading `?`.
 */
export function readSessionIdFromUrl(search: string): string | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get('sessionid');
  } catch {
    return null;
  }
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (!SESSION_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/url-params.spec.ts && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/url-params.ts packages/sdk/test/url-params.spec.ts && git commit -m "feat(sdk): read and validate the ?sessionid= handoff param"
```

---

### Task 3: `generateSessionId` becomes an RFC-4122 v4 UUID

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts` (delete line 23 `SESSION_ID_LENGTH`; replace lines 39-57, the docblock plus `generateSessionId`)
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session.spec.ts` (replace lines 41-67, the whole `describe('generateSessionId')` block; then rewrite the four remaining `/^\d{12}$/` assertions at lines 121, 159, 170, 210)

**Interfaces:**
- Produces: `generateSessionId(): string` — a v4 UUID. Replaces Cluster F's 12-character numeric generator entirely; the golden-value test at `test/session.spec.ts:48-54` and the `/^\d{12}$/` test at `:42-46` are deleted, not kept. Nothing parses the legacy format (spec open question 2).
- Consumes: `globalThis.crypto` only.

- [ ] **Step 1: Write the failing test** — replace lines 41-67 of `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session.spec.ts` (the entire `describe('generateSessionId', ...)` block, from `describe('generateSessionId', () => {` through its closing `});`) with:

```ts
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateSessionId', () => {
  it('returns an RFC-4122 v4 UUID', () => {
    const id = generateSessionId();
    expect(id).toMatch(UUID_V4_RE);
    expect(id.length).toBe(36);
  });

  it('returns a different id on each call', () => {
    expect(generateSessionId()).not.toBe(generateSessionId());
  });

  it('delegates to crypto.randomUUID when it exists', () => {
    const randomUUID = vi.fn().mockReturnValue('11111111-2222-4333-8444-555555555555');
    vi.stubGlobal('crypto', {
      randomUUID,
      getRandomValues: () => {
        throw new Error('getRandomValues must not be called when randomUUID exists');
      },
    });
    expect(generateSessionId()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('falls back to a getRandomValues v4 when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (buf: Uint8Array) => {
        buf.fill(0xff);
        return buf;
      },
    });
    // All-0xff bytes with the version/variant bits forced: byte 6 -> 0x4f, byte 8 -> 0xbf.
    expect(generateSessionId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(generateSessionId()).toMatch(UUID_V4_RE);
  });

  it('throws when neither randomUUID nor getRandomValues exists', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => generateSessionId()).toThrow(/no Web Crypto available/);
  });
});
```

- [ ] **Step 2: Rewrite the four surviving legacy-format assertions in the same file**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && perl -pi -e 's{/\^\\d\{12\}\$/}{UUID_V4_RE}g' test/session.spec.ts && grep -n 'UUID_V4_RE' test/session.spec.ts
```

Expected: `grep` lists the `const UUID_V4_RE` declaration plus five `UUID_V4_RE` uses in the `generateSessionId` block and four more at the former lines 121, 159, 170 and 210.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/session.spec.ts
```

Expected failure: `expected '873724800000' to match /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` and `expected [Function] to throw error matching /no Web Crypto available/ but it didn't`.

- [ ] **Step 4: Write minimal implementation** — in `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts`, delete line 23 (`const SESSION_ID_LENGTH = 12;`) and replace lines 39-57 (the `Port of generateSessionId ...` docblock through the closing brace of the function) with:

```ts
/**
 * Mint a session id as an RFC-4122 v4 UUID, matching the funnel app's
 * `generateUniqueSessionId` (`hippo-builder-funnel` session.service.ts:164-184).
 *
 * `crypto.randomUUID()` when available; otherwise an explicit v4 built from
 * `crypto.getRandomValues` (insecure-context browsers expose the latter but not
 * the former). There is no `Math.random()` path: if neither exists we throw
 * rather than mint a guessable id.
 *
 * This replaces Cluster F's 12-character numeric generator. Nothing parses that
 * format — the funnel app already emits UUIDv4 into the same pipeline.
 */
export function generateSessionId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'session.generateSessionId: no Web Crypto available (globalThis.crypto missing) — ' +
        'cannot mint a session id in this runtime',
    );
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run && pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/session.ts packages/sdk/test/session.spec.ts && git commit -m "feat(sdk)!: mint session ids as crypto UUIDv4, dropping the 12-digit format"
```

---

### Task 4: `SessionState` drops `hasConnectSid`; the connect.sid gate is deleted

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts` (module docblock lines 1-13; constants lines 20-24; `SessionState` lines 26-30; `ensureSession` lines 64-111 — all pre-Task-3 line numbers, shifted by Task 3's edit)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts` (line 85)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts` (line 91)
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session.spec.ts` (replace the `setHostname` helper, and the entire `describe('ensureSession')` and `describe('getSessionState')` blocks — both hand-rolled cookie jars go away)
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/checkout.spec.ts` (lines 47-53, `makeSession`)

**Interfaces:**
- Produces: `interface SessionState { sessionId: string; adopted: boolean; params: ParsedParams }` — no `hasConnectSid`, and `params` is not nullable.
- Consumes: `installCookieJar` (Task 1), `generateSessionId` (Task 3), `getCookieDomain`, `readCookie`, `writeCookie`, `parseLandingParams`.

`connect.sid` is `httpOnly`, so `document.cookie` never sees it: `hasConnectSid` was always false and the gate at `session.ts:86-91` was dead code (spec D4). The edits to `runtime.ts` and `index.ts` here are the minimum needed to keep the tree compiling; the checkout/boot task groups replace both call sites with the session thunk.

- [ ] **Step 1: Write the failing test** — in `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session.spec.ts`: replace the `setHostname` helper (lines 20-25) with the `setLocation` helper below, change the top-level `beforeEach` call `setHostname('localhost');` to `setLocation('https://localhost/');`, add the `installCookieJar` import, and replace both the `describe('ensureSession', ...)` and `describe('getSessionState', ...)` blocks wholesale with the blocks below.

```ts
import { installCookieJar, type CookieJar } from './helpers/cookie-jar';

function setLocation(href: string): void {
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    value: {
      ...window.location,
      href: url.href,
      hostname: url.hostname,
      protocol: url.protocol,
      pathname: url.pathname,
      search: url.search,
    },
    writable: true,
    configurable: true,
  });
}
```

```ts
describe('ensureSession', () => {
  let client: GhDataClient;
  let postSpy: ReturnType<typeof vi.fn>;
  let jar: CookieJar;

  beforeEach(() => {
    jar = installCookieJar();
    client = new GhDataClient(makeConfig(), createLogger(false));
    postSpy = vi.fn().mockResolvedValue({});
    client.postJson = postSpy as never;
    setLocation('https://info.gundrymd.com/funnel');
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });
  });

  afterEach(() => {
    jar.restore();
  });

  it('parses URL params, mints a session id and POSTs /session', async () => {
    setLocation('https://info.gundrymd.com/funnel?utm_source=fb');

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(state.params).toMatchObject({ utmSource: 'fb' });
    expect(postSpy).toHaveBeenCalledWith('session', {
      affParameters: expect.objectContaining({ utmSource: 'fb' }),
    });
  });

  it('POSTs even when a connect.sid cookie is present — the gate is gone', async () => {
    jar.seed('connect.sid', 's:fakevalue');
    const state = await ensureSession(makeConfig(), client);
    expect(postSpy).toHaveBeenCalledOnce();
    expect(state.params.landingUrl).toContain('gundrymd.com');
  });

  it('SessionState is exactly { sessionId, adopted, params }', async () => {
    const state = await ensureSession(makeConfig(), client);
    expect(Object.keys(state).sort()).toEqual(['adopted', 'params', 'sessionId']);
    expect('hasConnectSid' in state).toBe(false);
    expect(state.params).not.toBeNull();
  });

  it('reuses an existing session cookie instead of minting', async () => {
    jar.seed(SESSION_COOKIE_NAME, '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f');
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f');
    expect(state.adopted).toBe(false);
  });

  it('on POST failure still resolves with an id and locally-parsed params', async () => {
    postSpy.mockRejectedValueOnce(new Error('network blew up'));
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(state.params.landingUrl).toContain('gundrymd.com');
  });

  it('fires gh:session-ready on window after resolving', async () => {
    const handler = vi.fn();
    window.addEventListener('gh:session-ready', handler);
    await ensureSession(makeConfig(), client);
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toMatchObject({
      sessionId: expect.stringMatching(UUID_V4_RE),
      adopted: false,
    });
  });

  it('is idempotent — a second call returns the cached state without re-POSTing', async () => {
    const first = await ensureSession(makeConfig(), client);
    const second = await ensureSession(makeConfig(), client);
    expect(second).toBe(first);
    expect(postSpy).toHaveBeenCalledOnce();
  });
});

describe('getSessionState', () => {
  let jar: CookieJar;

  beforeEach(() => {
    jar = installCookieJar();
    setLocation('https://info.gundrymd.com/funnel');
  });

  afterEach(() => {
    jar.restore();
  });

  it('returns null before ensureSession resolves', () => {
    expect(getSessionState()).toBeNull();
  });

  it('returns the resolved state after ensureSession completes', async () => {
    const client = new GhDataClient(makeConfig(), createLogger(false));
    client.postJson = vi.fn().mockResolvedValue({}) as never;
    await ensureSession(makeConfig(), client);
    expect(getSessionState()).not.toBeNull();
    expect(getSessionState()?.sessionId).toMatch(UUID_V4_RE);
    expect(getSessionState()?.adopted).toBe(false);
  });
});
```

- [ ] **Step 2: Import `SESSION_COOKIE_NAME` in the spec** — replace line 2 of `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session.spec.ts` with:

```ts
import {
  ensureSession,
  generateSessionId,
  getSessionState,
  SESSION_COOKIE_NAME,
  _resetForTests,
} from '../src/session';
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/session.spec.ts
```

Expected failure: `expected [ 'hasConnectSid', 'params', 'sessionId' ] to deeply equal [ 'adopted', 'params', 'sessionId' ]`, plus `expected true to be false` on `'hasConnectSid' in state`, plus `expected undefined to be false` on `state.adopted`, plus the connect.sid test failing with `expected "spy" to be called once, but it was called 0 times`.

- [ ] **Step 4: Write minimal implementation** — in `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts` replace the module docblock (lines 1-13) with:

```ts
/**
 * Cluster G session lifecycle (spec D1/D2/D4).
 *
 * Resolves the visitor's session id, persists it to the root-domain
 * `hippo_session_id` cookie, parses landing attribution, and POSTs it once per
 * page load to /public/v1/session. Fires `gh:session-ready` on `window` when it
 * resolves — on success and on swallowed failure alike.
 *
 * `connect.sid` is deliberately absent: it is httpOnly and belongs to the API,
 * so `document.cookie` can never observe it. Cluster F's gate on that cookie was
 * dead code and is deleted.
 *
 * Every reachable failure path is non-fatal: a blocked cookie write or a failed
 * POST degrades attribution; the page never breaks.
 */
```

Then replace the constants block (`export const SESSION_COOKIE_NAME` through `const SESSION_READY_EVENT`) with:

```ts
export const SESSION_COOKIE_NAME = 'sessionId';
const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const SESSION_READY_EVENT = 'gh:session-ready';
```

Then replace the `SessionState` interface with:

```ts
export interface SessionState {
  /** Resolved session id: adopted from `?sessionid=`, restored from the cookie, or minted. */
  sessionId: string;
  /** True when the id came from `?sessionid=` on this page load (spec D1 handoff). */
  adopted: boolean;
  /** Landing-URL attribution. Always parsed — never null (spec D4). */
  params: ParsedParams;
}
```

Then replace the whole body of `ensureSession` with:

```ts
export async function ensureSession(
  config: GhConfig,
  client: GhDataClient,
): Promise<SessionState> {
  if (cachedState) return cachedState;

  const domain = getCookieDomain(config);

  let sessionId = readCookie(SESSION_COOKIE_NAME);
  if (!sessionId) {
    sessionId = generateSessionId();
    try {
      writeCookie(SESSION_COOKIE_NAME, sessionId, { maxAgeSec: SESSION_TTL_SEC, domain });
    } catch {
      // Cookie write blocked (third-party context, quota). The id still lives
      // in memory for this page load and still rides outbound links.
    }
  }

  const href = typeof window !== 'undefined' ? window.location.href : '';
  const referrer = typeof document !== 'undefined' ? document.referrer : '';
  const params = parseLandingParams(href, referrer);

  try {
    // D4: POST once per page load, unconditionally. The attribution task group
    // extends this body with `sessionId` and empty-value pruning.
    await client.postJson('session', { affParameters: params });
  } catch {
    // Network or non-2xx: attribution degrades, the page never breaks.
  }

  const state: SessionState = { sessionId, adopted: false, params };
  cachedState = state;
  fireReady(state);
  return state;
}
```

- [ ] **Step 5: Fix the two `SessionState` construction sites so the tree still compiles** — in `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts` line 85, replace:

```ts
    const session = getSessionState() ?? { sessionId: '', hasConnectSid: false, params: null };
```

with:

```ts
    const session = getSessionState() ?? { sessionId: '', adopted: false, params: {} };
```

and in `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts` line 91, replace:

```ts
    session: { sessionId: '', hasConnectSid: false, params: null }, // pre-resolve stub
```

with:

```ts
    session: { sessionId: '', adopted: false, params: {} }, // pre-resolve stub
```

Then in `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/checkout.spec.ts` lines 47-53, replace `makeSession` with:

```ts
function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: '3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455',
    adopted: false,
    params: {},
    ...overrides,
  };
}
```

- [ ] **Step 6: Run the full suite and typecheck to verify they pass**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run && pnpm exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/session.ts packages/sdk/src/runtime.ts packages/sdk/src/index.ts packages/sdk/test/session.spec.ts packages/sdk/test/checkout.spec.ts && git commit -m "refactor(sdk)!: drop hasConnectSid and the dead connect.sid gate from SessionState"
```

---

### Task 5: `SESSION_COOKIE_NAME` becomes `hippo_session_id`, root-domain scoped

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts` (the `SESSION_COOKIE_NAME` constant)
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session.spec.ts` (append a new `describe` at the end of the file)

**Interfaces:**
- Produces: `SESSION_COOKIE_NAME: 'hippo_session_id'`
- Consumes: `getCookieDomain(config)` (unchanged, `src/cookies.ts:42-59`), `installCookieJar` (Task 1)

D2: name `hippo_session_id`, `Max-Age` 30 days, `Path=/`, `SameSite=Lax`, `Secure` on https, `Domain` at the registrable root. This deliberately diverges from the funnel's host-only cookie — root scoping is what makes the `sf.brand.com` → `www.brand.com` handoff work.

- [ ] **Step 1: Write the failing test** — append to the end of `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session.spec.ts`:

```ts
describe('session cookie contract (D2)', () => {
  let client: GhDataClient;
  let jar: CookieJar;

  beforeEach(() => {
    jar = installCookieJar();
    client = new GhDataClient(makeConfig(), createLogger(false));
    client.postJson = vi.fn().mockResolvedValue({}) as never;
  });

  afterEach(() => {
    jar.restore();
  });

  it('uses the funnel-canonical cookie name', () => {
    expect(SESSION_COOKIE_NAME).toBe('hippo_session_id');
  });

  it('writes the cookie at the registrable root domain from a subdomain host', async () => {
    setLocation('https://sf.example.com/offer');
    const state = await ensureSession(makeConfig(), client);
    const rec = jar.get('hippo_session_id');
    expect(rec).toBeDefined();
    expect(rec!.value).toBe(state.sessionId);
    expect(rec!.domain).toBe('.example.com');
    expect(rec!.maxAge).toBe(2_592_000); // 30 days
    expect(rec!.path).toBe('/');
    expect(rec!.sameSite).toBe('Lax');
    expect(rec!.secure).toBe(true);
  });

  it('honours an explicit data-cookie-domain override for multi-part TLDs', async () => {
    setLocation('https://sf.brand.co.uk/offer');
    await ensureSession(makeConfig({ cookieDomain: '.brand.co.uk' }), client);
    expect(jar.get('hippo_session_id')!.domain).toBe('.brand.co.uk');
  });

  it('never writes the Cluster F sessionId cookie name', async () => {
    setLocation('https://sf.example.com/offer');
    await ensureSession(makeConfig(), client);
    expect(jar.names()).toContain('hippo_session_id');
    expect(jar.names()).not.toContain('sessionId');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/session.spec.ts
```

Expected failure: `expected 'sessionId' to be 'hippo_session_id'`, and in the three remaining tests `expected undefined to be defined` / `expected [ 'sessionId' ] not to contain 'sessionId'`.

- [ ] **Step 3: Write minimal implementation** — in `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts`, replace:

```ts
export const SESSION_COOKIE_NAME = 'sessionId';
```

with:

```ts
/**
 * D2. Same name as the funnel app (`hippo-builder-funnel` session.service.ts:11)
 * so a visitor arriving from a funnel page keeps one identity — but written
 * root-domain scoped rather than host-only, which is what makes the
 * `sf.brand.com` -> `www.brand.com` handoff work without the URL. The resulting
 * two-scope collision is benign only because the funnel's own ladder puts
 * `?sessionid=` above the cookie, which is why every outbound link must carry it.
 */
export const SESSION_COOKIE_NAME = 'hippo_session_id';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/session.ts packages/sdk/test/session.spec.ts && git commit -m "feat(sdk)!: rename the session cookie to hippo_session_id at the root domain"
```

---

### Task 6: The D1 three-step resolution ladder in `ensureSession`

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts` (imports at the top; the id-resolution block inside `ensureSession`; add two module-private helpers below `ensureSession`)
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session.spec.ts` (append a new `describe` at the end of the file)

**Interfaces:**
- Produces: `ensureSession(config: GhConfig, client: GhDataClient): Promise<SessionState>` with `sessionId` resolved as `?sessionid=` → `hippo_session_id` cookie → mint, and `adopted: true` exactly when the id came from the URL.
- Consumes: `readSessionIdFromUrl` (Task 2), `SESSION_COOKIE_NAME` (Task 5), `generateSessionId` (Task 3), `createLogger`/`Logger` from `packages/sdk/src/log.ts`.

Accepting a URL-supplied id is session fixation by design; the blast radius here is analytics only. The mitigations are `SESSION_ID_PATTERN`, the debug-mode adoption log, and the `SPEC.md` note (docs task group).

- [ ] **Step 1: Write the failing test** — append to the end of `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session.spec.ts`:

```ts
describe('ensureSession — D1 resolution ladder', () => {
  let client: GhDataClient;
  let postSpy: ReturnType<typeof vi.fn>;
  let jar: CookieJar;

  beforeEach(() => {
    jar = installCookieJar();
    client = new GhDataClient(makeConfig(), createLogger(false));
    postSpy = vi.fn().mockResolvedValue({});
    client.postJson = postSpy as never;
    setLocation('https://sf.example.com/offer');
  });

  afterEach(() => {
    jar.restore();
  });

  it('adopts ?sessionid= over a different cookie value', async () => {
    jar.seed('hippo_session_id', 'cookie-value-111');
    setLocation('https://sf.example.com/offer?sessionid=url-value-222');
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('url-value-222');
    expect(state.adopted).toBe(true);
  });

  it('persists the adopted id to the cookie at the root domain', async () => {
    jar.seed('hippo_session_id', 'cookie-value-111');
    setLocation('https://sf.example.com/offer?sessionid=url-value-222');
    await ensureSession(makeConfig(), client);
    const rec = jar.get('hippo_session_id');
    expect(rec!.value).toBe('url-value-222');
    expect(rec!.domain).toBe('.example.com');
    expect(rec!.maxAge).toBe(2_592_000);
    expect(rec!.sameSite).toBe('Lax');
  });

  it('falls through to the cookie when ?sessionid= is malformed, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    jar.seed('hippo_session_id', 'cookie-value-111');
    setLocation('https://sf.example.com/offer?sessionid=bad%20value%3B%20Max-Age%3D0');

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toBe('cookie-value-111');
    expect(state.adopted).toBe(false);
    expect(warn).toHaveBeenCalledWith('[gh]', expect.stringContaining('malformed ?sessionid='));
    expect(jar.get('hippo_session_id')!.value).toBe('cookie-value-111');
  });

  it('mints a v4 UUID when there is no URL param and no cookie', async () => {
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(state.adopted).toBe(false);
    expect(jar.get('hippo_session_id')!.value).toBe(state.sessionId);
  });

  it('adopts ?sessionid= when no cookie exists at all', async () => {
    setLocation('https://sf.example.com/offer?sessionid=3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455');
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455');
    expect(state.adopted).toBe(true);
    expect(jar.get('hippo_session_id')!.value).toBe('3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455');
  });

  it('ignores ?SessionId= — the key is read case-sensitively', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    jar.seed('hippo_session_id', 'cookie-value-111');
    setLocation('https://sf.example.com/offer?SessionId=url-value-222');
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('cookie-value-111');
    expect(state.adopted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs the adoption in debug mode', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setLocation('https://sf.example.com/offer?sessionid=url-value-222');
    await ensureSession(makeConfig({ debug: true }), client);
    expect(debug).toHaveBeenCalledWith(
      '[gh]',
      expect.stringContaining('adopting ?sessionid='),
      'url-value-222',
    );
  });

  it('still resolves the adopted id when the cookie write is blocked', async () => {
    setLocation('https://sf.example.com/offer?sessionid=url-value-222');
    const setter = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new Error('cookie write blocked');
    });
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('url-value-222');
    expect(state.adopted).toBe(true);
    setter.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/session.spec.ts
```

Expected failure: `expected 'cookie-value-111' to be 'url-value-222'` on the adoption test, `expected false to be true` on `state.adopted`, and `expected "warn" to be called with arguments: [ '[gh]', StringContaining "malformed ?sessionid=" ]` — the warn spy has zero calls.

- [ ] **Step 3: Write minimal implementation** — in `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts`, replace the two import lines for `./cookies` and `./url-params` with:

```ts
import { getCookieDomain, readCookie, writeCookie } from './cookies';
import { parseLandingParams, readSessionIdFromUrl, type ParsedParams } from './url-params';
import { createLogger, type Logger } from './log';
```

Then replace the id-resolution block inside `ensureSession` — everything from `const domain = getCookieDomain(config);` through the closing brace of the `if (!sessionId) { ... }` block — with:

```ts
  const logger = createLogger(config.debug);
  const domain = getCookieDomain(config);
  const search = typeof window !== 'undefined' ? window.location.search : '';

  const resolved = resolveSessionId(search, logger);
  if (resolved.persist) {
    try {
      writeCookie(SESSION_COOKIE_NAME, resolved.sessionId, {
        maxAgeSec: SESSION_TTL_SEC,
        domain,
      });
    } catch {
      // Cookie write blocked (third-party context, quota). The id still lives
      // in memory for this page load and still rides outbound links.
    }
  }
```

Then change the state construction at the end of `ensureSession` from `const state: SessionState = { sessionId, adopted: false, params };` to:

```ts
  const state: SessionState = {
    sessionId: resolved.sessionId,
    adopted: resolved.adopted,
    params,
  };
```

Then add these two helpers immediately below `ensureSession`:

```ts
interface ResolvedSessionId {
  sessionId: string;
  /** True when the id came from `?sessionid=`. */
  adopted: boolean;
  /** True when the id must be written to the cookie. */
  persist: boolean;
}

/**
 * D1 resolution ladder, mirroring `hippo-builder-funnel`
 * session.service.ts:54-93:
 *
 *  1. `?sessionid=` — validated by SESSION_ID_PATTERN, adopted even when a
 *     *different* cookie value already exists, and re-persisted every time so
 *     the 30-day window refreshes. Malformed values warn and fall through.
 *  2. the `hippo_session_id` cookie.
 *  3. a freshly minted UUIDv4.
 *
 * Accepting a URL-supplied id is session fixation by design; for this pilot the
 * blast radius is analytics, not authentication or payment. The regex and the
 * debug log line are the mitigations.
 */
function resolveSessionId(search: string, logger: Logger): ResolvedSessionId {
  const fromUrl = readSessionIdFromUrl(search);
  if (fromUrl) {
    logger.debug('session: adopting ?sessionid= handoff', fromUrl);
    return { sessionId: fromUrl, adopted: true, persist: true };
  }

  if (hasSessionIdParam(search)) {
    logger.warn('session: ignoring malformed ?sessionid= handoff param');
  }

  const fromCookie = readCookie(SESSION_COOKIE_NAME);
  if (fromCookie) return { sessionId: fromCookie, adopted: false, persist: false };

  return { sessionId: generateSessionId(), adopted: false, persist: true };
}

/** True when a non-blank `sessionid` key is present, whatever its value. */
function hasSessionIdParam(search: string): boolean {
  try {
    return !!new URLSearchParams(search).get('sessionid')?.trim();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm exec eslint src
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/session.ts packages/sdk/test/session.spec.ts && git commit -m "feat(sdk): adopt an inbound ?sessionid= handoff over the session cookie"
```

---

### Task 7: `url-params.ts` — accept the canonical `subidN` inbound spelling alongside legacy `sub_idN`

**Files:**
- Modify: `packages/sdk/src/url-params.ts` (lines 65–71, the `SUB_ID_KEY_MAP` constant; lines 124–128, the sub-id branch inside `parseLandingParams`)
- Test: `packages/sdk/test/url-params.spec.ts` (delete lines 54–58; append a new `describe` block at end of file)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change. `parseLandingParams(href: string, referrer: string): ParsedParams` keeps its shape; the `subId1`…`subId5` fields of `ParsedParams` are now populated from either `?subidN=` (canonical) or `?sub_idN=` (legacy), with canonical winning regardless of query-string order.

Context: spec D3, "Inbound sub-id spelling: accept both `subidN` (canonical) and `sub_idN` (legacy), canonical winning. Liberal inbound is free and protects against media-buyer variance. Outbound emits canonical only." Outbound naming is the checkout task group's work; this task is inbound only.

- [ ] **Step 1: Write the failing test**

First **delete** this now-obsolete test from `packages/sdk/test/url-params.spec.ts` (currently lines 54–58). It encodes Cluster F's inverted fbclid mapping (`subId5` receiving the click-id value), and it breaks in this task because legacy `sub_idN` stops overwriting a slot that is already filled. Task 8 adds the corrected replacement.

```typescript
  it('direct sub_id values take precedence over click-id-derived values', () => {
    const out = parseLandingParams(`${BASE}?fbclid=xyz&sub_id1=manual`, '');
    expect(out.subId1).toBe('manual'); // direct wins over click-id-derived
    expect(out.subId5).toBe('xyz');     // no direct sub_id5; click-id fills it
  });
```

Then append this block to the end of `packages/sdk/test/url-params.spec.ts`, after the closing `});` of the existing `describe('parseLandingParams', …)`:

```typescript

describe('parseLandingParams — inbound sub-id spelling', () => {
  it('captures the canonical subid1–5 spelling', () => {
    const out = parseLandingParams(
      `${BASE}?subid1=a&subid2=b&subid3=c&subid4=d&subid5=e`,
      '',
    );
    expect(out.subId1).toBe('a');
    expect(out.subId2).toBe('b');
    expect(out.subId3).toBe('c');
    expect(out.subId4).toBe('d');
    expect(out.subId5).toBe('e');
  });

  it('still captures the legacy sub_id1–5 spelling', () => {
    const out = parseLandingParams(
      `${BASE}?sub_id1=a&sub_id2=b&sub_id3=c&sub_id4=d&sub_id5=e`,
      '',
    );
    expect(out.subId1).toBe('a');
    expect(out.subId5).toBe('e');
  });

  it('canonical subid1 wins when it appears after legacy sub_id1', () => {
    const out = parseLandingParams(`${BASE}?sub_id1=legacy&subid1=canonical`, '');
    expect(out.subId1).toBe('canonical');
  });

  it('canonical subid1 wins when it appears before legacy sub_id1', () => {
    const out = parseLandingParams(`${BASE}?subid1=canonical&sub_id1=legacy`, '');
    expect(out.subId1).toBe('canonical');
  });

  it('matches inbound sub-id keys case-insensitively', () => {
    const out = parseLandingParams(`${BASE}?SubID1=x&SUB_ID2=y`, '');
    expect(out.subId1).toBe('x');
    expect(out.subId2).toBe('y');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/url-params.spec.ts
```

Expected: `Tests  4 failed | 14 passed (18)`. The four failures are the canonical-spelling tests, each reporting `AssertionError: expected undefined to be 'a'` (or `'canonical'` / `'x'`) — the shipped `SUB_ID_KEY_MAP` only knows the `sub_idN` spelling, so `?subid1=` is dropped as an unknown parameter. `still captures the legacy sub_id1–5 spelling` passes already.

- [ ] **Step 3: Write the implementation**

In `packages/sdk/src/url-params.ts`, replace the `SUB_ID_KEY_MAP` constant (lines 65–71):

```typescript
const SUB_ID_KEY_MAP: Record<string, keyof ParsedParams> = {
  sub_id1: 'subId1',
  sub_id2: 'subId2',
  sub_id3: 'subId3',
  sub_id4: 'subId4',
  sub_id5: 'subId5',
};
```

with two maps:

```typescript
/** Canonical inbound spelling. Wins over the legacy `sub_idN` spelling. */
const SUB_ID_KEY_MAP: Record<string, keyof ParsedParams> = {
  subid1: 'subId1',
  subid2: 'subId2',
  subid3: 'subId3',
  subid4: 'subId4',
  subid5: 'subId5',
};

/** Legacy inbound spelling, accepted but never overwriting a canonical value. */
const LEGACY_SUB_ID_KEY_MAP: Record<string, keyof ParsedParams> = {
  sub_id1: 'subId1',
  sub_id2: 'subId2',
  sub_id3: 'subId3',
  sub_id4: 'subId4',
  sub_id5: 'subId5',
};
```

Then, inside `parseLandingParams`, replace the sub-id branch of the query-parameter loop (lines 124–128):

```typescript
    const subIdKey = SUB_ID_KEY_MAP[lower];
    if (subIdKey) {
      out[subIdKey] = cleanValue;
      continue;
    }
```

with:

```typescript
    const subIdKey = SUB_ID_KEY_MAP[lower];
    if (subIdKey) {
      out[subIdKey] = cleanValue;
      continue;
    }

    const legacySubIdKey = LEGACY_SUB_ID_KEY_MAP[lower];
    if (legacySubIdKey) {
      // Canonical `subidN` wins regardless of query-string order.
      if (out[legacySubIdKey] === undefined) out[legacySubIdKey] = cleanValue;
      continue;
    }
```

The loop already lowercases each inbound key (`const lower = key.toLowerCase()`), which is what makes `?SubID1=` and `?SUB_ID2=` match.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/url-params.spec.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  18 passed (18)`.

- [ ] **Step 5: Verify the whole SDK suite, typecheck, and lint are green**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test
pnpm --filter @goldenhippo/hippo-shop-sdk typecheck
pnpm --filter @goldenhippo/hippo-shop-sdk lint
```

Expected: `Tests  185 passed (185)` (186 shipped minus the one deleted in Step 1), and clean output from `tsc --noEmit` and `eslint src`.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/url-params.ts packages/sdk/test/url-params.spec.ts
git commit -m "feat(sdk): accept canonical subidN inbound spelling

The funnel emits and reads subid1..subid5; sub_id1..sub_id5 is a legacy
spelling that media buyers still hand-build. Accept both inbound, with
the canonical spelling winning regardless of query-string order.

Liberal inbound is free and protects against media-buyer variance;
outbound emits the canonical spelling only.

Part of Cluster G (D3 — attribution model corrections).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `url-params.ts` — replace the click-id registry with the canonical seven-row table

**Files:**
- Modify: `packages/sdk/src/url-params.ts` (lines 1–10, module docblock; lines 12–14, constants; lines 16–35, `ParsedParams`; lines 37–52, `ClickIdMutator` + `CLICK_ID_REGISTRY`; line 79, above `clean`; lines 104–112, the two parse passes; end of `parseLandingParams`)
- Modify: `packages/sdk/test/session.spec.ts` (lines 122–133 — stale expectation repair, only if still present)
- Test: `packages/sdk/test/url-params.spec.ts` (rewrite the import at lines 1–6; delete the fbclid mapping test, the `CLICK_ID_REGISTRY` test, and the click-id truncation test; append a new `describe` block)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  export interface ClickIdMapping {
    incoming: string;
    rawKey: 'fbclid' | 'gclid' | 'scCid' | 'qclid' | 'twclid' | 'ndclid' | 'wbraid';
    target: 'subId1' | 'subId4';
    platform: 'snap' | 'quora' | 'twitter' | 'nextdoor' | null;
  }
  export const CLICK_ID_MAP: readonly ClickIdMapping[];
  ```
  and seven new optional fields on `ParsedParams`: `fbclid`, `gclid`, `scCid`, `qclid`, `twclid`, `ndclid`, `wbraid` (all `?: string`; note the mixed-case `scCid`).
- Removes: `export type ClickIdMutator` and `export const CLICK_ID_REGISTRY`. The only consumer of either is the spec file edited in this task.

Context: spec D3. Cluster F shipped `fbclid → subId1='fb', subId5=<value>` — value and marker slots reversed, writing a literal `'fb'` no platform ever emits. Correct is `subId1=<raw value>` for `fbclid`/`gclid`/`ScCid`/`qclid`/`twclid`/`ndclid`; `subId4='wbraid:<value>'` for `wbraid`; a `subId5` marker only for `ScCid`→`snap`, `qclid`→`quora`, `twclid`→`twitter`, `ndclid`→`nextdoor`. Table order is precedence for the slot, and **each row's slot write and its marker are evaluated independently** — the `?fbclid=F&ScCid=S` case must yield `subId1='F'` *and* `subId5='snap'`.

- [ ] **Step 1: Write the failing test**

Replace the import block at the top of `packages/sdk/test/url-params.spec.ts` (lines 1–6):

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseLandingParams,
  CLICK_ID_REGISTRY,
  type ParsedParams,
} from '../src/url-params';
```

with:

```typescript
import { describe, it, expect } from 'vitest';
import { parseLandingParams, CLICK_ID_MAP } from '../src/url-params';
```

Delete these three tests from the same file — all three assert the inverted Cluster F mapping:

```typescript
  it('applies the fbclid mapping when fbclid is present', () => {
    const out = parseLandingParams(`${BASE}?fbclid=IwAR1abc`, '');
    expect(out.subId1).toBe('fb');
    expect(out.subId5).toBe('IwAR1abc');
  });
```

```typescript
  it('CLICK_ID_REGISTRY has the fbclid entry', () => {
    expect(typeof CLICK_ID_REGISTRY.fbclid).toBe('function');
    const params: ParsedParams = {};
    CLICK_ID_REGISTRY.fbclid('test-value', params);
    expect(params.subId1).toBe('fb');
    expect(params.subId5).toBe('test-value');
  });
```

```typescript
  it('truncates click-id values too', () => {
    const longValue = 'b'.repeat(300);
    const out = parseLandingParams(`${BASE}?fbclid=${longValue}`, '');
    expect(out.subId5!.length).toBe(255);
  });
```

Then append this block to the end of the file:

```typescript

describe('parseLandingParams — canonical click-id table', () => {
  it('CLICK_ID_MAP is the canonical seven-row table, in precedence order', () => {
    expect(CLICK_ID_MAP.map((row) => row.incoming)).toEqual([
      'fbclid',
      'gclid',
      'ScCid',
      'qclid',
      'twclid',
      'ndclid',
      'wbraid',
    ]);
    expect(CLICK_ID_MAP.map((row) => row.target)).toEqual([
      'subId1',
      'subId1',
      'subId1',
      'subId1',
      'subId1',
      'subId1',
      'subId4',
    ]);
    expect(CLICK_ID_MAP.map((row) => row.platform)).toEqual([
      null,
      null,
      'snap',
      'quora',
      'twitter',
      'nextdoor',
      null,
    ]);
  });

  it('fbclid → raw fbclid + subId1, no subId5 marker', () => {
    const out = parseLandingParams(`${BASE}?fbclid=IwAR1abc`, '');
    expect(out.fbclid).toBe('IwAR1abc');
    expect(out.subId1).toBe('IwAR1abc');
    expect(out.subId5).toBeUndefined();
  });

  it('gclid → raw gclid + subId1, no subId5 marker', () => {
    const out = parseLandingParams(`${BASE}?gclid=Cj0KCQjw`, '');
    expect(out.gclid).toBe('Cj0KCQjw');
    expect(out.subId1).toBe('Cj0KCQjw');
    expect(out.subId5).toBeUndefined();
  });

  it("ScCid → raw scCid + subId1 + subId5='snap'", () => {
    const out = parseLandingParams(`${BASE}?ScCid=sc-123`, '');
    expect(out.scCid).toBe('sc-123');
    expect(out.subId1).toBe('sc-123');
    expect(out.subId5).toBe('snap');
  });

  it('matches click-id keys case-insensitively (sccid)', () => {
    const out = parseLandingParams(`${BASE}?sccid=sc-123`, '');
    expect(out.scCid).toBe('sc-123');
    expect(out.subId1).toBe('sc-123');
    expect(out.subId5).toBe('snap');
  });

  it("qclid → raw qclid + subId1 + subId5='quora'", () => {
    const out = parseLandingParams(`${BASE}?qclid=q-123`, '');
    expect(out.qclid).toBe('q-123');
    expect(out.subId1).toBe('q-123');
    expect(out.subId5).toBe('quora');
  });

  it("twclid → raw twclid + subId1 + subId5='twitter'", () => {
    const out = parseLandingParams(`${BASE}?twclid=tw-123`, '');
    expect(out.twclid).toBe('tw-123');
    expect(out.subId1).toBe('tw-123');
    expect(out.subId5).toBe('twitter');
  });

  it("ndclid → raw ndclid + subId1 + subId5='nextdoor'", () => {
    const out = parseLandingParams(`${BASE}?ndclid=nd-123`, '');
    expect(out.ndclid).toBe('nd-123');
    expect(out.subId1).toBe('nd-123');
    expect(out.subId5).toBe('nextdoor');
  });

  it('wbraid → raw wbraid + prefixed subId4, never subId1 or subId5', () => {
    const out = parseLandingParams(`${BASE}?wbraid=wb-123`, '');
    expect(out.wbraid).toBe('wb-123');
    expect(out.subId4).toBe('wbraid:wb-123');
    expect(out.subId1).toBeUndefined();
    expect(out.subId5).toBeUndefined();
  });

  it("fbclid + ScCid: fbclid wins subId1, ScCid still marks subId5='snap'", () => {
    const out = parseLandingParams(`${BASE}?fbclid=F&ScCid=S`, '');
    expect(out.subId1).toBe('F');
    expect(out.subId5).toBe('snap');
    expect(out.fbclid).toBe('F');
    expect(out.scCid).toBe('S');
  });

  it('gclid + wbraid: distinct slots, no marker from either row', () => {
    const out = parseLandingParams(`${BASE}?gclid=G&wbraid=W`, '');
    expect(out.subId1).toBe('G');
    expect(out.subId4).toBe('wbraid:W');
    expect(out.subId5).toBeUndefined();
    expect(out.gclid).toBe('G');
    expect(out.wbraid).toBe('W');
  });

  it('an explicit subid1 beats a click-id for the slot but keeps the raw field', () => {
    const out = parseLandingParams(`${BASE}?fbclid=F&subid1=manual`, '');
    expect(out.subId1).toBe('manual');
    expect(out.fbclid).toBe('F');
  });

  it('an explicit subid4 beats wbraid, and an explicit subid5 beats a marker', () => {
    const out = parseLandingParams(`${BASE}?wbraid=W&subid4=manual&ScCid=S&subid5=mine`, '');
    expect(out.subId4).toBe('manual');
    expect(out.subId5).toBe('mine');
    expect(out.wbraid).toBe('W');
    expect(out.scCid).toBe('S');
  });

  it("strips [<>'\"`&] from the derived sub-id but not from the raw click-id field", () => {
    const out = parseLandingParams(`${BASE}?fbclid=a%3Cb%3E%27c%22d%60e%26f`, '');
    expect(out.fbclid).toBe('a<b>\'c"d`e&f');
    expect(out.subId1).toBe('abcdef');
  });

  it('skips an empty click-id entirely — no raw field, no slot, no marker', () => {
    const out = parseLandingParams(`${BASE}?fbclid=&ScCid=S`, '');
    expect('fbclid' in out).toBe(false);
    expect(out.subId1).toBe('S');
    expect(out.subId5).toBe('snap');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/url-params.spec.ts
```

Expected: `Tests  15 failed | 15 passed (30)`. The table-shape test fails with `TypeError: Cannot read properties of undefined (reading 'map')` because `CLICK_ID_MAP` does not exist yet (Vite resolves the missing named export to `undefined` rather than throwing at import time); the remaining fourteen fail with `AssertionError: expected undefined to be 'IwAR1abc'` and similar, since no raw click-id fields are populated.

- [ ] **Step 3: Write the implementation**

Make five edits to `packages/sdk/src/url-params.ts`.

**3a.** Replace the module docblock (lines 1–10):

```typescript
/**
 * Landing-URL parser: captures UTM, sub-id, and click-id query parameters and
 * produces a `ParsedParams` shape directly compatible with the
 * POST /public/v1/session `affParameters` request body.
 *
 * Explicit query parameters (e.g. a literal `?subid1=manual`) are parsed
 * first and win over click-id-derived values: URL author intent beats
 * inference.
 *
 * Canonical sources, ported for parity:
 * - click-id table: `hippo-builder-funnel/src/server/cid/click-id-normalizer.ts:35-43`
 * - landing/referral rules: `.../core/services/hippo-api/session.service.ts:133,138,143,145`
 *
 * See the Cluster G design spec, decision D3.
 */
```

**3b.** Add the click-id sanitize regex directly under the existing `CONTROL_CHARS_RE` declaration, so the constants block reads:

```typescript
const MAX_VALUE_CHARS = 255;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g; // ASCII control chars
/** Stripped from click-id-derived sub-id values only (click-id-normalizer.ts:45-50). */
const CLICK_ID_UNSAFE_RE = /[<>'"`&]/g;
```

(`MAX_VALUE_CHARS` stays for now; Task 9 removes it.)

**3c.** Add the seven raw fields to `ParsedParams`, replacing its closing lines:

```typescript
  subId4?: string;
  subId5?: string;
}
```

with:

```typescript
  subId4?: string;
  subId5?: string;
  /** Raw click-id values, forwarded verbatim (session.model.ts:22-30). Note the mixed-case `scCid`. */
  fbclid?: string;
  gclid?: string;
  scCid?: string;
  qclid?: string;
  twclid?: string;
  ndclid?: string;
  wbraid?: string;
}
```

**3d.** Replace the whole `ClickIdMutator` / `CLICK_ID_REGISTRY` block (lines 37–52):

```typescript
export type ClickIdMutator = (value: string, into: ParsedParams) => void;

/**
 * Maps a click-id query-param name to a function that writes channel-marker
 * and payload into ParsedParams. Each entry should: skip empty/non-string
 * values, and use `into` mutation rather than returning a new object.
 *
 * v1 ships with fbclid only. Adding a new mapping is a one-line entry.
 */
export const CLICK_ID_REGISTRY: Record<string, ClickIdMutator> = {
  fbclid: (value, into) => {
    if (!value) return;
    into.subId1 = 'fb';
    into.subId5 = value;
  },
};
```

with:

```typescript
export interface ClickIdMapping {
  /** Inbound param name in the ad platform's casing; matched case-insensitively. */
  incoming: string;
  /** `ParsedParams` field that receives the raw value. */
  rawKey: 'fbclid' | 'gclid' | 'scCid' | 'qclid' | 'twclid' | 'ndclid' | 'wbraid';
  /** Sub-id slot that receives the derived value. */
  target: 'subId1' | 'subId4';
  /** Marker written to `subId5` when that slot is unset; `null` writes no marker. */
  platform: 'snap' | 'quora' | 'twitter' | 'nextdoor' | null;
}

/**
 * The canonical click-id table, ported from
 * `hippo-builder-funnel/src/server/cid/click-id-normalizer.ts:35-43`.
 *
 * Table order is precedence for the `subId1`/`subId4` slot: the first row with
 * a non-empty value claims the slot, and an already-present value is never
 * overwritten. Each row's slot write and its `subId5` marker are evaluated
 * independently — a row that loses the slot still applies its marker when
 * `subId5` is unset.
 */
export const CLICK_ID_MAP: readonly ClickIdMapping[] = [
  { incoming: 'fbclid', rawKey: 'fbclid', target: 'subId1', platform: null },
  { incoming: 'gclid', rawKey: 'gclid', target: 'subId1', platform: null },
  { incoming: 'ScCid', rawKey: 'scCid', target: 'subId1', platform: 'snap' },
  { incoming: 'qclid', rawKey: 'qclid', target: 'subId1', platform: 'quora' },
  { incoming: 'twclid', rawKey: 'twclid', target: 'subId1', platform: 'twitter' },
  { incoming: 'ndclid', rawKey: 'ndclid', target: 'subId1', platform: 'nextdoor' },
  { incoming: 'wbraid', rawKey: 'wbraid', target: 'subId4', platform: null },
] as const;
```

**3e.** Add the case-insensitive lookup helper immediately above `function clean(value: string): string {`:

```typescript
/** First case-insensitive match for `key`, or null when absent. */
function findCaseInsensitive(params: URLSearchParams, key: string): string | null {
  const keyLower = key.toLowerCase();
  for (const [k, v] of params) {
    if (k.toLowerCase() === keyLower) return v;
  }
  return null;
}
```

**3f.** Reorder the two passes inside `parseLandingParams`. Delete the click-id pass that currently runs first (lines 104–110) and relabel the remaining pass — replace:

```typescript
  // Pass 1: click-id mutators (so direct params can overwrite them in pass 2).
  for (const [paramName, mutator] of Object.entries(CLICK_ID_REGISTRY)) {
    const raw = url.searchParams.get(paramName);
    if (raw !== null) {
      mutator(clean(raw), out);
    }
  }

  // Pass 2: direct param keys. These win over click-id-derived values.
```

with:

```typescript
  // Pass 1: explicit param keys. Written first so the click-id table below
  // never overwrites an author-supplied subid1/subid4/subid5.
```

Then replace the tail of the function:

```typescript
    const otherKey = OTHER_KEY_MAP[lower];
    if (otherKey) {
      out[otherKey] = cleanValue;
    }
  }

  return out;
}
```

with:

```typescript
    const otherKey = OTHER_KEY_MAP[lower];
    if (otherKey) {
      out[otherKey] = cleanValue;
    }
  }

  // Pass 2: the canonical click-id table (D3).
  for (const row of CLICK_ID_MAP) {
    const found = findCaseInsensitive(url.searchParams, row.incoming);
    if (found === null) continue;
    const raw = clean(found);
    if (!raw) continue;

    out[row.rawKey] = raw;

    const derived = raw.replace(CLICK_ID_UNSAFE_RE, '');
    if (derived && out[row.target] === undefined) {
      out[row.target] = row.incoming === 'wbraid' ? `wbraid:${derived}` : derived;
    }

    // Independent of the slot write: a row that lost the slot still marks subId5.
    if (row.platform !== null && out.subId5 === undefined) {
      out.subId5 = row.platform;
    }
  }

  return out;
}
```

Note the deliberate asymmetry: the raw field gets control-character stripping only, while the derived sub-id additionally has `[<>'"`&]` removed. That is what the last two tests in Step 1 pin.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/url-params.spec.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  30 passed (30)`.

- [ ] **Step 5: Repair the stale fbclid expectation in the session spec**

The shipped session spec asserts the inverted mapping for `?fbclid=abc`. Check whether it is still there:

```bash
grep -n "subId1: 'fb'" packages/sdk/test/session.spec.ts
```

If that prints two hits (around lines 124 and 130), edit `packages/sdk/test/session.spec.ts` and replace both occurrences of

```typescript
      subId1: 'fb',
      subId5: 'abc',
```

and

```typescript
        subId1: 'fb',
        subId5: 'abc',
```

with, respectively:

```typescript
      subId1: 'abc',
      fbclid: 'abc',
```

```typescript
        subId1: 'abc',
        fbclid: 'abc',
```

If the grep prints nothing, the session task group has already rewritten that file — skip this step and make no edit.

- [ ] **Step 6: Verify the whole SDK suite, typecheck, and lint are green**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test
pnpm --filter @goldenhippo/hippo-shop-sdk typecheck
pnpm --filter @goldenhippo/hippo-shop-sdk lint
```

Expected: `Test Files  12 passed (12)` / `Tests  186 passed (186)` when this task follows Task 7 in order, and clean output from `tsc --noEmit` and `eslint src`.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/url-params.ts packages/sdk/test/url-params.spec.ts packages/sdk/test/session.spec.ts
git commit -m "fix(sdk): canonical seven-row click-id table, correcting inverted fbclid

Cluster F shipped fbclid → subId1='fb', subId5=<value> — value and marker
slots reversed, writing a literal 'fb' that no ad platform emits. Silent
data corruption, not a visible failure.

Replaces CLICK_ID_REGISTRY with CLICK_ID_MAP, ported from
hippo-builder-funnel/src/server/cid/click-id-normalizer.ts:35-43:

- fbclid/gclid/ScCid/qclid/twclid/ndclid → subId1 = raw value
- wbraid → subId4 = 'wbraid:<value>'
- subId5 marker only for ScCid=snap, qclid=quora, twclid=twitter,
  ndclid=nextdoor

Table order is precedence for the slot; an already-present subId1/subId4
is never overwritten. Each row's slot write and its subId5 marker are
evaluated independently, so ?fbclid=F&ScCid=S yields subId1='F' AND
subId5='snap' — cross-tagged links are routine and getting this backwards
produces a plausible-looking wrong marker.

Also adds the seven raw click-id fields to ParsedParams (note mixed-case
scCid) and the [<>'\"\`&] strip on click-id-derived sub-ids only.

Part of Cluster G (D3 — attribution model corrections).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `url-params.ts` — remove the 255-character truncation, keep control-character stripping

**Files:**
- Modify: `packages/sdk/src/url-params.ts` (the `MAX_VALUE_CHARS` constant; the `clean` function, lines 79–83 as shipped)
- Test: `packages/sdk/test/url-params.spec.ts` (delete the `truncates values longer than 255 chars` test; append a new `describe` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change. Every field of `ParsedParams` now carries the full inbound value.

Context: spec D3, "Drop the 255-character truncation. Real `fbclid` and `landing_url` values exceed it, and a truncated value will not match what the funnel stored for the same click. The reference implementation caps nothing." Control-character stripping stays — it is hardening the funnel lacks, and it matters more here because the funnel writes cookie values unencoded.

- [ ] **Step 1: Write the failing test**

Delete this test from `packages/sdk/test/url-params.spec.ts`:

```typescript
  it('truncates values longer than 255 chars', () => {
    const longValue = 'a'.repeat(300);
    const out = parseLandingParams(`${BASE}?utm_source=${longValue}`, '');
    expect(out.utmSource!.length).toBe(255);
    expect(out.utmSource).toBe('a'.repeat(255));
  });
```

Then append this block to the end of the file:

```typescript

describe('parseLandingParams — value hygiene', () => {
  it('does not truncate a long fbclid: raw field and subId1 survive intact', () => {
    const longValue = 'a'.repeat(300);
    const out = parseLandingParams(`${BASE}?fbclid=${longValue}`, '');
    expect(out.fbclid).toBe(longValue);
    expect(out.fbclid!.length).toBe(300);
    expect(out.subId1).toBe(longValue);
    expect(out.subId1!.length).toBe(300);
  });

  it('does not truncate long utm or explicit sub-id values', () => {
    const longCampaign = 'b'.repeat(400);
    const longSubId = 'c'.repeat(400);
    const out = parseLandingParams(
      `${BASE}?utm_campaign=${longCampaign}&subid2=${longSubId}`,
      '',
    );
    expect(out.utmCampaign!.length).toBe(400);
    expect(out.utmCampaign).toBe(longCampaign);
    expect(out.subId2!.length).toBe(400);
    expect(out.subId2).toBe(longSubId);
  });

  it('still strips ASCII control characters from raw click-ids and derived sub-ids', () => {
    const out = parseLandingParams(`${BASE}?utm_source=a%00b%0Ac%07d&fbclid=x%01y`, '');
    expect(out.utmSource).toBe('abcd');
    expect(out.fbclid).toBe('xy');
    expect(out.subId1).toBe('xy');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/url-params.spec.ts
```

Expected: `Tests  2 failed | 30 passed (32)`. The long-fbclid test fails with `AssertionError: expected 'aaaa…' to be 'aaaa…'` (255 chars received, 300 expected) and the long-utm test with `AssertionError: expected 255 to be 400`. The control-character test passes already.

- [ ] **Step 3: Write the implementation**

In `packages/sdk/src/url-params.ts`, delete the `MAX_VALUE_CHARS` line so the constants block reads:

```typescript
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g; // ASCII control chars
/** Stripped from click-id-derived sub-id values only (click-id-normalizer.ts:45-50). */
const CLICK_ID_UNSAFE_RE = /[<>'"`&]/g;
```

Then replace the `clean` function:

```typescript
function clean(value: string): string {
  const stripped = value.replace(CONTROL_CHARS_RE, '');
  if (stripped.length <= MAX_VALUE_CHARS) return stripped;
  return stripped.slice(0, MAX_VALUE_CHARS);
}
```

with:

```typescript
/**
 * Strips ASCII control characters. Deliberately does NOT cap length: real
 * `fbclid` and `landing_url` values exceed 255 chars, and a truncated value
 * will not match what the funnel stored for the same click (D3).
 */
function clean(value: string): string {
  return value.replace(CONTROL_CHARS_RE, '');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/url-params.spec.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  32 passed (32)`.

- [ ] **Step 5: Verify the whole SDK suite, typecheck, and lint are green**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test
pnpm --filter @goldenhippo/hippo-shop-sdk typecheck
pnpm --filter @goldenhippo/hippo-shop-sdk lint
```

Expected: `Tests  188 passed (188)` when this task follows Tasks 7 and 8 in order, and clean output from `tsc --noEmit` and `eslint src`. If `tsc` reports `'MAX_VALUE_CHARS' is declared but its value is never read`, the constant line was not deleted — remove it.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/url-params.ts packages/sdk/test/url-params.spec.ts
git commit -m "fix(sdk): stop truncating attribution values at 255 chars

Real fbclid and landing_url values exceed 255 characters. A truncated
value will not match what the funnel stored for the same click, so the
cap silently breaks the join rather than protecting anything. The
reference implementation caps nothing.

Control-character stripping is kept — hardening the funnel lacks, and it
matters more here because the funnel writes cookie values unencoded.

Part of Cluster G (D3 — attribution model corrections).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `url-params.ts` — landing-URL and referral-URL rules

**Files:**
- Modify: `packages/sdk/src/url-params.ts` (the `OTHER_KEY_MAP` constant, lines 73–77 as shipped; the `parseLandingParams` docblock and its first two statements, lines 85–95 as shipped)
- Test: `packages/sdk/test/url-params.spec.ts` (delete the three landing/referrer tests at the top of the existing `describe`; append a new `describe` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change — `parseLandingParams(href: string, referrer: string): ParsedParams` keeps both parameters. `referrer` becomes deliberately unused on this path. `landingUrl` = `?landing_url=` when present, else `href` truncated at the first `?`; `referralUrl` = `?referral_url=` only, and the key is absent otherwise.

Context: spec D3. Keeping the `document.referrer` fallback would be actively harmful, not merely divergent: `affParameters` is destructive-on-write and D4 posts on every page load, so on the second page view `document.referrer` is the *previous internal page*, and the POST would overwrite the true ad referrer the reference captured server-side from the raw `Referer` header. The funnel-event payload does derive its own `referralUrl` from `document.referrer` — a different call with a different shape, built by the events task group. Do not share a mapper between them.

- [ ] **Step 1: Write the failing test**

Delete these three tests from the top of the existing `describe('parseLandingParams', …)` in `packages/sdk/test/url-params.spec.ts`:

```typescript
  it('captures landingUrl as the full href', () => {
    const out = parseLandingParams(`${BASE}?a=1`, '');
    expect(out.landingUrl).toBe(`${BASE}?a=1`);
  });

  it('captures referralUrl when referrer is non-empty', () => {
    const out = parseLandingParams(BASE, 'https://www.facebook.com/');
    expect(out.referralUrl).toBe('https://www.facebook.com/');
  });

  it('omits referralUrl when referrer is empty', () => {
    const out = parseLandingParams(BASE, '');
    expect(out.referralUrl).toBeUndefined();
  });
```

Then append this block to the end of the file:

```typescript

describe('parseLandingParams — landing and referral URLs', () => {
  it('landingUrl is the href truncated at the first "?"', () => {
    const out = parseLandingParams(`${BASE}?utm_source=fb&fbclid=x`, '');
    expect(out.landingUrl).toBe(BASE);
  });

  it('an explicit ?landing_url= wins over the truncated href', () => {
    const explicit = 'https://ads.example.com/lp?q=1';
    const out = parseLandingParams(
      `${BASE}?landing_url=${encodeURIComponent(explicit)}`,
      '',
    );
    expect(out.landingUrl).toBe(explicit);
  });

  it('referralUrl comes from ?referral_url= only', () => {
    const out = parseLandingParams(
      `${BASE}?referral_url=${encodeURIComponent('https://www.facebook.com/')}`,
      'https://internal.example.com/previous-page',
    );
    expect(out.referralUrl).toBe('https://www.facebook.com/');
  });

  it('omits referralUrl when ?referral_url= is absent even though document.referrer is set', () => {
    const out = parseLandingParams(BASE, 'https://www.facebook.com/');
    expect('referralUrl' in out).toBe(false);
    expect(out.referralUrl).toBeUndefined();
  });

  it('omits referralUrl when ?referral_url= is present but empty', () => {
    const out = parseLandingParams(`${BASE}?referral_url=`, 'https://www.facebook.com/');
    expect('referralUrl' in out).toBe(false);
  });

  it('still yields a landingUrl for a malformed href', () => {
    const out = parseLandingParams('not-a-url?utm_source=fb', '');
    expect(out.landingUrl).toBe('not-a-url');
    expect(out.utmSource).toBeUndefined();
  });

  it('omits landingUrl entirely for an empty href', () => {
    const out = parseLandingParams('', '');
    expect('landingUrl' in out).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/url-params.spec.ts
```

Expected: `Tests  7 failed | 29 passed (36)`. Representative failures: `expected 'https://info.gundrymd.com/some-funnel?utm_source=fb&fbclid=x' to be 'https://info.gundrymd.com/some-funnel'`, `expected 'https://internal.example.com/previous-page' to be 'https://www.facebook.com/'`, and `expected true to be false` for the two omission tests.

- [ ] **Step 3: Write the implementation**

Make two edits to `packages/sdk/src/url-params.ts`.

**3a.** Replace `OTHER_KEY_MAP`:

```typescript
const OTHER_KEY_MAP: Record<string, keyof ParsedParams> = {
  off_id: 'offId',
  aff_id: 'affId',
  sales_funnel: 'salesFunnel',
};
```

with:

```typescript
const OTHER_KEY_MAP: Record<string, keyof ParsedParams> = {
  off_id: 'offId',
  aff_id: 'affId',
  sales_funnel: 'salesFunnel',
  landing_url: 'landingUrl',
  referral_url: 'referralUrl',
};
```

The existing loop already skips empty values (`if (!cleanValue) continue;`), which is what keeps `?referral_url=` from writing `''` — `affParameters` is destructive-on-write, so an empty string blanks a real stored value.

**3b.** Replace the `parseLandingParams` docblock and its first two statements:

```typescript
/**
 * Parse a landing URL + document.referrer into a ParsedParams shape ready
 * for POST /session under `affParameters`. Empty/undefined fields are
 * omitted from the output (not set to empty strings).
 *
 * @param href The full landing URL, typically `window.location.href`.
 * @param referrer `document.referrer`. Empty string omits referralUrl.
 */
export function parseLandingParams(href: string, referrer: string): ParsedParams {
  const out: ParsedParams = { landingUrl: href };
  if (referrer) out.referralUrl = referrer;
```

with:

```typescript
/**
 * Parse a landing URL into a ParsedParams shape ready for
 * POST /public/v1/session under `affParameters`. Empty/undefined fields are
 * omitted from the output (never sent as `""`), because `affParameters` is
 * destructive-on-write.
 *
 * @param href The full landing URL, typically `window.location.href`.
 * @param referrer `document.referrer`. Accepted for signature stability and
 *  deliberately unused: on this path `referralUrl` comes from
 *  `?referral_url=` alone (D3). The POST fires on every page load and
 *  `affParameters` is destructive-on-write, so a `document.referrer`
 *  fallback would overwrite the real ad referrer with the previous internal
 *  page on the second page view. The funnel-event payload derives its own
 *  `referralUrl` from `document.referrer` — a different call, different shape.
 */
export function parseLandingParams(href: string, referrer: string): ParsedParams {
  void referrer;

  const out: ParsedParams = {};
  const landingDefault = clean(href.split('?')[0] ?? href);
  if (landingDefault) out.landingUrl = landingDefault;
```

The `void referrer;` statement is what keeps `@typescript-eslint/no-unused-vars` quiet while preserving the two-parameter signature; the `?? href` satisfies `noUncheckedIndexedAccess`. Everything after these lines — the `try { url = new URL(href) }` block and both passes — is unchanged.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/url-params.spec.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  36 passed (36)`.

- [ ] **Step 5: Verify the whole SDK suite, typecheck, and lint are green**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test
pnpm --filter @goldenhippo/hippo-shop-sdk typecheck
pnpm --filter @goldenhippo/hippo-shop-sdk lint
```

Expected: `Test Files  12 passed (12)` / `Tests  192 passed (192)` when this task follows Tasks 7–9 in order, and clean output from `tsc --noEmit` and `eslint src`.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/url-params.ts packages/sdk/test/url-params.spec.ts
git commit -m "fix(sdk): landing_url/referral_url rules; drop the document.referrer fallback

landingUrl is now ?landing_url= when present, else the href truncated at
the first '?' — matching session.service.ts:133,145.

referralUrl comes from ?referral_url= alone and the key is omitted
otherwise (session.service.ts:138,143 uses a spread guard so the key is
absent rather than empty).

Removing the document.referrer fallback is a correctness fix, not a
parity nicety: affParameters is destructive-on-write and the SDK now
POSTs on every page load, so on page 2 document.referrer is the previous
internal page and the POST would clobber the true ad referrer that /cid
captured server-side from the raw Referer header.

The funnel-event payload still derives its own referralUrl from
document.referrer — a different call with a different shape. The two must
not share a mapper.

Part of Cluster G (D3 — attribution model corrections).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```


---


### Task 11: `pruneEmpty` + `buildSessionPostBody` — the destructive-on-write guard for the session POST body

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts` (add two exported helpers after the `getSessionState` accessor, currently lines 34–37)
- Create: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session-post.spec.ts`

**Interfaces:**
- Consumes: `ParsedParams` from `packages/sdk/src/url-params.ts`; `SessionState` (Task 4); `resolveSessionId` (Task 6) — Step 6 edits the post-Task-6 `ensureSession`, so both must be committed first
- Produces:
  ```ts
  export function pruneEmpty(input: Record<string, string | null | undefined>): Record<string, string>;
  export function buildSessionPostBody(
    params: ParsedParams,
    sessionId: string,
  ): { affParameters: Record<string, string> };
  ```

Rationale to keep in view while writing this: `affParameters` is destructive-on-write. Every key present in the body is treated as authoritative by the backend, so posting `utmSource: ''` blanks a real stored value (spec D3). `sessionId` is nested *inside* `affParameters` because `GH-Commerce-Service/src/App.ts:202-211` lifts `req.body.affParameters.sessionId` — top-level is ignored (spec D4).

- [ ] **Step 1: Write the failing test**

  Create `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session-post.spec.ts` with exactly this content:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { pruneEmpty, buildSessionPostBody } from '../src/session';
  import type { ParsedParams } from '../src/url-params';

  describe('pruneEmpty', () => {
    it('keeps non-empty string values verbatim', () => {
      expect(pruneEmpty({ a: 'x', b: 'y z' })).toEqual({ a: 'x', b: 'y z' });
    });

    it('drops undefined values', () => {
      expect(pruneEmpty({ a: 'x', b: undefined })).toEqual({ a: 'x' });
    });

    it('drops null values', () => {
      expect(pruneEmpty({ a: 'x', b: null })).toEqual({ a: 'x' });
    });

    it('drops empty-string values', () => {
      expect(pruneEmpty({ a: 'x', b: '' })).toEqual({ a: 'x' });
    });

    it('drops whitespace-only values', () => {
      expect(pruneEmpty({ a: 'x', b: '   ', c: '\t\n' })).toEqual({ a: 'x' });
    });

    it('never returns a key whose value is an empty string', () => {
      const out = pruneEmpty({ utmSource: '', utmMedium: 'cpc' });
      expect(Object.values(out)).not.toContain('');
      expect('utmSource' in out).toBe(false);
    });
  });

  describe('buildSessionPostBody', () => {
    const params: ParsedParams = {
      landingUrl: 'https://sf.gundrymd.com/offer',
      utmSource: 'fb',
      utmMedium: 'cpc',
    };

    it('nests sessionId inside affParameters', () => {
      const body = buildSessionPostBody(params, 'e2b9f0c4-1111-4222-8333-444455556666');
      expect(body.affParameters.sessionId).toBe('e2b9f0c4-1111-4222-8333-444455556666');
    });

    it('does not put sessionId at the top level of the body', () => {
      const body = buildSessionPostBody(params, 'e2b9f0c4-1111-4222-8333-444455556666');
      expect('sessionId' in body).toBe(false);
      expect(Object.keys(body)).toEqual(['affParameters']);
    });

    it('carries the attribution params alongside the session id', () => {
      const body = buildSessionPostBody(params, 'abc');
      expect(body.affParameters).toEqual({
        landingUrl: 'https://sf.gundrymd.com/offer',
        utmSource: 'fb',
        utmMedium: 'cpc',
        sessionId: 'abc',
      });
    });

    it('omits sessionId entirely when it is absent — never sends an empty string', () => {
      const body = buildSessionPostBody(params, '');
      expect('sessionId' in body.affParameters).toBe(false);
      expect(body.affParameters).toEqual({
        landingUrl: 'https://sf.gundrymd.com/offer',
        utmSource: 'fb',
        utmMedium: 'cpc',
      });
    });

    it('omits sessionId when it is whitespace only', () => {
      const body = buildSessionPostBody(params, '  ');
      expect('sessionId' in body.affParameters).toBe(false);
    });

    it('prunes empty-string attribution params so a stored value is never blanked', () => {
      const body = buildSessionPostBody({ utmSource: '', utmCampaign: 'summer' }, 'abc');
      expect('utmSource' in body.affParameters).toBe(false);
      expect(body.affParameters).toEqual({ utmCampaign: 'summer', sessionId: 'abc' });
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/session-post.spec.ts
  ```

  Expected failure: the file fails to collect with
  `SyntaxError: [vite] The requested module '/src/session.ts' does not provide an export named 'pruneEmpty'`

- [ ] **Step 3: Write minimal implementation**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts`, insert the following immediately after the `getSessionState()` function (currently ends at line 37):

  ```ts
  /**
   * Drops keys whose value is null, undefined, or whitespace-only.
   *
   * `affParameters` is destructive-on-write: the backend treats every key
   * present in the body as authoritative, so posting `utmSource: ''` blanks a
   * real stored value. Empty means omitted, never `""` (spec D3).
   */
  export function pruneEmpty(
    input: Record<string, string | null | undefined>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === null || value === undefined) continue;
      if (value.trim() === '') continue;
      out[key] = value;
    }
    return out;
  }

  /**
   * Builds the POST /public/v1/session request body.
   *
   * `sessionId` is nested *inside* `affParameters` because the API lifts
   * `req.body.affParameters.sessionId` into the server-side session — a
   * top-level key is ignored (spec D4). An absent id is omitted entirely.
   */
  export function buildSessionPostBody(
    params: ParsedParams,
    sessionId: string,
  ): { affParameters: Record<string, string> } {
    return { affParameters: pruneEmpty({ ...params, sessionId }) };
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/session-post.spec.ts
  ```

  Expect `Test Files 1 passed (1)`, `Tests 13 passed (13)`.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/sdk/src/session.ts packages/sdk/test/session-post.spec.ts
  git commit -m "feat(sdk): pruneEmpty + buildSessionPostBody — sessionId nested in affParameters"
  ```

---

- [ ] **Step 6: Wire the POST body into `ensureSession`**

In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/session.ts`, replace the POST call inside `ensureSession`:

```ts
    await client.postJson('session', buildSessionPostBody(params, resolved.sessionId));
```

The anchor to replace is the post-Task-6 line `await client.postJson('session', { affParameters: params });`. Note `resolved` — Task 6 replaced the old `sessionId` binding with `const resolved = resolveSessionId(search, logger);`, so a bare `sessionId` is undeclared here. It previously read `client.postJson('session', { affParameters: params })`, which never told the API which session it was — the defect described in the spec's Background. `buildSessionPostBody` nests `sessionId` inside `affParameters` and omits empty values.

- [ ] **Step 7: Run the session suite to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-sdk test -- session
```

Expected: PASS, including `sends sessionId inside affParameters`.

- [ ] **Step 8: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/session.ts packages/sdk/test/session.spec.ts && git commit -m "feat(sdk): carry sessionId inside affParameters on the session POST

The SDK minted a cookie id and the server independently minted hippoSessionId;
nothing joined them, so outbound links carried an id the API had never seen."
```

---

### Task 12: `packages/types` — destination identity, destination URL, and funnel-step id

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/types/src/destination.ts` (interface body, lines 10–17)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/types/src/funnel.ts` (interface body, lines 19–28)
- Test: `/Users/stevenhall/Code/hippo-shop/packages/types/test/types.test-d.ts` (lines 34–50 and 78–84)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/types/test/fixtures/destination.json` (lines 1–6)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/types/test/fixtures/funnel.json` (whole file)

**Interfaces:**
- Produces: `HippoShopDestinationDTO` gains `id: string`, `funnelId: string`, `url: string | null`
- Produces: `HippoShopFunnelStepDTO` gains `id: string`
- Consumes: nothing

- [ ] **Step 1: Write the failing type test**

  In `/Users/stevenhall/Code/hippo-shop/packages/types/test/types.test-d.ts`, replace the `dest` literal (lines 34–45) with this version, which declares the three new destination fields:

  ```ts
  const dest: HippoShopDestinationDTO = {
    id: 'a0D0m000002Dst1EAC',
    slug: 'd', name: 'd', description: null,
    funnelSlug: 'f', funnelId: 'a0F0m000002Fnl1EAC',
    url: null,
    pricing: {
      familyOrBundleId: 'fam-sf-id', orderFormId: 'of-sf-id', sku: 'SKU-1',
      packageQuantity: 1, purchaseType: 'one-time',
      frequency: null,
      price: usdPrice, rebillPrice: null,
      outOfStock: false, restrictedCountryCodes: [],
      shipping, bumpOffers: [],
      checkoutOverrideUrl: null,
    },
  };
  ```

  Then, immediately after the existing line `expectType<string | null>(dest.pricing.checkoutOverrideUrl);`, add:

  ```ts
  // --- Cluster G: destination identity + absolute URL are required, not optional ---
  expectType<string>(dest.id);
  expectType<string>(dest.funnelId);
  expectType<string | null>(dest.url);
  // Omitting any of the three is an error, not a silently-undefined read.
  expectError<HippoShopDestinationDTO>({
    slug: 'd', name: 'd', description: null, funnelSlug: 'f',
    pricing: dest.pricing,
  });
  ```

  Finally, replace the `funnel` literal and its assertion (lines 78–84) with:

  ```ts
  const funnel: HippoShopFunnelDTO = {
    slug: 'f', name: 'F', active: true,
    steps: [
      { id: 'a0P0m000002Stp1EAC', stepNumber: 1, slug: 's1', name: 'S1', kind: 'landing' },
    ],
  };
  expectType<HippoShopStepKind>(funnel.steps[0]!.kind);
  expectType<string>(funnel.steps[0]!.id);
  ```

- [ ] **Step 2: Run the type test to verify it fails**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-types test
  ```

  Expect tsd errors (line numbers will differ slightly from the ones below):

  ```
  test/types.test-d.ts:52:0
  ✖  35:2   Object literal may only specify known properties, and id does not exist in type HippoShopDestinationDTO.
  ✖  52:19  Parameter type string is not identical to argument type any.
  ✖  52:24  Property id does not exist on type HippoShopDestinationDTO.
  ✖  54:31  Property url does not exist on type HippoShopDestinationDTO.
  ✖  84:2   Object literal may only specify known properties, and id does not exist in type HippoShopFunnelStepDTO.
  ELIFECYCLE  Test failed.
  ```

- [ ] **Step 3: Add the destination fields**

  In `/Users/stevenhall/Code/hippo-shop/packages/types/src/destination.ts`, replace the `HippoShopDestinationDTO` interface body (lines 10–17) with:

  ```ts
  export interface HippoShopDestinationDTO {
    /**
     * Salesforce ID of the destination. Pass-through of the record id, needed
     * as `destinationId` on funnel-event payloads. Prefer `slug` for anything
     * addressable — this is an opaque identifier, not a stable public handle.
     */
    id: string;
    slug: string;
    name: string;
    description: string | null;
    /** Slug of the funnel this destination resolves to. */
    funnelSlug: string;
    /**
     * Salesforce ID of the funnel this destination resolves to (the resolved
     * `defaultFunnel`). Funnel-event payloads key on this; a blank value makes
     * the event undeliverable, so it is required rather than nullable.
     */
    funnelId: string;
    /**
     * Absolute landing URL for this destination. `null` when Salesforce has
     * none — callers fall back to their own configured checkout base.
     */
    url: string | null;
    pricing: HippoShopPricingDTO;
  }
  ```

- [ ] **Step 4: Add the funnel-step id**

  In `/Users/stevenhall/Code/hippo-shop/packages/types/src/funnel.ts`, replace the `HippoShopFunnelStepDTO` interface body (lines 19–28) with:

  ```ts
  export interface HippoShopFunnelStepDTO {
    /**
     * Salesforce ID of the step. Needed as `funnelSTPId` on funnel-event
     * payloads. Prefer `slug` for anything addressable.
     */
    id: string;
    /** 1-indexed position in the funnel. */
    stepNumber: number;
    /** Step slug, unique within the funnel. */
    slug: string;
    /** Display name. */
    name: string;
    /** Closed enum mapping from internal `pageType`. Unknown types are omitted server-side. */
    kind: HippoShopStepKind;
  }
  ```

- [ ] **Step 5: Run the type test to verify it passes**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-types test
  ```

  Expect the tsup build lines followed by no tsd output and exit status 0.

- [ ] **Step 6: Update the reference fixtures**

  In `/Users/stevenhall/Code/hippo-shop/packages/types/test/fixtures/destination.json`, replace the first six lines:

  ```json
  {
    "slug": "bio-complete-3-6btl-sub",
    "name": "Bio Complete 3 — 6 Bottle Subscription",
    "description": "Six-bottle subscription with the deepest discount and free shipping.",
    "funnelSlug": "bio-complete-3-main",
    "pricing": {
  ```

  with:

  ```json
  {
    "id": "a0D0m000002Dst1EAC",
    "slug": "bio-complete-3-6btl-sub",
    "name": "Bio Complete 3 — 6 Bottle Subscription",
    "description": "Six-bottle subscription with the deepest discount and free shipping.",
    "funnelSlug": "bio-complete-3-main",
    "funnelId": "a0F0m000002Fnl1EAC",
    "url": "https://www.gundrymd.com/products/bio-complete-3?p=6btl-sub",
    "pricing": {
  ```

  Then overwrite `/Users/stevenhall/Code/hippo-shop/packages/types/test/fixtures/funnel.json` with:

  ```json
  {
    "slug": "bio-complete-3-main",
    "name": "Bio Complete 3 — Main Funnel",
    "active": true,
    "steps": [
      {
        "id": "a0P0m000002Stp1EAC",
        "stepNumber": 1,
        "slug": "vsl",
        "name": "Video Sales Letter",
        "kind": "landing"
      },
      {
        "id": "a0P0m000002Stp2EAC",
        "stepNumber": 2,
        "slug": "order-form",
        "name": "Order Form",
        "kind": "order-form"
      },
      {
        "id": "a0P0m000002Stp3EAC",
        "stepNumber": 3,
        "slug": "upsell-1",
        "name": "Total Restore Upsell",
        "kind": "upsell"
      },
      {
        "id": "a0P0m000002Stp4EAC",
        "stepNumber": 4,
        "slug": "thank-you",
        "name": "Thank You",
        "kind": "thank-you"
      }
    ]
  }
  ```

- [ ] **Step 7: Commit**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git add packages/types/src/destination.ts packages/types/src/funnel.ts packages/types/test/types.test-d.ts packages/types/test/fixtures/destination.json packages/types/test/fixtures/funnel.json && git commit -m "feat(types)!: add destination id/funnelId/url and funnel-step id

  Funnel-event payloads need funnelSTFId, mainFunnelId, destinationId and
  funnelSTPId. ZDestination already carries all four; the serializer dropped
  them. url is the destination's absolute landing URL, null when Salesforce
  has none.

  BREAKING CHANGE: HippoShopDestinationDTO requires id, funnelId and url;
  HippoShopFunnelStepDTO requires id."
  ```


---


### Task 13: `resolveDestinationBase` — three-source resolution for the navigation target

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/checkout.ts` (module docblock lines 1–10; add `resolveDestinationBase` above `composeCheckoutUrl`; change `composeCheckoutUrl`'s base resolution, currently lines 51–58)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/checkout.spec.ts` (`makeDestination` fixture, lines 20–45; add a `resolveDestinationBase` describe block)

**Interfaces:**
- Consumes: `HippoShopDestinationDTO` (with the Cluster G `id`, `funnelId`, `url` fields), `GhConfig`, `GhError`
- Produces: `export function resolveDestinationBase(d: HippoShopDestinationDTO, c: GhConfig): string;`

The destination URL *is* the checkout navigation target (spec D7) — one composer, one attribute. `GhError('config')` is thrown only when all three sources are absent.

- [ ] **Step 1: Write the failing test**

  9a. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/checkout.spec.ts`, replace the whole `makeDestination` fixture with this version (pricing overrides stay the first argument so existing call sites keep working; destination-root overrides are the new second argument):

  ```ts
  function makeDestination(
    pricing: Partial<HippoShopDestinationDTO['pricing']> = {},
    root: Partial<HippoShopDestinationDTO> = {},
  ): HippoShopDestinationDTO {
    return {
      id: 'a0X0000000001AAA',
      slug: 'bio3-3p-sub',
      name: 'Bio Complete 3 — 3-pack subscription',
      description: null,
      funnelSlug: 'fnl',
      funnelId: 'a0Y0000000002BBB',
      url: null,
      pricing: {
        familyOrBundleId: 'fam1',
        orderFormId: 'OF_123',
        sku: 'BIO3-3P-SUB',
        packageQuantity: 3,
        purchaseType: 'subscription',
        frequency: { months: 1, label: 'Monthly' } as never,
        price: { amount: 49.95, currency: 'USD', savings: null },
        rebillPrice: { amount: 49.95, currency: 'USD', savings: null },
        outOfStock: false,
        restrictedCountryCodes: [],
        shipping: { domestic: 0, international: 0, freeShippingThreshold: null },
        bumpOffers: [],
        checkoutOverrideUrl: null,
        ...pricing,
      },
      ...root,
    };
  }
  ```

  9b. Add this describe block immediately after the `makeSession` fixture in the same file:

  ```ts
  import { resolveDestinationBase } from '../src/checkout';

  describe('resolveDestinationBase', () => {
    it('prefers pricing.checkoutOverrideUrl over destination.url and config.checkoutBase', () => {
      const dest = makeDestination(
        { checkoutOverrideUrl: 'https://override.example.com/buy' },
        { url: 'https://dest.gundrymd.com/offer' },
      );
      expect(resolveDestinationBase(dest, makeConfig())).toBe('https://override.example.com/buy');
    });

    it('falls back to destination.url when there is no pricing override', () => {
      const dest = makeDestination({ checkoutOverrideUrl: null }, { url: 'https://dest.gundrymd.com/offer' });
      expect(resolveDestinationBase(dest, makeConfig())).toBe('https://dest.gundrymd.com/offer');
    });

    it('falls back to config.checkoutBase when the destination has no url', () => {
      const dest = makeDestination({ checkoutOverrideUrl: null }, { url: null });
      expect(resolveDestinationBase(dest, makeConfig())).toBe('https://checkout.gundrymd.com');
    });

    it('throws GhError("config") only when all three sources are absent', () => {
      const dest = makeDestination({ checkoutOverrideUrl: null }, { url: null });
      const config = makeConfig({ checkoutBase: null });
      expect(() => resolveDestinationBase(dest, config)).toThrow(GhError);
      try {
        resolveDestinationBase(dest, config);
      } catch (err) {
        expect((err as GhError).code).toBe('config');
      }
    });
  });

  describe('composeCheckoutUrl — destination url', () => {
    it('composes against destination.url when there is no pricing override', () => {
      const dest = makeDestination({ checkoutOverrideUrl: null }, { url: 'https://dest.gundrymd.com/offer' });
      const url = new URL(composeCheckoutUrl(dest, makeConfig(), makeSession()));
      expect(url.origin + url.pathname).toBe('https://dest.gundrymd.com/offer');
      expect(url.searchParams.get('order_form_id')).toBe('OF_123');
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/checkout.spec.ts
  ```

  Expected failure: `SyntaxError: [vite] The requested module '/src/checkout.ts' does not provide an export named 'resolveDestinationBase'`

- [ ] **Step 3: Write minimal implementation**

  3a. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/checkout.ts`, make the module docblock read exactly:

  ```ts
  /**
   * Cluster G: outbound destination-link composition, the `data-gh-checkout`
   * attribute behavior, and the `await gh.checkoutUrl(slug)` programmatic twin.
   *
   * The canonical page shape is an offer selector: several destinations bound
   * to the available choices, where selecting one navigates the current page to
   * that destination's URL. The destination URL therefore *is* the checkout
   * navigation target — one composer, one attribute (spec D7).
   */
  ```

  3b. Insert `resolveDestinationBase` immediately above `composeCheckoutUrl`:

  ```ts
  /**
   * Resolve the base URL a destination's link points at:
   *
   *   destination.pricing.checkoutOverrideUrl   // per-destination override
   *     ?? destination.url                      // the normal case
   *     ?? config.checkoutBase                  // brand-level data-checkout-base
   *
   * @throws GhError('config') when all three are absent.
   */
  export function resolveDestinationBase(
    destination: HippoShopDestinationDTO,
    config: GhConfig,
  ): string {
    const base =
      destination.pricing.checkoutOverrideUrl ?? destination.url ?? config.checkoutBase;
    if (!base) {
      throw new GhError(
        'config',
        `No URL resolved for destination "${destination.slug}". Salesforce supplied no ` +
          `destination url, pricing.checkoutOverrideUrl is unset, and the script tag has ` +
          `no data-checkout-base.`,
      );
    }
    return base;
  }
  ```

  3c. Replace the base-resolution block at the top of `composeCheckoutUrl` (the `const baseStr = ...` line and the `if (!baseStr) { throw ... }` block) with:

  ```ts
    const baseStr = resolveDestinationBase(destination, config);
  ```

  and change the invalid-URL error message to:

  ```ts
    } catch (err) {
      throw new GhError('config', `Invalid destination URL: ${baseStr}`, { cause: err });
    }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/checkout.spec.ts
  ```

  Expect `Test Files 1 passed (1)` — the five new tests plus the pre-existing ones.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/sdk/src/checkout.ts packages/sdk/test/checkout.spec.ts
  git commit -m "feat(sdk): resolveDestinationBase — checkoutOverrideUrl ?? destination.url ?? checkoutBase"
  ```

---

### Task 14: `composeCheckoutUrl` — funnel-canonical param set, order, and forwarded orig params

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/checkout.ts` (imports line 12–16; `PARAM_KEY_MAP` lines 18–38; `composeCheckoutUrl` body lines 60–78)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/checkout.spec.ts` (`composeCheckoutUrl` describe block, lines 56–128)

**Interfaces:**
- Consumes: `ParsedParams` (all 25 fields incl. the seven raw click-ids), `SessionState` (Task 4), `resolveDestinationBase` (Task 13)
- Produces: `export function composeCheckoutUrl(d: HippoShopDestinationDTO, c: GhConfig, s: SessionState): string;`

`session_id` → `sessionid` and `sub_idN` → `subidN` are the load-bearing renames: the funnel reads `sessionid` case-sensitively and `session_id` appears nowhere in its repository, so a `?session_id=` handoff is silently ignored and the funnel mints a fresh session. `setIfAbsent` semantics are retained — a param already on the base URL wins.

- [ ] **Step 1: Write the failing test**

  Replace the entire existing `describe('composeCheckoutUrl', ...)` block in `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/checkout.spec.ts` with:

  ```ts
  function setSearch(search: string): void {
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        hostname: 'sf.gundrymd.com',
        protocol: 'https:',
        search,
        href: `https://sf.gundrymd.com/offer${search}`,
      },
      writable: true,
    });
  }

  const FULL_PARAMS = {
    landingUrl: 'https://sf.gundrymd.com/offer',
    referralUrl: 'https://www.facebook.com/',
    salesFunnel: 'Funnel',
    utmSource: 'fb',
    utmMedium: 'cpc',
    utmCampaign: 'summer',
    utmCampaignId: '12345',
    utmContent: 'ad1',
    utmTerm: 'kw',
    utmChat: 'chat1',
    utmAction: 'act1',
    offId: 'OFF1',
    affId: 'AFF1',
    subId1: 's1',
    subId2: 's2',
    subId3: 's3',
    subId4: 's4',
    subId5: 's5',
    fbclid: 'F',
    gclid: 'G',
    scCid: 'S',
    qclid: 'Q',
    twclid: 'T',
    ndclid: 'N',
    wbraid: 'W',
  };

  describe('composeCheckoutUrl', () => {
    beforeEach(() => {
      setSearch('');
    });

    it('uses the brand-level checkoutBase when no DTO override and no destination url', () => {
      const url = composeCheckoutUrl(makeDestination(), makeConfig(), makeSession());
      expect(url).toMatch(/^https:\/\/checkout\.gundrymd\.com\//);
    });

    it('uses the pricing override when present, ignoring the brand default', () => {
      const dest = makeDestination({ checkoutOverrideUrl: 'https://special.example.com/buy' });
      const url = composeCheckoutUrl(dest, makeConfig(), makeSession());
      expect(url).toMatch(/^https:\/\/special\.example\.com\/buy/);
      expect(url).not.toContain('checkout.gundrymd.com');
    });

    it('emits sessionid, not session_id', () => {
      const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), makeSession()));
      expect(url.searchParams.get('sessionid')).toBe('174710238129');
      expect(url.searchParams.has('session_id')).toBe(false);
    });

    it('emits subidN, not sub_idN', () => {
      const session = makeSession({ params: { subId1: 'a', subId4: 'wbraid:W', subId5: 'snap' } });
      const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
      expect(url.searchParams.get('subid1')).toBe('a');
      expect(url.searchParams.get('subid4')).toBe('wbraid:W');
      expect(url.searchParams.get('subid5')).toBe('snap');
      expect(url.searchParams.has('sub_id1')).toBe(false);
      expect(url.searchParams.has('sub_id4')).toBe(false);
      expect(url.searchParams.has('sub_id5')).toBe(false);
    });

    it('always appends order_form_id', () => {
      const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), makeSession()));
      expect(url.searchParams.get('order_form_id')).toBe('OF_123');
    });

    it('emits the full param set in the canonical D6 order', () => {
      const session = makeSession({ params: { ...FULL_PARAMS } });
      const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
      expect(Array.from(url.searchParams.keys())).toEqual([
        'order_form_id',
        'sessionid',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_campaign_id',
        'utm_content',
        'utm_term',
        'utm_chat',
        'utm_action',
        'off_id',
        'aff_id',
        'subid1',
        'subid2',
        'subid3',
        'subid4',
        'subid5',
        'landing_url',
        'referral_url',
        'sales_funnel',
        'fbclid',
        'gclid',
        'ScCid',
        'qclid',
        'twclid',
        'ndclid',
        'wbraid',
      ]);
    });

    it('emits the seven raw click-ids with their canonical spellings', () => {
      const session = makeSession({ params: { ...FULL_PARAMS } });
      const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
      expect(url.searchParams.get('fbclid')).toBe('F');
      expect(url.searchParams.get('gclid')).toBe('G');
      expect(url.searchParams.get('ScCid')).toBe('S');
      expect(url.searchParams.get('qclid')).toBe('Q');
      expect(url.searchParams.get('twclid')).toBe('T');
      expect(url.searchParams.get('ndclid')).toBe('N');
      expect(url.searchParams.get('wbraid')).toBe('W');
    });

    it('emits landing_url, referral_url and sales_funnel from params', () => {
      const session = makeSession({
        params: {
          landingUrl: 'https://sf.gundrymd.com/offer',
          referralUrl: 'https://www.facebook.com/',
          salesFunnel: 'Funnel',
        },
      });
      const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
      expect(url.searchParams.get('landing_url')).toBe('https://sf.gundrymd.com/offer');
      expect(url.searchParams.get('referral_url')).toBe('https://www.facebook.com/');
      expect(url.searchParams.get('sales_funnel')).toBe('Funnel');
    });

    it('does not truncate long values', () => {
      const long = 'x'.repeat(400);
      const session = makeSession({ params: { fbclid: long } });
      const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
      expect(url.searchParams.get('fbclid')).toBe(long);
    });

    it('omits keys whose params values are empty/undefined', () => {
      const session = makeSession({ params: { utmSource: 'fb' } });
      const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
      expect(url.searchParams.has('utm_source')).toBe(true);
      expect(url.searchParams.has('utm_medium')).toBe(false);
      expect(url.searchParams.has('subid1')).toBe(false);
    });

    it('omits sessionid when the session id is empty', () => {
      const url = new URL(
        composeCheckoutUrl(makeDestination(), makeConfig(), makeSession({ sessionId: '' })),
      );
      expect(url.searchParams.has('sessionid')).toBe(false);
    });

    it('preserves a pre-existing query string on the base URL', () => {
      const config = makeConfig({ checkoutBase: 'https://checkout.gundrymd.com/?fbp=existing' });
      const url = new URL(composeCheckoutUrl(makeDestination(), config, makeSession()));
      expect(url.searchParams.get('fbp')).toBe('existing');
      expect(url.searchParams.get('order_form_id')).toBe('OF_123');
    });

    it('author-supplied params on the base URL win over SDK additions', () => {
      const config = makeConfig({
        checkoutBase:
          'https://checkout.gundrymd.com/?sessionid=author-wins&subid1=author-sub&utm_source=author-src',
      });
      const session = makeSession({ params: { subId1: 'sdk-sub', utmSource: 'sdk-src' } });
      const url = new URL(composeCheckoutUrl(makeDestination(), config, session));
      expect(url.searchParams.get('sessionid')).toBe('author-wins');
      expect(url.searchParams.get('subid1')).toBe('author-sub');
      expect(url.searchParams.get('utm_source')).toBe('author-src');
      expect(url.searchParams.getAll('sessionid')).toHaveLength(1);
    });

    it('forwards origdsidOrig and origsplitTestingFunnelIdOrig from the current page URL, last', () => {
      setSearch('?origdsidOrig=DS1&origsplitTestingFunnelIdOrig=ST1');
      const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), makeSession()));
      expect(url.searchParams.get('origdsidOrig')).toBe('DS1');
      expect(url.searchParams.get('origsplitTestingFunnelIdOrig')).toBe('ST1');
      const keys = Array.from(url.searchParams.keys());
      expect(keys.slice(-2)).toEqual(['origdsidOrig', 'origsplitTestingFunnelIdOrig']);
    });

    it('omits the orig params when the current page URL has none', () => {
      setSearch('?utm_source=fb');
      const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), makeSession()));
      expect(url.searchParams.has('origdsidOrig')).toBe(false);
      expect(url.searchParams.has('origsplitTestingFunnelIdOrig')).toBe(false);
    });

    it('does not overwrite an author-supplied origdsidOrig on the base URL', () => {
      setSearch('?origdsidOrig=from-page');
      const config = makeConfig({ checkoutBase: 'https://checkout.gundrymd.com/?origdsidOrig=on-base' });
      const url = new URL(composeCheckoutUrl(makeDestination(), config, makeSession()));
      expect(url.searchParams.get('origdsidOrig')).toBe('on-base');
    });
  });
  ```

  Also add `beforeEach` to the vitest import at the top of the file so it reads:

  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest';
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/checkout.spec.ts
  ```

  Expected failures: `AssertionError: expected null to be '174710238129'` on `emits sessionid, not session_id`, and on `emits the full param set in the canonical D6 order` a diff whose actual array is `[ 'order_form_id', 'session_id', 'utm_source', … 'sub_id1', … ]`.

- [ ] **Step 3: Write minimal implementation**

  3a. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/checkout.ts`, make the import block read exactly:

  ```ts
  import type { HippoShopDestinationDTO } from '@goldenhippo/hippo-shop-types';
  import type { GhConfig } from './config';
  import type { SessionState } from './session';
  import type { ParsedParams } from './url-params';
  import type { Logger } from './log';
  import { GhError } from './errors';
  ```

  3b. Replace the whole `PARAM_KEY_MAP` declaration with:

  ```ts
  /**
   * `ParsedParams` key → outbound query-param name, in the canonical funnel
   * order (spec D6). Order is part of the contract; tests assert it.
   *
   * `subidN` — not `sub_idN` — and `sessionid` (set separately, ahead of this
   * list) are the spellings the funnel reads. `session_id` and `sub_idN` are
   * silently ignored by it, which shows up downstream as duplicate sessions
   * and orphaned attribution.
   */
  const PARAM_KEY_MAP: Array<[keyof ParsedParams, string]> = [
    ['utmSource', 'utm_source'],
    ['utmMedium', 'utm_medium'],
    ['utmCampaign', 'utm_campaign'],
    ['utmCampaignId', 'utm_campaign_id'],
    ['utmContent', 'utm_content'],
    ['utmTerm', 'utm_term'],
    ['utmChat', 'utm_chat'],
    ['utmAction', 'utm_action'],
    ['offId', 'off_id'],
    ['affId', 'aff_id'],
    ['subId1', 'subid1'],
    ['subId2', 'subid2'],
    ['subId3', 'subid3'],
    ['subId4', 'subid4'],
    ['subId5', 'subid5'],
    ['landingUrl', 'landing_url'],
    ['referralUrl', 'referral_url'],
    ['salesFunnel', 'sales_funnel'],
    ['fbclid', 'fbclid'],
    ['gclid', 'gclid'],
    ['scCid', 'ScCid'],
    ['qclid', 'qclid'],
    ['twclid', 'twclid'],
    ['ndclid', 'ndclid'],
    ['wbraid', 'wbraid'],
  ];

  /**
   * Forwarded verbatim from the current page URL when present, appended last.
   * These carry the funnel's own destination and split-test identity across the
   * hop; the SDK never synthesises them.
   */
  const FORWARDED_PARAM_NAMES = ['origdsidOrig', 'origsplitTestingFunnelIdOrig'] as const;
  ```

  3c. Replace the body of `composeCheckoutUrl` after the `new URL(baseStr)` try/catch with:

  ```ts
    setIfAbsent(url, 'order_form_id', destination.pricing.orderFormId);
    setIfAbsent(url, 'sessionid', session.sessionId);

    for (const [key, paramName] of PARAM_KEY_MAP) {
      setIfAbsent(url, paramName, session.params[key]);
    }

    const current = currentSearchParams();
    for (const name of FORWARDED_PARAM_NAMES) {
      setIfAbsent(url, name, current.get(name));
    }

    return url.toString();
  }

  /** The current page's query string, or an empty set outside a browser. */
  function currentSearchParams(): URLSearchParams {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    try {
      return new URLSearchParams(search);
    } catch {
      return new URLSearchParams();
    }
  }
  ```

  3d. Update `composeCheckoutUrl`'s docblock to read:

  ```ts
  /**
   * Compose the outbound URL for a destination: the resolved base plus
   * `order_form_id`, `sessionid`, the attribution params in canonical order,
   * and the forwarded `orig*` params from the current page.
   *
   * `setIfAbsent` semantics: a param already present on the base URL wins.
   * That is the opposite of the `/cid` merge rule, and deliberate — the base
   * URL is page-authored, so the author's override is the right behaviour.
   *
   * @throws GhError('config') if no base URL resolves, or if it will not parse.
   */
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/checkout.spec.ts
  ```

  Expect `Test Files 1 passed (1)` with all `composeCheckoutUrl` tests green.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/sdk/src/checkout.ts packages/sdk/test/checkout.spec.ts
  git commit -m "feat(sdk)!: outbound links use sessionid/subidN and the canonical D6 param order"
  ```

---

### Task 15: `applyCheckoutBindings` — session thunk, and `href=\"#\"` while the session is unresolved

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/checkout.ts` (`CheckoutBindingsOptions` lines 94–102; `bindOne` lines 131–173)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts` (lines 84–92 — the `applyCheckoutBindings` call site)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/checkout.spec.ts` (`applyCheckoutBindings` describe block, lines 130–207)

**Interfaces:**
- Consumes: `composeCheckoutUrl` (Task 14), `SessionState` (Task 4), `getSessionState` from `packages/sdk/src/session.ts`
- Produces:
  ```ts
  export interface CheckoutBindingsOptions {
    config: GhConfig;
    getSession: () => SessionState | null;
    sessionPromise: Promise<unknown>;
    getDestination: (slug: string) => HippoShopDestinationDTO | null;
    ensureDestination: (slug: string) => Promise<void>;
    logger: Logger;
  }
  export function applyCheckoutBindings(root: ParentNode, opts: CheckoutBindingsOptions): void;
  ```

A snapshot was the Cluster F defect: anything holding the pre-resolve `SessionState` composed a *syntactically valid* URL with `sessionid` and every UTM silently missing. The thunk is nullable on purpose, and the null case is a held link — never a params-less URL.

- [ ] **Step 1: Write the failing test**

  Replace the entire existing `describe('applyCheckoutBindings', ...)` block in `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/checkout.spec.ts` with:

  ```ts
  describe('applyCheckoutBindings', () => {
    function setupDom(html: string): HTMLElement {
      document.body.innerHTML = html;
      return document.body;
    }

    function makeOptions(overrides: Partial<CheckoutBindingsOptions> = {}): CheckoutBindingsOptions {
      return {
        config: makeConfig(),
        getSession: () => makeSession(),
        sessionPromise: Promise.resolve(),
        getDestination: () => makeDestination(),
        ensureDestination: () => Promise.resolve(),
        logger: { debug: () => {}, warn: () => {}, error: () => {} },
        ...overrides,
      };
    }

    beforeEach(() => {
      setSearch('');
    });

    it('writes href on <a data-gh-checkout> when destination and session are available', () => {
      setupDom('<a data-gh-checkout="bio3-3p-sub" href="#">Buy</a>');
      applyCheckoutBindings(document, makeOptions());
      const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
      expect(a.getAttribute('href')).toMatch(/^https:\/\/checkout\.gundrymd\.com\/\?/);
      expect(a.getAttribute('href')).toContain('order_form_id=OF_123');
      expect(a.getAttribute('href')).toContain('sessionid=174710238129');
    });

    it('leaves href="#" while the session is unresolved — never a params-less URL', () => {
      setupDom('<a data-gh-checkout="bio3-3p-sub" href="">Buy</a>');
      applyCheckoutBindings(document, makeOptions({ getSession: () => null }));
      const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
      expect(a.getAttribute('href')).toBe('#');
      expect(a.getAttribute('href')).not.toContain('order_form_id');
    });

    it('does not bind a click handler on non-<a> elements while the session is unresolved', () => {
      setupDom('<button data-gh-checkout="bio3-3p-sub">Buy</button>');
      applyCheckoutBindings(document, makeOptions({ getSession: () => null }));
      const button = document.querySelector<HTMLButtonElement>('button[data-gh-checkout]')!;
      expect(button.dataset['ghCheckoutBound']).toBeUndefined();
      expect(button.dataset['ghCheckoutUrl']).toBeUndefined();
    });

    it('fills the href in on a later pass once the session has resolved', () => {
      setupDom('<a data-gh-checkout="bio3-3p-sub" href="">Buy</a>');
      let session: ReturnType<typeof makeSession> | null = null;
      const opts = makeOptions({ getSession: () => session });

      applyCheckoutBindings(document, opts);
      const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
      expect(a.getAttribute('href')).toBe('#');

      session = makeSession({ sessionId: '999999999999' });
      applyCheckoutBindings(document, opts);
      expect(a.getAttribute('href')).toContain('sessionid=999999999999');
    });

    it('reads the session live on every pass rather than closing over a snapshot', () => {
      setupDom('<a data-gh-checkout="bio3-3p-sub" href="#">Buy</a>');
      let sessionId = '111111111111';
      const opts = makeOptions({ getSession: () => makeSession({ sessionId }) });

      applyCheckoutBindings(document, opts);
      const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
      expect(a.getAttribute('href')).toContain('sessionid=111111111111');

      sessionId = '222222222222';
      applyCheckoutBindings(document, opts);
      expect(a.getAttribute('href')).toContain('sessionid=222222222222');
    });

    it('sets href to "#" and triggers ensureDestination when the destination is not yet loaded', () => {
      setupDom('<a data-gh-checkout="not-yet-loaded" href="">Buy</a>');
      const ensure = vi.fn().mockResolvedValue(undefined);
      applyCheckoutBindings(
        document,
        makeOptions({ getDestination: () => null, ensureDestination: ensure }),
      );
      const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
      expect(a.getAttribute('href')).toBe('#');
      expect(ensure).toHaveBeenCalledWith('not-yet-loaded');
    });

    it('attaches a click handler on non-<a> elements once the session is resolved', () => {
      setupDom('<button data-gh-checkout="bio3-3p-sub">Buy</button>');
      applyCheckoutBindings(document, makeOptions());
      const button = document.querySelector<HTMLButtonElement>('button[data-gh-checkout]')!;
      expect(button.dataset['ghCheckoutBound']).toBe('1');
      expect(button.dataset['ghCheckoutUrl']).toContain('sessionid=174710238129');
    });

    it('logs a warning and sets href="#" when no URL resolves for the destination', () => {
      setupDom('<a data-gh-checkout="bio3-3p-sub" href="">Buy</a>');
      const warn = vi.fn();
      applyCheckoutBindings(
        document,
        makeOptions({
          config: makeConfig({ checkoutBase: null }),
          getDestination: () => makeDestination({ checkoutOverrideUrl: null }, { url: null }),
          logger: { debug: () => {}, warn, error: () => {} },
        }),
      );
      const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
      expect(a.getAttribute('href')).toBe('#');
      expect(warn).toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/checkout.spec.ts
  ```

  Expected failure: `TypeError: opts.getSession is not a function` on the `applyCheckoutBindings` tests.

- [ ] **Step 3: Write minimal implementation**

  3a. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/checkout.ts`, replace `CheckoutBindingsOptions` with:

  ```ts
  export interface CheckoutBindingsOptions {
    config: GhConfig;
    /**
     * Live read of session state — `null` until `ensureSession` resolves.
     * A thunk rather than a snapshot: one stable identity always reads current
     * state, so nothing can hold a pre-resolve, un-attributed session.
     */
    getSession: () => SessionState | null;
    /**
     * Resolves when `ensureSession` has settled. `makeCheckoutUrlFn` awaits it;
     * the synchronous DOM pass does not — `bindOne` holds links at `href="#"`
     * and the `gh:session-ready` rebind fills them in.
     */
    sessionPromise: Promise<unknown>;
    /** Resolve a destination slug to its cached DTO, or null if not yet loaded. */
    getDestination: (slug: string) => HippoShopDestinationDTO | null;
    /** Trigger a fetch for a destination if not yet loaded. Returns when loaded. */
    ensureDestination: (slug: string) => Promise<void>;
    logger: Logger;
  }
  ```

  3b. Replace `bindOne` with:

  ```ts
  function bindOne(el: HTMLElement, slug: string, opts: CheckoutBindingsOptions): void {
    const destination = opts.getDestination(slug);
    if (!destination) {
      // Stub href until the destination loads; trigger the load.
      if (el instanceof HTMLAnchorElement) el.setAttribute('href', '#');
      opts
        .ensureDestination(slug)
        .catch((err) =>
          opts.logger.warn(`checkout: failed to load destination "${slug}"`, err),
        );
      return;
    }

    // Session unresolved: hold the link inert rather than emitting a
    // syntactically valid URL with `sessionid` and every UTM silently missing.
    // The `gh:session-ready` rebind fills it in.
    const session = opts.getSession();
    if (!session) {
      if (el instanceof HTMLAnchorElement) el.setAttribute('href', '#');
      opts.logger.debug(`checkout: session unresolved — holding "${slug}" at href="#"`);
      return;
    }

    let url: string;
    try {
      url = composeCheckoutUrl(destination, opts.config, session);
    } catch (err) {
      opts.logger.warn(`checkout: cannot compose URL for "${slug}"`, err);
      if (el instanceof HTMLAnchorElement) el.setAttribute('href', '#');
      return;
    }

    if (el instanceof HTMLAnchorElement) {
      el.setAttribute('href', url);
      return;
    }

    // Non-<a>: attach click handler once (idempotent via dataset flag).
    if (el.dataset[BOUND_FLAG] === '1') {
      // Already bound; update the stored URL for the handler to read.
      el.dataset['ghCheckoutUrl'] = url;
      return;
    }
    el.dataset[BOUND_FLAG] = '1';
    el.dataset['ghCheckoutUrl'] = url;
    el.addEventListener('click', (evt) => {
      evt.preventDefault();
      const target = el.dataset['ghCheckoutUrl'];
      if (target && typeof window !== 'undefined') {
        window.location.href = target;
      }
    });
  }
  ```

  3c. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts`, replace the `const session = …` line plus the `applyCheckoutBindings({ … })` call (lines 84–92) with:

  ```ts
      // Cluster G: also bind [data-gh-checkout] elements. `getSession` is a live
      // read — bindOne holds links at href="#" until the session resolves, and
      // the gh:session-ready rebind fills them in. The DOM pass never awaits
      // sessionPromise, so an already-resolved promise is the honest value here.
      applyCheckoutBindings(target, {
        config: this.opts.config,
        getSession: () => getSessionState(),
        sessionPromise: Promise.resolve(),
        getDestination: (slug) => this.getCachedDestination(slug),
        ensureDestination: (slug) => this.ensureDestination(slug),
        logger: this.opts.logger,
      });
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/checkout.spec.ts test/runtime.spec.ts
  ```

  Expect `Test Files 2 passed (2)`.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/sdk/src/checkout.ts packages/sdk/src/runtime.ts packages/sdk/test/checkout.spec.ts
  git commit -m "fix(sdk): bind checkout links from a live session thunk, holding href=# until resolved"
  ```

---

### Task 16: `makeCheckoutUrlFn` becomes async — awaits the session, warms a cold destination

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/checkout.ts` (`makeCheckoutUrlFn` lines 175–201)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts` (`GhWindow.checkoutUrl` line 29; boot wiring lines 89–106)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/checkout.spec.ts` (add a `makeCheckoutUrlFn` describe block at the end)

**Interfaces:**
- Consumes: `composeCheckoutUrl` (Task 14), `CheckoutBindingsOptions` (Task 15), `getSessionState` + `ensureSession` from `packages/sdk/src/session.ts`
- Produces:
  ```ts
  export function makeCheckoutUrlFn(
    opts: Omit<CheckoutBindingsOptions, 'logger'>,
  ): (slug: string) => Promise<string>;
  ```

Two Cluster F defects die here: the pre-resolve stub session (a valid URL with no attribution) and the reassignment of `root.checkoutUrl` (which stranded any captured reference on the stub closure forever). Known accepted cost: `window.open(await gh.checkoutUrl(x))` inside a click handler breaks the user-gesture chain and gets popup-blocked; `window.location.href = url` is unaffected.

- [ ] **Step 1: Write the failing test**

  Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/checkout.spec.ts`:

  ```ts
  import { makeCheckoutUrlFn } from '../src/checkout';

  describe('makeCheckoutUrlFn', () => {
    beforeEach(() => {
      setSearch('');
    });

    it('returns a promise, not a string', () => {
      const fn = makeCheckoutUrlFn({
        config: makeConfig(),
        getSession: () => makeSession(),
        sessionPromise: Promise.resolve(),
        getDestination: () => makeDestination(),
        ensureDestination: () => Promise.resolve(),
      });
      const result = fn('bio3-3p-sub');
      expect(result).toBeInstanceOf(Promise);
      return expect(result).resolves.toContain('sessionid=174710238129');
    });

    it('resolves after an initially-cold cache instead of throwing', async () => {
      let cached: ReturnType<typeof makeDestination> | null = null;
      const ensure = vi.fn().mockImplementation(async () => {
        cached = makeDestination();
      });
      const fn = makeCheckoutUrlFn({
        config: makeConfig(),
        getSession: () => makeSession(),
        sessionPromise: Promise.resolve(),
        getDestination: () => cached,
        ensureDestination: ensure,
      });

      const url = await fn('bio3-3p-sub');

      expect(ensure).toHaveBeenCalledWith('bio3-3p-sub');
      expect(url).toContain('order_form_id=OF_123');
      expect(url).toContain('sessionid=174710238129');
    });

    it('awaits sessionPromise before composing, so the URL is never params-less', async () => {
      let session: ReturnType<typeof makeSession> | null = null;
      const sessionPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          session = makeSession({ sessionId: 'late-resolved-id', params: { utmSource: 'fb' } });
          resolve();
        }, 5);
      });
      const fn = makeCheckoutUrlFn({
        config: makeConfig(),
        getSession: () => session,
        sessionPromise,
        getDestination: () => makeDestination(),
        ensureDestination: () => Promise.resolve(),
      });

      const url = await fn('bio3-3p-sub');

      expect(url).toContain('sessionid=late-resolved-id');
      expect(url).toContain('utm_source=fb');
    });

    it('still resolves when sessionPromise rejects', async () => {
      const fn = makeCheckoutUrlFn({
        config: makeConfig(),
        getSession: () => makeSession(),
        sessionPromise: Promise.reject(new Error('session blew up')),
        getDestination: () => makeDestination(),
        ensureDestination: () => Promise.resolve(),
      });
      await expect(fn('bio3-3p-sub')).resolves.toContain('order_form_id=OF_123');
    });

    it('rejects with GhError("not_found") when the destination cannot be loaded at all', async () => {
      const fn = makeCheckoutUrlFn({
        config: makeConfig(),
        getSession: () => makeSession(),
        sessionPromise: Promise.resolve(),
        getDestination: () => null,
        ensureDestination: () => Promise.resolve(),
      });
      await expect(fn('nope')).rejects.toThrow(GhError);
      await expect(fn('nope')).rejects.toMatchObject({ code: 'not_found' });
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/checkout.spec.ts
  ```

  Expected failure: on `resolves after an initially-cold cache instead of throwing`,
  `GhError: gh.checkoutUrl("bio3-3p-sub"): destination not yet loaded — try again after gh:bindings-ready`; and on `returns a promise, not a string`, `AssertionError: expected 'https://checkout…' to be an instance of Promise`.

- [ ] **Step 3: Write minimal implementation**

  3a. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/checkout.ts`, replace `makeCheckoutUrlFn` (docblock included) with:

  ```ts
  /**
   * Programmatic equivalent of `<a data-gh-checkout="slug">`. Async by design
   * (spec D8): it awaits the session before composing, so it never returns the
   * params-less URL that a pre-resolve snapshot used to produce, and it warms a
   * cold destination cache instead of making the caller catch, subscribe to
   * `gh:bindings-ready`, and retry.
   *
   * The returned function keeps one stable identity for the life of the page —
   * it must never be reassigned, or anything holding a reference (a GTM
   * variable, a React prop, `const f = gh.checkoutUrl`) keeps a stale closure.
   *
   * Known cost: `window.open(await gh.checkoutUrl(x))` inside a click handler
   * breaks the user-gesture chain and will be popup-blocked. Assigning
   * `window.location.href` is unaffected.
   */
  export function makeCheckoutUrlFn(
    opts: Omit<CheckoutBindingsOptions, 'logger'>,
  ): (slug: string) => Promise<string> {
    return async function checkoutUrl(slug: string): Promise<string> {
      // Session first. A rejection here is not fatal — ensureSession swallows
      // its own failures and still resolves a state.
      await Promise.resolve(opts.sessionPromise).catch(() => undefined);

      let destination = opts.getDestination(slug);
      if (!destination) {
        await opts.ensureDestination(slug);
        destination = opts.getDestination(slug);
      }
      if (!destination) {
        throw new GhError(
          'not_found',
          `gh.checkoutUrl("${slug}"): destination could not be loaded`,
        );
      }

      const session = opts.getSession() ?? { sessionId: '', adopted: false, params: {} };
      return composeCheckoutUrl(destination, opts.config, session);
    };
  }
  ```

  3b. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts`, change the `GhWindow` member to:

  ```ts
    checkoutUrl?: (slug: string) => Promise<string>;
  ```

  3c. Replace the boot wiring block (the `root.checkoutUrl = makeCheckoutUrlFn({ … })` assignment and the `root.__sessionPromise = ensureSession(…).then(…).catch(…)` chain) with:

  ```ts
    // One session promise, one stable checkoutUrl identity. Cluster F installed a
    // stub session here and reassigned root.checkoutUrl when the session
    // resolved, so any captured reference kept the un-attributed stub forever.
    const sessionPromise = ensureSession(config, client).catch(() => undefined);
    root.__sessionPromise = sessionPromise;

    root.checkoutUrl = makeCheckoutUrlFn({
      config,
      getSession: () => getSessionState(),
      sessionPromise,
      getDestination: (slug) => runtime.getCachedDestination(slug),
      ensureDestination: (slug) => runtime.ensureDestination(slug),
    });
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run
  ```

  Expect every spec file to pass. Then confirm no reassignment survived:

  ```bash
  grep -n "root.checkoutUrl" /Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts
  ```

  Expected: exactly one matching line.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/sdk/src/checkout.ts packages/sdk/src/index.ts packages/sdk/test/checkout.spec.ts
  git commit -m "feat(sdk)!: gh.checkoutUrl is async — awaits session, warms a cold destination cache"
  ```

---

### Task 17: Add a keepalive event POST path to `GhDataClient`

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/client.ts` (lines 39–52 region: add a sibling to `postJson`; lines 75–91: extend the private `fetchJson` options)
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/client.spec.ts` (append to the end of the existing `describe('GhDataClient')` block)

**Interfaces:**
- Consumes: `GhConfig`, `Logger` (existing constructor args)
- Produces: `GhDataClient.prototype.postEvent(resource: string, body: unknown, headers?: Record<string, string>): Promise<void>`

**Answer to "can `postJson` already express it?" — No.** `postJson` (`client.ts:44-52`) hardcodes `credentials: 'include'`, takes no extra headers, and the private `fetchJson` options type (`client.ts:77`) declares only `{ method, body, credentials }` — there is no `keepalive` and no `headers` member, so neither `keepalive: true` (D10) nor `X-GH-Event-Id` (D9) can be passed through it. `credentials: 'include'` is also actively wrong for the funnel-event route, whose Kong config is `cors.credentials: false` (W3). Task 17 therefore adds `postEvent` and widens `fetchJson`'s option bag. No retry logic exists anywhere in `GhDataClient`, so "never retries, notably not on 429" is satisfied structurally; Task 21 pins it with a test.

- [ ] **Step 1: Write the failing test**

Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/client.spec.ts`, inside the existing `describe('GhDataClient', ...)` block (immediately before its closing `});`):

```ts
  it('postEvent POSTs with keepalive, extra headers, and no credentials', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 204 }));
    const client = new GhDataClient(CONFIG, createLogger(false));

    await client.postEvent('funnel-event', { eventType: 'Page View' }, {
      'X-GH-Event-Id': 'b2e4f0a1-7c3d-4a5b-9e8f-0123456789ab',
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api-prod.goldenhippo.io/public/v1/funnel-event');
    const req = init as RequestInit;
    expect(req.method).toBe('POST');
    expect(req.keepalive).toBe(true);
    expect(req.credentials).toBeUndefined();
    const headers = req.headers as Record<string, string>;
    expect(headers['X-GH-Event-Id']).toBe('b2e4f0a1-7c3d-4a5b-9e8f-0123456789ab');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-GH-Key']).toBe('gh_pk_test_consumer_abc123');
    expect(headers['X-GH-Brand']).toBe('Gundry MD');
    expect(req.body).toBe(JSON.stringify({ eventType: 'Page View' }));
  });

  it('postEvent issues exactly one request on 429 (no retry)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }),
    );
    const client = new GhDataClient(CONFIG, createLogger(false));
    await expect(client.postEvent('funnel-event', { a: 1 })).rejects.toMatchObject({
      name: 'GhError',
      code: 'rate_limited',
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/client.spec.ts
```

Expect failure: `TypeError: client.postEvent is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/client.ts`, insert this method immediately after the closing `}` of `postJson` (after line 52) and before `private request<T>`:

```ts
  /**
   * Cluster G / D10: fire-and-forget event POST to `/public/v1/<resource>`.
   *
   * Differs from `postJson` in three load-bearing ways:
   *   - `keepalive: true` so the request survives page unload (sendBeacon is
   *     unusable: it cannot set headers, and Kong's key-auth needs `X-GH-Key`).
   *   - caller-supplied headers, for the `X-GH-Event-Id` correlation id — it
   *     rides as a header because the 36-field body is matched byte-for-byte
   *     upstream and unrecognised keys are dropped.
   *   - no `credentials`, because the funnel-event Kong route is
   *     `cors.credentials: false` and the body is self-sufficient.
   *
   * Never retries — not even on 429 (spec non-goals). Rejects on failure; the
   * caller is responsible for swallowing.
   */
  async postEvent(
    resource: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<void> {
    const url = `${this.config.apiBaseUrl}/public/v1/${resource}`;
    this.logger.debug('POST keepalive', url);
    await this.fetchJson<unknown>(url, {
      method: 'POST',
      body,
      keepalive: true,
      headers,
    });
  }
```

Then replace the `fetchJson` signature and `init` construction (`client.ts:75-91`) with:

```ts
  private async fetchJson<T>(
    url: string,
    opts: {
      method?: string;
      body?: unknown;
      credentials?: RequestCredentials;
      keepalive?: boolean;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const method = opts.method ?? 'GET';
    const init: RequestInit = {
      method,
      headers: {
        'X-GH-Key': this.config.key,
        'X-GH-Brand': this.config.brand,
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers ?? {}),
      },
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    if (opts.credentials) init.credentials = opts.credentials;
    if (opts.keepalive) init.keepalive = true;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/client.spec.ts && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/client.ts packages/sdk/test/client.spec.ts && git commit -m "feat(sdk): add GhDataClient.postEvent — keepalive event POST with custom headers (D10)"
```

---

### Task 18: `events.ts` — the 36-field `FunnelEvent` interface and `formatVisitDate`

**Files:**
- Create: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts`
- Create: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events.spec.ts`

**Interfaces:**
- Consumes: nothing (pure module)
- Produces: `export type FunnelEventType = 'Page View'`; `export interface FunnelEvent` (36 fields, exactly the spec's D5 table); `export function formatVisitDate(now?: Date): string`

`Date.prototype.toISOString()` is **wrong** here — it emits UTC with a `Z` suffix. The Salesforce stream format is local wall-clock time with a numeric offset and millisecond precision (`2026-08-18T11:04:22.318-07:00`). The implementation below is ported line-for-line from `/Users/stevenhall/Code/hippo-frontend/hippo-builder-funnel/src/app/shared/utils/build-funnel-event.utility.ts:71-84`.

- [ ] **Step 1: Write the failing test**

Create `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events.spec.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatVisitDate } from '../src/events';

/**
 * A hand-built stand-in for Date. `formatVisitDate` only calls local getters,
 * so this makes the assertion byte-exact regardless of the machine timezone —
 * which a real `new Date()` cannot be.
 */
function fixedDate(offsetMinutesWestOfUtc: number): Date {
  return {
    getFullYear: () => 2026,
    getMonth: () => 7, // August — getMonth is 0-indexed
    getDate: () => 18,
    getHours: () => 11,
    getMinutes: () => 4,
    getSeconds: () => 22,
    getMilliseconds: () => 318,
    getTimezoneOffset: () => offsetMinutesWestOfUtc,
  } as unknown as Date;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatVisitDate', () => {
  it('formats a fixed date at UTC-7 as local wall clock plus numeric offset', () => {
    // getTimezoneOffset() returns minutes WEST of UTC, so 420 === UTC-07:00.
    expect(formatVisitDate(fixedDate(420))).toBe('2026-08-18T11:04:22.318-07:00');
  });

  it('emits a + sign and a non-zero minutes field east of UTC', () => {
    // -330 === UTC+05:30 (India) — exercises the sign flip and the mins pad.
    expect(formatVisitDate(fixedDate(-330))).toBe('2026-08-18T11:04:22.318+05:30');
  });

  it('emits +00:00 (never Z) at UTC', () => {
    const out = formatVisitDate(fixedDate(0));
    expect(out).toBe('2026-08-18T11:04:22.318+00:00');
    expect(out).not.toContain('Z');
  });

  it('is not toISOString: no Z, and shape is ISO8601 + offset + ms', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(420);
    const out = formatVisitDate(new Date());
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(out.endsWith('-07:00')).toBe(true);
    expect(out).not.toContain('Z');
  });

  it('zero-pads month, day, time components, and milliseconds to 3 digits', () => {
    const jan = {
      getFullYear: () => 2026,
      getMonth: () => 0,
      getDate: () => 3,
      getHours: () => 4,
      getMinutes: () => 5,
      getSeconds: () => 6,
      getMilliseconds: () => 7,
      getTimezoneOffset: () => 480,
    } as unknown as Date;
    expect(formatVisitDate(jan)).toBe('2026-01-03T04:05:06.007-08:00');
  });

  it('defaults to now when called with no argument', () => {
    expect(formatVisitDate()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events.spec.ts
```

Expect failure: `Error: Failed to resolve import "../src/events" from "test/events.spec.ts"`.

- [ ] **Step 3: Write minimal implementation**

Create `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts`:

```ts
/**
 * Cluster G / D5, D9, D10: funnel-event emission.
 *
 * The wire shape is the 36-field Salesforce funnel-event payload, ported from
 * hippo-builder-funnel `build-funnel-event.utility.ts:14-63` (interface) and
 * `:102-150` (base construction). `Page View` takes the reference's
 * no-override branch (`:166-171`), so every value here is the base default —
 * there is no event-specific branch logic to port.
 *
 * Three field names collide with `ParsedParams` and mean different things:
 *   - `salesFunnel` is the hardcoded literal 'Funnel', NOT ParsedParams.salesFunnel.
 *   - `url` is a step SLUG, not a URL.
 *   - `referralUrl` IS derived from document.referrer here — the opposite of
 *     the session-POST rule (D3). Different payloads; do not share a mapper.
 *
 * Nothing on this path validates: the proxy forwards verbatim and Salesforce
 * Postgres triggers drop unrecognised input silently. A 200 is not evidence a
 * row landed — hence the byte-level fidelity of every default below.
 */

/** v4 ships one event type. Adding another is a typed change, not a string. */
export type FunnelEventType = 'Page View';

export interface FunnelEvent {
  // --- SFIDs ---
  funnelSTFId: string | null;
  mainFunnelId: string | null;
  destinationId: string | null;
  funnelSTPId: string | null;
  splitTestingFunnelId: string | null;
  splitTestingPageId: string | null;

  // --- Request-specific ---
  /** Step SLUG, despite the name. */
  url: string | null;
  eventType: FunnelEventType;
  sessionId: string;
  orderId: string | null;

  // --- Custom payloads (caps-L) ---
  customPayLoad1: string | null;
  customPayLoad2: string | null;

  // --- UTMs ---
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmCampaignId: string | null;
  utmContent: string | null;
  utmTerm: string | null;

  // --- Attribution. The null-vs-'' asymmetry is deliberate legacy wire
  // shape: affId/offId default to '', subIds default to null. Do not normalize.
  affId: string;
  offId: string;
  subId1: string | null;
  subId2: string | null;
  subId3: string | null;
  subId4: string | null;
  subId5: string | null;

  // --- Hardcoded ---
  salesFunnel: 'Funnel';

  visitorId: string | null;
  visitDate: string;
  videoPercentage: number;
  leadId: string | null;
  accountId: string | null;
  referralUrl: string;
  brand: string;
  browser: string;
  os: string | null;
  device: 'Mobile' | 'Desktop';
}

/**
 * Format a Date as ISO8601 with LOCAL timezone offset and ms precision:
 * '2026-08-18T11:04:22.318-07:00'.
 *
 * `Date.prototype.toISOString()` is WRONG for this field — it emits UTC with a
 * 'Z' suffix, which is not the format the Salesforce stream carries. Ported
 * verbatim from build-funnel-event.utility.ts:71-84.
 */
export function formatVisitDate(now: Date = new Date()): string {
  const pad = (n: number, digits = 2): string => String(n).padStart(digits, '0');
  const offset = -now.getTimezoneOffset(); // positive = east of UTC
  const sign = offset >= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const hrs = pad(Math.floor(absOffset / 60));
  const mins = pad(absOffset % 60);

  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.` +
    `${pad(now.getMilliseconds(), 3)}${sign}${hrs}:${mins}`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events.spec.ts && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/events.ts packages/sdk/test/events.spec.ts && git commit -m "feat(sdk): funnel-event payload interface + formatVisitDate with local offset (D5)"
```

---

### Task 19: `detectUserAgent` — reference string vocabulary from a UA string

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts` (append after `formatVisitDate`)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events.spec.ts` (append a new `describe`)

**Interfaces:**
- Consumes: nothing
- Produces: `export interface UaDetection { browser: string; os: string | null; device: 'Mobile' | 'Desktop' }`; `export function detectUserAgent(ua: string): UaDetection`

The vocabulary must match the reference (`detect-user-agent.utility.ts`) exactly: browser ∈ `Firefox | Opera | Microsoft Edge | Chrome | Safari | Internet Explorer | Unknown`, os ∈ `Mac OS | iOS | Windows | Android | Linux | null`, device ∈ `Mobile | Desktop`. The reference reads `navigator.platform` / `navigator.userAgentData` for OS; the SDK takes a UA string (contract), so OS is derived from UA tokens with the same output words. Rule order matters twice: **iOS before Mac OS** (iPhone UA contains "like Mac OS X") and **Android before Linux** (Android UA contains "Linux").

- [ ] **Step 1: Write the failing test**

Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events.spec.ts`:

```ts
import { detectUserAgent } from '../src/events';

const UA_CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const UA_EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.51';
const UA_FIREFOX_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0';
const UA_CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const UA_OPERA_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0';
const UA_IE11 =
  'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko';

describe('detectUserAgent', () => {
  it('Chrome on macOS desktop', () => {
    expect(detectUserAgent(UA_CHROME_MAC)).toEqual({
      browser: 'Chrome',
      os: 'Mac OS',
      device: 'Desktop',
    });
  });

  it('Safari on iPhone reports iOS and Mobile, not Mac OS', () => {
    expect(detectUserAgent(UA_SAFARI_IPHONE)).toEqual({
      browser: 'Safari',
      os: 'iOS',
      device: 'Mobile',
    });
  });

  it('Edge on Windows wins over the Chrome token', () => {
    expect(detectUserAgent(UA_EDGE_WINDOWS)).toEqual({
      browser: 'Microsoft Edge',
      os: 'Windows',
      device: 'Desktop',
    });
  });

  it('Firefox on Linux', () => {
    expect(detectUserAgent(UA_FIREFOX_LINUX)).toEqual({
      browser: 'Firefox',
      os: 'Linux',
      device: 'Desktop',
    });
  });

  it('Chrome on Android reports Android, not Linux, and Mobile', () => {
    expect(detectUserAgent(UA_CHROME_ANDROID)).toEqual({
      browser: 'Chrome',
      os: 'Android',
      device: 'Mobile',
    });
  });

  it('Opera wins over the Chrome token', () => {
    expect(detectUserAgent(UA_OPERA_WINDOWS)).toEqual({
      browser: 'Opera',
      os: 'Windows',
      device: 'Desktop',
    });
  });

  it('Internet Explorer via Trident', () => {
    expect(detectUserAgent(UA_IE11)).toEqual({
      browser: 'Internet Explorer',
      os: 'Windows',
      device: 'Desktop',
    });
  });

  it('empty UA returns the reference SSR default', () => {
    expect(detectUserAgent('')).toEqual({
      browser: 'Unknown',
      os: null,
      device: 'Desktop',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events.spec.ts
```

Expect failure: `SyntaxError: The requested module '/src/events.ts' does not provide an export named 'detectUserAgent'`.

- [ ] **Step 3: Write minimal implementation**

Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts`:

```ts
// ---------------------------------------------------------------------------
// UA detection (D5) — ported for VOCABULARY PARITY with the reference
// (hippo-builder-funnel detect-user-agent.utility.ts). The reference reads
// navigator.userAgentData / navigator.platform; the SDK takes the UA string,
// so OS comes from UA tokens while producing the identical output words.
// Any drift in these strings splits Salesforce dashboard groupings.
// ---------------------------------------------------------------------------

export interface UaDetection {
  browser: string;
  os: string | null;
  device: 'Mobile' | 'Desktop';
}

/** Order is precedence. Edge/Opera must precede Chrome; Safari precedes IE. */
const BROWSER_RULES: Array<[RegExp, string]> = [
  [/Firefox\//, 'Firefox'],
  [/ OPR\//, 'Opera'],
  [/Edg\//, 'Microsoft Edge'],
  [/Chrome\//, 'Chrome'],
  [/^((?!chrome|android).)*safari/i, 'Safari'],
  [/Trident\//, 'Internet Explorer'],
];

/**
 * Order is precedence, and two orderings are load-bearing:
 *   iOS before Mac OS  — the iPhone UA contains 'like Mac OS X'.
 *   Android before Linux — the Android UA contains 'Linux'.
 */
const OS_RULES: Array<[RegExp, string]> = [
  [/(iPhone|iPad|iPod)/, 'iOS'],
  [/(Macintosh|Mac OS X)/, 'Mac OS'],
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/Linux/, 'Linux'],
];

/**
 * Detect browser / os / device from a raw user-agent string.
 * An empty string yields the reference SSR default
 * `{ browser: 'Unknown', os: null, device: 'Desktop' }`.
 */
export function detectUserAgent(ua: string): UaDetection {
  const s = ua ?? '';
  let browser = 'Unknown';
  for (const [re, name] of BROWSER_RULES) {
    if (re.test(s)) {
      browser = name;
      break;
    }
  }
  let os: string | null = null;
  for (const [re, name] of OS_RULES) {
    if (re.test(s)) {
      os = name;
      break;
    }
  }
  return { browser, os, device: /Mobi/.test(s) ? 'Mobile' : 'Desktop' };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events.spec.ts && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/events.ts packages/sdk/test/events.spec.ts && git commit -m "feat(sdk): port UA detection vocabulary for funnel events (D5)"
```

---

### Task 20: `buildPageViewEvent` — the gate, the constants, and the null-vs-empty asymmetry

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts` (append after `detectUserAgent`)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events.spec.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `GhConfig` (for `brand`), `SessionState { sessionId, adopted, params }`, `ParsedParams`, `formatVisitDate`, `detectUserAgent`
- Produces:
  ```ts
  export interface PageViewContext {
    config: GhConfig; session: SessionState;
    funnelId: string | null; destinationId: string | null; stepId: string | null;
    stepSlug: string | null; splitTestId: string | null;
    referrer: string; search: string;
  }
  export function buildPageViewEvent(ctx: PageViewContext): FunnelEvent | null;
  ```

Six behaviours are silent-corruption risks and each gets a test: the `funnelId` gate returns `null` (the reference drops the event with no log at all — `funnel-event.service.ts:82`); `url` uses `||` so `''` collapses to `null`; `funnelSTPId` uses `??` so `''` is **retained**; `affId`/`offId` default to `''` while every `subId` defaults to `null`; `salesFunnel` is the literal `'Funnel'` and never `params.salesFunnel`; `?cid=` beats `ParsedParams.utmCampaignId`.

- [ ] **Step 1: Write the failing test**

Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events.spec.ts`:

```ts
import { beforeEach } from 'vitest';
import { buildPageViewEvent, type PageViewContext } from '../src/events';
import type { GhConfig } from '../src/config';
import type { SessionState } from '../src/session';

function makeConfig(overrides: Partial<GhConfig> = {}): GhConfig {
  return {
    key: 'gh_pk_test_abc123',
    brand: 'Gundry MD',
    debug: false,
    apiBaseUrl: 'https://api-prod.goldenhippo.io',
    checkoutBase: 'https://checkout.gundrymd.com',
    cookieDomain: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'b2e4f0a1-7c3d-4a5b-9e8f-0123456789ab',
    adopted: false,
    params: {},
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PageViewContext> = {}): PageViewContext {
  return {
    config: makeConfig(),
    session: makeSession(),
    funnelId: 'a0X000000000001AAA',
    destinationId: 'a0Y000000000002AAA',
    stepId: 'a0Z000000000003AAA',
    stepSlug: 'offer-selector',
    splitTestId: null,
    referrer: '',
    search: '',
    ...overrides,
  };
}

const ISO_OFFSET_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;

describe('buildPageViewEvent', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when funnelId is absent — the D5 gate', () => {
    expect(buildPageViewEvent(makeCtx({ funnelId: null }))).toBeNull();
    expect(buildPageViewEvent(makeCtx({ funnelId: '' }))).toBeNull();
  });

  it('emits every constant field exactly', () => {
    const event = buildPageViewEvent(makeCtx())!;
    expect(event.eventType).toBe('Page View');
    expect(event.salesFunnel).toBe('Funnel');
    expect(event.splitTestingPageId).toBeNull();
    expect(event.orderId).toBeNull();
    expect(event.customPayLoad1).toBeNull();
    expect(event.customPayLoad2).toBeNull();
    expect(event.visitorId).toBeNull();
    expect(event.videoPercentage).toBe(0);
    expect(event.leadId).toBeNull();
    expect(event.accountId).toBeNull();
    expect(event.brand).toBe('Gundry MD');
    expect(event.visitDate).toMatch(ISO_OFFSET_MS);
  });

  it('salesFunnel stays the literal Funnel even when params.salesFunnel is set', () => {
    const ctx = makeCtx({ session: makeSession({ params: { salesFunnel: 'Store' } }) });
    expect(buildPageViewEvent(ctx)!.salesFunnel).toBe('Funnel');
  });

  it('mirrors funnelId into funnelSTFId and mainFunnelId', () => {
    const event = buildPageViewEvent(makeCtx({ funnelId: 'a0Xfff' }))!;
    expect(event.funnelSTFId).toBe('a0Xfff');
    expect(event.mainFunnelId).toBe('a0Xfff');
  });

  it('url collapses empty string to null while funnelSTPId retains empty string', () => {
    const event = buildPageViewEvent(makeCtx({ stepSlug: '', stepId: '' }))!;
    expect(event.url).toBeNull();
    expect(event.funnelSTPId).toBe('');
  });

  it('url carries the step SLUG, not a URL', () => {
    expect(buildPageViewEvent(makeCtx({ stepSlug: 'step-2-upsell' }))!.url).toBe(
      'step-2-upsell',
    );
  });

  it('nulls destinationId, funnelSTPId and splitTestingFunnelId when absent', () => {
    const event = buildPageViewEvent(
      makeCtx({ destinationId: null, stepId: null, splitTestId: null }),
    )!;
    expect(event.destinationId).toBeNull();
    expect(event.funnelSTPId).toBeNull();
    expect(event.splitTestingFunnelId).toBeNull();
  });

  it('defaults affId/offId to empty string but every subId to null', () => {
    const event = buildPageViewEvent(makeCtx())!;
    expect(event.affId).toBe('');
    expect(event.offId).toBe('');
    expect(event.subId1).toBeNull();
    expect(event.subId2).toBeNull();
    expect(event.subId3).toBeNull();
    expect(event.subId4).toBeNull();
    expect(event.subId5).toBeNull();
  });

  it('maps UTMs, affId/offId and subIds from ParsedParams when present', () => {
    const ctx = makeCtx({
      session: makeSession({
        params: {
          utmSource: 'fb',
          utmMedium: 'cpc',
          utmCampaign: 'summer',
          utmContent: 'creative-7',
          utmTerm: 'gut health',
          affId: 'AFF9',
          offId: 'OFF3',
          subId1: 'FBCLICKID',
          subId5: 'snap',
        },
      }),
    });
    const event = buildPageViewEvent(ctx)!;
    expect(event.utmSource).toBe('fb');
    expect(event.utmMedium).toBe('cpc');
    expect(event.utmCampaign).toBe('summer');
    expect(event.utmContent).toBe('creative-7');
    expect(event.utmTerm).toBe('gut health');
    expect(event.affId).toBe('AFF9');
    expect(event.offId).toBe('OFF3');
    expect(event.subId1).toBe('FBCLICKID');
    expect(event.subId5).toBe('snap');
  });

  it('prefers ?cid= over ParsedParams.utmCampaignId', () => {
    const ctx = makeCtx({
      search: '?cid=CID_FROM_URL',
      session: makeSession({ params: { utmCampaignId: 'FROM_UTM' } }),
    });
    expect(buildPageViewEvent(ctx)!.utmCampaignId).toBe('CID_FROM_URL');
  });

  it('falls back to ParsedParams.utmCampaignId when ?cid= is absent or empty', () => {
    const withoutCid = makeCtx({
      search: '?utm_campaign_id=FROM_UTM',
      session: makeSession({ params: { utmCampaignId: 'FROM_UTM' } }),
    });
    expect(buildPageViewEvent(withoutCid)!.utmCampaignId).toBe('FROM_UTM');
    const emptyCid = makeCtx({
      search: '?cid=',
      session: makeSession({ params: { utmCampaignId: 'FROM_UTM' } }),
    });
    expect(buildPageViewEvent(emptyCid)!.utmCampaignId).toBe('FROM_UTM');
    expect(buildPageViewEvent(makeCtx())!.utmCampaignId).toBeNull();
  });

  it('derives referralUrl from the referrer with the query stripped', () => {
    const event = buildPageViewEvent(
      makeCtx({ referrer: 'https://www.facebook.com/ads?utm_source=fb&x=1' }),
    )!;
    expect(event.referralUrl).toBe('https://www.facebook.com/ads');
  });

  it('referralUrl is empty string, never null, when there is no referrer', () => {
    expect(buildPageViewEvent(makeCtx({ referrer: '' }))!.referralUrl).toBe('');
  });

  it('carries the session id and the detected UA triple', () => {
    const event = buildPageViewEvent(makeCtx())!;
    expect(event.sessionId).toBe('b2e4f0a1-7c3d-4a5b-9e8f-0123456789ab');
    expect(event.browser).toBe('Chrome');
    expect(event.os).toBe('Mac OS');
    expect(event.device).toBe('Desktop');
  });

  it('emits exactly the 36 documented keys', () => {
    const event = buildPageViewEvent(makeCtx())!;
    expect(Object.keys(event).sort()).toEqual(
      [
        'accountId',
        'affId',
        'brand',
        'browser',
        'customPayLoad1',
        'customPayLoad2',
        'destinationId',
        'device',
        'eventType',
        'funnelSTFId',
        'funnelSTPId',
        'leadId',
        'mainFunnelId',
        'offId',
        'orderId',
        'os',
        'referralUrl',
        'salesFunnel',
        'sessionId',
        'splitTestingFunnelId',
        'splitTestingPageId',
        'subId1',
        'subId2',
        'subId3',
        'subId4',
        'subId5',
        'url',
        'utmCampaign',
        'utmCampaignId',
        'utmContent',
        'utmMedium',
        'utmSource',
        'utmTerm',
        'visitDate',
        'videoPercentage',
        'visitorId',
      ].sort(),
    );
    expect(Object.keys(event)).toHaveLength(36);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events.spec.ts
```

Expect failure: `SyntaxError: The requested module '/src/events.ts' does not provide an export named 'buildPageViewEvent'`.

- [ ] **Step 3: Write minimal implementation**

Add these imports at the top of `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts` (immediately after the module docblock, before `export type FunnelEventType`):

```ts
import type { GhConfig } from './config';
import type { SessionState } from './session';
```

Then append to the end of the file:

```ts
// ---------------------------------------------------------------------------
// Page View payload builder (D5)
// ---------------------------------------------------------------------------

export interface PageViewContext {
  config: GhConfig;
  session: SessionState;
  /** Destination DTO funnelId, else data-gh-funnel-id. Absent = do not emit. */
  funnelId: string | null;
  /** Destination DTO id, else ?origdsidOrig=. */
  destinationId: string | null;
  /** Funnel-step DTO id matched by data-gh-step. */
  stepId: string | null;
  /** data-gh-step — a step SLUG. Lands in the `url` field. */
  stepSlug: string | null;
  /** ?origsplitTestingFunnelIdOrig=. */
  splitTestId: string | null;
  /** document.referrer, raw. Query-stripped here (opposite of the D3 rule). */
  referrer: string;
  /** location.search, for ?cid=. */
  search: string;
}

/**
 * Build the 36-field `Page View` payload.
 *
 * Returns `null` when no `funnelId` resolved — the reference drops the event
 * on blank `funnelSTFId` (funnel-event.service.ts:82) and so do we. The caller
 * owns the debug-mode warn; the silent drop is the one reference behaviour
 * worth not copying.
 */
export function buildPageViewEvent(ctx: PageViewContext): FunnelEvent | null {
  const funnelId = ctx.funnelId;
  if (!funnelId) return null;

  const p = ctx.session.params;
  const ua = detectUserAgent(typeof navigator !== 'undefined' ? navigator.userAgent : '');

  return {
    // --- SFIDs ---
    funnelSTFId: funnelId,
    mainFunnelId: funnelId,
    destinationId: ctx.destinationId ?? null,
    // `??` not `||`: an empty step id is retained as '', matching
    // build-funnel-event.utility.ts:107 (`currentFunnelPageId ?? null`) where
    // the source defaults to ''.
    funnelSTPId: ctx.stepId ?? null,
    splitTestingFunnelId: ctx.splitTestId ?? null,
    splitTestingPageId: null,

    // --- Request-specific ---
    // `||` not `??`: '' collapses to null (utility.ts:112 `ctx.pageName || null`).
    url: ctx.stepSlug || null,
    // Hardcoded literal. Never build this from a variable.
    eventType: 'Page View',
    sessionId: ctx.session.sessionId,
    orderId: null,

    // --- Custom payloads: `Page View` is the no-override branch ---
    customPayLoad1: null,
    customPayLoad2: null,

    // --- UTMs ---
    utmSource: p.utmSource ?? null,
    utmMedium: p.utmMedium ?? null,
    utmCampaign: p.utmCampaign ?? null,
    utmCampaignId: readCampaignId(ctx.search, p.utmCampaignId),
    utmContent: p.utmContent ?? null,
    utmTerm: p.utmTerm ?? null,

    // --- Attribution: the '' / null asymmetry is legacy wire shape ---
    affId: p.affId ?? '',
    offId: p.offId ?? '',
    subId1: p.subId1 ?? null,
    subId2: p.subId2 ?? null,
    subId3: p.subId3 ?? null,
    subId4: p.subId4 ?? null,
    subId5: p.subId5 ?? null,

    // --- Hardcoded: NOT ParsedParams.salesFunnel ---
    salesFunnel: 'Funnel',

    visitorId: null, // Alternai is a non-goal
    visitDate: formatVisitDate(),
    videoPercentage: 0,
    leadId: null,
    accountId: null,
    // This payload's referralUrl IS document.referrer, query-stripped
    // (funnel-event.service.ts:176-180) — the opposite of the session POST.
    referralUrl: stripQuery(ctx.referrer),
    brand: ctx.config.brand,
    browser: ua.browser,
    os: ua.os,
    device: ua.device,
  };
}

/** `?cid=` wins over ParsedParams.utmCampaignId (funnel-event.service.ts:123-131). */
function readCampaignId(search: string, fromParams: string | undefined): string | null {
  let cid: string | null = null;
  try {
    cid = new URLSearchParams(search).get('cid');
  } catch {
    cid = null;
  }
  if (cid) return cid;
  return fromParams ?? null;
}

function stripQuery(value: string): string {
  return (value ?? '').split('?')[0] ?? '';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events.spec.ts && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/events.ts packages/sdk/test/events.spec.ts && git commit -m "feat(sdk): buildPageViewEvent with the D5 gate and null-vs-empty asymmetry"
```

---

### Task 21: `emitPageView` — keepalive POST to `funnel-event`, no retry, all errors swallowed

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts` (append after `stripQuery`)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events.spec.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `GhDataClient.postEvent` (Task 17), `Logger`, `generateSessionId()` from `./session` (contract: UUID v4), `buildPageViewEvent`
- Produces: `export const FUNNEL_EVENT_RESOURCE = 'funnel-event'`; `export const EVENT_ID_HEADER = 'X-GH-Event-Id'`; `export function emitPageView(client: GhDataClient, ctx: PageViewContext, logger: Logger): Promise<void>`

`generateSessionId()` is reused for the correlation id because the contract already specifies it as a UUID v4 generator; a second UUID helper would be two implementations of one thing. It can throw when neither `crypto.randomUUID` nor `getRandomValues` exists (D1), so it is wrapped — a missing correlation id must not cost us the event.

- [ ] **Step 1: Write the failing test**

Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events.spec.ts`:

```ts
import { emitPageView, FUNNEL_EVENT_RESOURCE, EVENT_ID_HEADER } from '../src/events';
import { GhDataClient } from '../src/client';
import { GhError } from '../src/errors';
import { createLogger } from '../src/log';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeClientWithSpy(): {
  client: GhDataClient;
  postEvent: ReturnType<typeof vi.fn>;
} {
  const client = new GhDataClient(makeConfig(), createLogger(false));
  const postEvent = vi.fn().mockResolvedValue(undefined);
  client.postEvent = postEvent as never;
  return { client, postEvent };
}

describe('emitPageView', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs the built event to the funnel-event resource with a uuid event-id header', async () => {
    const { client, postEvent } = makeClientWithSpy();
    await emitPageView(client, makeCtx(), createLogger(false));
    expect(postEvent).toHaveBeenCalledOnce();
    const [resource, body, headers] = postEvent.mock.calls[0]!;
    expect(resource).toBe('funnel-event');
    expect(FUNNEL_EVENT_RESOURCE).toBe('funnel-event');
    expect((body as { eventType: string }).eventType).toBe('Page View');
    expect((body as { funnelSTFId: string }).funnelSTFId).toBe('a0X000000000001AAA');
    expect((headers as Record<string, string>)[EVENT_ID_HEADER]).toMatch(UUID_RE);
    expect(EVENT_ID_HEADER).toBe('X-GH-Event-Id');
  });

  it('does not POST and warns in debug mode when the funnel id gate blocks', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    const warn = vi.spyOn(logger, 'warn');
    await emitPageView(
      client,
      makeCtx({ funnelId: null, config: makeConfig({ debug: true }) }),
      logger,
    );
    expect(postEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('stays silent when the gate blocks and debug is off', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    const warn = vi.spyOn(logger, 'warn');
    await emitPageView(client, makeCtx({ funnelId: null }), logger);
    expect(postEvent).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('swallows a network rejection', async () => {
    const { client, postEvent } = makeClientWithSpy();
    postEvent.mockRejectedValueOnce(new GhError('network', 'offline'));
    await expect(
      emitPageView(client, makeCtx(), createLogger(false)),
    ).resolves.toBeUndefined();
  });

  it('never retries on 429', async () => {
    const { client, postEvent } = makeClientWithSpy();
    postEvent.mockRejectedValueOnce(new GhError('rate_limited', 'slow down'));
    await emitPageView(client, makeCtx(), createLogger(false));
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('swallows a thrown non-Error and still resolves', async () => {
    const { client, postEvent } = makeClientWithSpy();
    postEvent.mockImplementationOnce(() => {
      throw 'boom';
    });
    await expect(
      emitPageView(client, makeCtx(), createLogger(false)),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events.spec.ts
```

Expect failure: `SyntaxError: The requested module '/src/events.ts' does not provide an export named 'emitPageView'`.

- [ ] **Step 3: Write minimal implementation**

Add these imports to the top of `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts`, below the two existing type imports:

```ts
import type { GhDataClient } from './client';
import type { Logger } from './log';
import { generateSessionId } from './session';
```

Append to the end of the file:

```ts
// ---------------------------------------------------------------------------
// Transport (D10)
// ---------------------------------------------------------------------------

/** POST target: `/public/v1/funnel-event`, Kong-fronted, upstream Altern. */
export const FUNNEL_EVENT_RESOURCE = 'funnel-event';

/**
 * Correlation id header. It rides as a HEADER, not a body key: the 36-field
 * shape is matched byte-for-byte upstream and unrecognised keys are at best
 * ignored.
 */
export const EVENT_ID_HEADER = 'X-GH-Event-Id';

/**
 * Build and deliver one `Page View`. Fire-and-forget:
 *   - never retries — notably NOT on 429 (spec non-goals),
 *   - swallows every error, including synchronous throws,
 *   - warns (debug mode only) when the D5 funnel-id gate blocks the emit.
 *
 * Deliberately does NOT dedupe — `emitPageViewOnce` owns that, so this
 * function stays a straight-line builder + transport.
 */
export async function emitPageView(
  client: GhDataClient,
  ctx: PageViewContext,
  logger: Logger,
): Promise<void> {
  let event: FunnelEvent | null = null;
  try {
    event = buildPageViewEvent(ctx);
  } catch (err) {
    logger.debug('funnel-event: could not build Page View —', err);
    return;
  }

  if (!event) {
    // The reference drops this silently; we log it, but only in debug mode so
    // a third-party-hosted page stays quiet in production.
    if (ctx.config.debug) {
      logger.warn(
        'funnel-event: no funnel id resolved (bind a data-gh-destination or set data-gh-funnel-id) — Page View not emitted',
      );
    }
    return;
  }

  const headers: Record<string, string> = {};
  const eventId = newEventId();
  if (eventId) headers[EVENT_ID_HEADER] = eventId;

  try {
    await client.postEvent(FUNNEL_EVENT_RESOURCE, event, headers);
    logger.debug('funnel-event: Page View sent', eventId);
  } catch (err) {
    // Non-fatal by design (Goal 8). No retry, no rethrow.
    logger.debug('funnel-event: Page View delivery failed —', err);
  }
}

/**
 * UUID v4 for the correlation header, reusing the session generator (contract:
 * `generateSessionId(): string // UUID v4`). It throws when the platform has
 * neither `crypto.randomUUID` nor `getRandomValues`; a missing correlation id
 * must not cost us the event, so we degrade to no header.
 */
function newEventId(): string {
  try {
    return generateSessionId();
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events.spec.ts && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/events.ts packages/sdk/test/events.spec.ts && git commit -m "feat(sdk): emitPageView — keepalive POST, X-GH-Event-Id header, no retry (D10)"
```

---

### Task 22: Per-page-load dedupe guard on a window global

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts` (append after `newEventId`)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events.spec.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `emitPageView`, `PageViewContext`, `Logger`, `GhDataClient`
- Produces:
  ```ts
  export const EVENT_GUARD_KEY = '__ghFunnelEventKeys';
  export function pageViewDedupeKey(sessionId: string, stepSlug: string | null, pathname: string): string;
  export function claimPageView(key: string): boolean;
  export function emitPageViewOnce(client: GhDataClient, ctx: PageViewContext, logger: Logger, pathname: string): Promise<void>;
  export function _resetEventsForTests(): void;
  ```

Key is `(sessionId, eventType, stepKey)` where `stepKey` is the step slug when declared, else `location.pathname` — page-level, never the destination slug, or an offer-selector page binding six destinations would produce six keys and defeat one-event-per-load. The guard lives on a **window global**, not module scope, because two SDK bundles can coexist (`index.ts:67-70` only refuses to overwrite `window.gh.data`). Deliberately **not** sessionStorage: the reference's Page View dedupe is an instance field with no persistent marker (`emission-driver.service.ts:61`), and a persistent marker would make Superfunnel pages systematically under-report.

- [ ] **Step 1: Write the failing test**

Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events.spec.ts`:

```ts
import {
  pageViewDedupeKey,
  claimPageView,
  emitPageViewOnce,
  EVENT_GUARD_KEY,
  _resetEventsForTests,
} from '../src/events';

describe('page view dedupe', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC });
  });
  afterEach(() => {
    _resetEventsForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keys on sessionId, the literal event type, and the step slug', () => {
    expect(pageViewDedupeKey('sess-1', 'offer-selector', '/lp/gut-health')).toBe(
      'sess-1|Page View|offer-selector',
    );
  });

  it('falls back to location.pathname when no step slug is declared', () => {
    expect(pageViewDedupeKey('sess-1', null, '/lp/gut-health')).toBe(
      'sess-1|Page View|/lp/gut-health',
    );
    expect(pageViewDedupeKey('sess-1', '', '/lp/gut-health')).toBe(
      'sess-1|Page View|/lp/gut-health',
    );
  });

  it('claimPageView returns true once then false for the same key', () => {
    expect(claimPageView('k1')).toBe(true);
    expect(claimPageView('k1')).toBe(false);
    expect(claimPageView('k2')).toBe(true);
  });

  it('stores the guard on a window global, not module scope', () => {
    claimPageView('k1');
    const store = (window as unknown as Record<string, Set<string>>)[EVENT_GUARD_KEY];
    expect(store).toBeInstanceOf(Set);
    expect(store.has('k1')).toBe(true);
  });

  it('emits once and suppresses the second emit for the same step', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    await emitPageViewOnce(client, makeCtx(), logger, '/lp/gut-health');
    await emitPageViewOnce(client, makeCtx(), logger, '/lp/gut-health');
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('emits again for a different step slug (SPA route change)', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    await emitPageViewOnce(client, makeCtx({ stepSlug: 'step-1' }), logger, '/p');
    await emitPageViewOnce(client, makeCtx({ stepSlug: 'step-2' }), logger, '/p');
    expect(postEvent).toHaveBeenCalledTimes(2);
  });

  it('does not burn the key when the funnel id gate blocks the emit', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    await emitPageViewOnce(client, makeCtx({ funnelId: null }), logger, '/p');
    expect(postEvent).not.toHaveBeenCalled();
    await emitPageViewOnce(client, makeCtx(), logger, '/p');
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('claims the key before awaiting, so concurrent calls cannot double-fire', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    await Promise.all([
      emitPageViewOnce(client, makeCtx(), logger, '/p'),
      emitPageViewOnce(client, makeCtx(), logger, '/p'),
    ]);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('_resetEventsForTests clears the guard', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    await emitPageViewOnce(client, makeCtx(), logger, '/p');
    _resetEventsForTests();
    await emitPageViewOnce(client, makeCtx(), logger, '/p');
    expect(postEvent).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events.spec.ts
```

Expect failure: `SyntaxError: The requested module '/src/events.ts' does not provide an export named 'pageViewDedupeKey'`.

- [ ] **Step 3: Write minimal implementation**

Append to the end of `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts`:

```ts
// ---------------------------------------------------------------------------
// Dedupe (D9) — in-memory, per page load, on a WINDOW GLOBAL
// ---------------------------------------------------------------------------

/**
 * The guard lives on `window`, not in module scope: two SDK bundles can
 * coexist on one page (index.ts only refuses to overwrite `window.gh.data`),
 * and a module-scoped Set would let each bundle emit its own Page View.
 *
 * Deliberately NOT sessionStorage. The reference's Page View dedupe is an
 * instance field with no persistent marker (emission-driver.service.ts:61);
 * its conversion events DO use sessionStorage markers, so the omission is a
 * choice. A persistent marker here would make Superfunnel pages systematically
 * under-report against funnel pages for identical traffic.
 */
export const EVENT_GUARD_KEY = '__ghFunnelEventKeys';

interface EventGuardHost {
  [EVENT_GUARD_KEY]?: Set<string>;
}

function guardHost(): EventGuardHost | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as EventGuardHost;
}

/**
 * Dedupe key: `(sessionId, eventType, stepKey)`. `stepKey` is the step slug
 * when declared, else `location.pathname`.
 *
 * The fallback is page-level on purpose. Keying on the destination slug would
 * produce six distinct keys on the canonical offer-selector page and defeat
 * the one-Page-View-per-load rule.
 */
export function pageViewDedupeKey(
  sessionId: string,
  stepSlug: string | null,
  pathname: string,
): string {
  const stepKey = stepSlug && stepSlug.length > 0 ? stepSlug : pathname;
  return `${sessionId}|Page View|${stepKey}`;
}

/** Claim `key` for this page load. `true` means the caller owns the emit. */
export function claimPageView(key: string): boolean {
  const host = guardHost();
  if (!host) return true; // no window (SSR/test harness): nothing to dedupe against
  const store = (host[EVENT_GUARD_KEY] ??= new Set<string>());
  if (store.has(key)) return false;
  store.add(key);
  return true;
}

/**
 * Emit exactly one `Page View` per (session, step) per page load.
 *
 * Ordering is load-bearing twice over:
 *   1. the gate is checked FIRST, so a blocked emit does not burn the key and
 *      a later resolved-identity emit still lands;
 *   2. the key is claimed BEFORE the await, so re-entry inside one page load
 *      cannot double-fire (the reference's SECONDARY-defense ordering).
 */
export async function emitPageViewOnce(
  client: GhDataClient,
  ctx: PageViewContext,
  logger: Logger,
  pathname: string,
): Promise<void> {
  if (!ctx.funnelId) {
    if (ctx.config.debug) {
      logger.warn(
        'funnel-event: no funnel id resolved (bind a data-gh-destination or set data-gh-funnel-id) — Page View not emitted',
      );
    }
    return;
  }

  const key = pageViewDedupeKey(ctx.session.sessionId, ctx.stepSlug, pathname);
  if (!claimPageView(key)) {
    logger.debug('funnel-event: duplicate Page View suppressed —', key);
    return;
  }

  await emitPageView(client, ctx, logger);
}

/** Test-only: clears the window-global dedupe guard. Not exported via index.ts. */
export function _resetEventsForTests(): void {
  const host = guardHost();
  if (host) delete host[EVENT_GUARD_KEY];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events.spec.ts && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/events.ts packages/sdk/test/events.spec.ts && git commit -m "feat(sdk): one Page View per page load via a window-global dedupe guard (D9)"
```

---

### Task 23: Identity selection from the DOM — destination, then checkout, then `data-gh-funnel-id`

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts` (append after `_resetEventsForTests`)
- Create: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events-emitter.spec.ts`

**Interfaces:**
- Consumes: `HippoShopDestinationDTO` (with the Cluster G `id`, `funnelId` fields), `HippoShopFunnelDTO` / `HippoShopFunnelStepDTO` (with `id`)
- Produces:
  ```ts
  export const STEP_ATTR = 'data-gh-step';
  export const FUNNEL_ID_ATTR = 'data-gh-funnel-id';
  export function readStepSlug(doc: Document): string | null;
  export function firstDestinationSlug(doc: Document): string | null;
  export interface EventIdentity { funnelId: string | null; destinationId: string | null; stepId: string | null; splitTestId: string | null }
  export interface IdentityOptions { doc: Document; getDestination: (slug: string) => HippoShopDestinationDTO | null; getFunnel: (slug: string) => HippoShopFunnelDTO | null; stepSlug: string | null; search: string }
  export function resolveEventIdentity(opts: IdentityOptions): EventIdentity;
  ```

Six bound offers are six variants of **one** page view. Identity comes from the first `[data-gh-destination]` in document order, then the first `[data-gh-checkout]`, then `data-gh-funnel-id`. `data-gh-step` is read from the live DOM at emit time (not from `GhConfig`, which is an immutable boot-time snapshot), with the script tag as the fallback — so the body element wins over the script tag regardless of document order.

- [ ] **Step 1: Write the failing test**

Create `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events-emitter.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  readStepSlug,
  firstDestinationSlug,
  resolveEventIdentity,
} from '../src/events';
import type { HippoShopDestinationDTO, HippoShopFunnelDTO } from '@goldenhippo/hippo-shop-types';

function makeDestination(
  slug: string,
  id: string,
  funnelId: string,
  funnelSlug = 'bio3-main',
): HippoShopDestinationDTO {
  // Cast: identity resolution reads only these five fields, and pinning the
  // full pricing shape here would couple this spec to unrelated DTO churn.
  return { slug, id, funnelId, funnelSlug, url: `https://www.gundrymd.com/${slug}` } as unknown as HippoShopDestinationDTO;
}

function makeFunnel(slug: string, steps: Array<{ slug: string; id: string }>): HippoShopFunnelDTO {
  return {
    slug,
    name: 'Bio Complete 3 main',
    active: true,
    steps: steps.map((s, i) => ({
      id: s.id,
      slug: s.slug,
      stepNumber: i + 1,
      name: s.slug,
      kind: 'landing',
    })),
  } as unknown as HippoShopFunnelDTO;
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

function setHead(html: string): void {
  document.head.innerHTML = html;
}

beforeEach(() => {
  setBody('');
  setHead('');
});

afterEach(() => {
  setBody('');
  setHead('');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('firstDestinationSlug', () => {
  it('takes the first [data-gh-destination] in document order out of six', () => {
    setBody(`
      <div data-gh-destination="bio3-1p-ot"></div>
      <div data-gh-destination="bio3-1p-sub"></div>
      <div data-gh-destination="bio3-3p-ot"></div>
      <div data-gh-destination="bio3-3p-sub"></div>
      <div data-gh-destination="bio3-6p-ot"></div>
      <div data-gh-destination="bio3-6p-sub"></div>
    `);
    expect(firstDestinationSlug(document)).toBe('bio3-1p-ot');
  });

  it('falls back to the first [data-gh-checkout] when no destination is bound', () => {
    setBody(`
      <a data-gh-checkout="bio3-3p-sub">Buy</a>
      <a data-gh-checkout="bio3-6p-sub">Buy more</a>
    `);
    expect(firstDestinationSlug(document)).toBe('bio3-3p-sub');
  });

  it('prefers a destination binding over a checkout binding', () => {
    setBody(`
      <a data-gh-checkout="from-checkout">Buy</a>
      <div data-gh-destination="from-destination"></div>
    `);
    expect(firstDestinationSlug(document)).toBe('from-destination');
  });

  it('returns null when neither attribute is present or values are blank', () => {
    expect(firstDestinationSlug(document)).toBeNull();
    setBody('<div data-gh-destination="   "></div>');
    expect(firstDestinationSlug(document)).toBeNull();
  });
});

describe('readStepSlug', () => {
  it('reads the attribute from the live DOM', () => {
    setBody('<section data-gh-step="offer-selector"></section>');
    expect(readStepSlug(document)).toBe('offer-selector');
  });

  it('prefers a body element over the script tag', () => {
    setHead('<script data-gh-step="from-script"></script>');
    setBody('<section data-gh-step="from-dom"></section>');
    expect(readStepSlug(document)).toBe('from-dom');
  });

  it('falls back to the script tag when nothing else declares it', () => {
    setHead('<script data-gh-step="from-script"></script>');
    expect(readStepSlug(document)).toBe('from-script');
  });

  it('returns null when absent or blank', () => {
    expect(readStepSlug(document)).toBeNull();
    setBody('<section data-gh-step="  "></section>');
    expect(readStepSlug(document)).toBeNull();
  });
});

describe('resolveEventIdentity', () => {
  const noFunnel = (): null => null;

  it('takes funnelId and destinationId from the first bound destination DTO', () => {
    setBody(`
      <div data-gh-destination="bio3-1p-ot"></div>
      <div data-gh-destination="bio3-6p-sub"></div>
    `);
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: (slug) =>
        slug === 'bio3-1p-ot'
          ? makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1')
          : makeDestination(slug, 'a0Ydest6', 'a0Xfunnel6'),
      getFunnel: noFunnel,
      stepSlug: null,
      search: '',
    });
    expect(identity.funnelId).toBe('a0Xfunnel1');
    expect(identity.destinationId).toBe('a0Ydest1');
  });

  it('falls back to data-gh-funnel-id when no destination DTO is cached', () => {
    setBody(`
      <div data-gh-funnel-id="a0Xfromattr"></div>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '',
    });
    expect(identity.funnelId).toBe('a0Xfromattr');
    expect(identity.destinationId).toBeNull();
  });

  it('reads data-gh-funnel-id off the script tag as a last resort', () => {
    setHead('<script data-gh-funnel-id="a0Xfromscript"></script>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '',
    });
    expect(identity.funnelId).toBe('a0Xfromscript');
  });

  it('returns a null funnelId when nothing resolves', () => {
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '',
    });
    expect(identity).toEqual({
      funnelId: null,
      destinationId: null,
      stepId: null,
      splitTestId: null,
    });
  });

  it('reads destinationId from ?origdsidOrig= and splitTestId from ?origsplitTestingFunnelIdOrig=', () => {
    setBody('<div data-gh-funnel-id="a0Xattr"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '?origdsidOrig=a0Yurl&origsplitTestingFunnelIdOrig=a0Wsplit',
    });
    expect(identity.destinationId).toBe('a0Yurl');
    expect(identity.splitTestId).toBe('a0Wsplit');
  });

  it('matches funnelSTPId from the cached funnel steps by step slug', () => {
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: (slug) => makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1', 'bio3-main'),
      getFunnel: (slug) =>
        slug === 'bio3-main'
          ? makeFunnel(slug, [
              { slug: 'offer-selector', id: 'a0Zstep1' },
              { slug: 'upsell', id: 'a0Zstep2' },
            ])
          : null,
      stepSlug: 'upsell',
      search: '',
    });
    expect(identity.stepId).toBe('a0Zstep2');
  });

  it('nulls stepId when the funnel is not cached or the slug does not match', () => {
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
    const base = {
      doc: document,
      getDestination: (slug: string) => makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1'),
      search: '',
    };
    expect(
      resolveEventIdentity({ ...base, getFunnel: noFunnel, stepSlug: 'upsell' }).stepId,
    ).toBeNull();
    expect(
      resolveEventIdentity({
        ...base,
        getFunnel: (slug) => makeFunnel(slug, [{ slug: 'offer-selector', id: 'a0Zstep1' }]),
        stepSlug: 'nope',
      }).stepId,
    ).toBeNull();
  });

  it('resolves the funnel slug from [data-gh-funnel] when no destination is bound', () => {
    setBody(`
      <div data-gh-funnel="bio3-main" data-gh-funnel-id="a0Xattr"></div>
      <section data-gh-step="upsell"></section>
    `);
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: (slug) =>
        slug === 'bio3-main' ? makeFunnel(slug, [{ slug: 'upsell', id: 'a0Zstep2' }]) : null,
      stepSlug: 'upsell',
      search: '',
    });
    expect(identity.stepId).toBe('a0Zstep2');
    expect(identity.funnelId).toBe('a0Xattr');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events-emitter.spec.ts
```

Expect failure: `SyntaxError: The requested module '/src/events.ts' does not provide an export named 'readStepSlug'`.

- [ ] **Step 3: Write minimal implementation**

Add this import at the top of `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts`, above the existing `import type { GhConfig }` line:

```ts
import type {
  HippoShopDestinationDTO,
  HippoShopFunnelDTO,
} from '@goldenhippo/hippo-shop-types';
```

Append to the end of the file:

```ts
// ---------------------------------------------------------------------------
// Identity selection (D5) — read from the LIVE DOM at emit time
// ---------------------------------------------------------------------------

/** Step slug. Populates `url` and, via the funnel DTO, `funnelSTPId`. */
export const STEP_ATTR = 'data-gh-step';
/** Escape hatch for pages that bind no destination. */
export const FUNNEL_ID_ATTR = 'data-gh-funnel-id';
const DESTINATION_ATTR = 'data-gh-destination';
/** Repeated locally rather than imported: checkout.ts keeps its copy private. */
const CHECKOUT_ATTR = 'data-gh-checkout';
const FUNNEL_ATTR = 'data-gh-funnel';

/**
 * Read an attribute preferring a page element over the SDK script tag.
 *
 * `:not(script)` first, script second — not plain document order: the script
 * tag usually sits in <head> and would otherwise always win, inverting the
 * documented precedence ("read from the DOM ... falling back to the value on
 * the script tag").
 */
function readAttrPreferringPage(doc: Document, attr: string): string | null {
  const fromPage = doc.querySelector(`[${attr}]:not(script)`)?.getAttribute(attr)?.trim();
  if (fromPage) return fromPage;
  const fromScript = doc.querySelector(`script[${attr}]`)?.getAttribute(attr)?.trim();
  return fromScript ? fromScript : null;
}

/**
 * `data-gh-step` at emit time. Deliberately NOT a `parseScriptConfig` field:
 * `GhConfig` is an immutable boot-time snapshot, and an observer-driven
 * re-emit can only work against a live DOM read.
 */
export function readStepSlug(doc: Document): string | null {
  return readAttrPreferringPage(doc, STEP_ATTR);
}

/**
 * The destination slug that identity comes from: first `[data-gh-destination]`
 * in document order, else first `[data-gh-checkout]`.
 *
 * The canonical offer-selector page binds six destinations. They are six
 * variants of ONE page view, not six page views.
 */
export function firstDestinationSlug(doc: Document): string | null {
  const direct = doc
    .querySelector(`[${DESTINATION_ATTR}]`)
    ?.getAttribute(DESTINATION_ATTR)
    ?.trim();
  if (direct) return direct;
  const checkout = doc
    .querySelector(`[${CHECKOUT_ATTR}]`)
    ?.getAttribute(CHECKOUT_ATTR)
    ?.trim();
  return checkout ? checkout : null;
}

export interface EventIdentity {
  funnelId: string | null;
  destinationId: string | null;
  stepId: string | null;
  splitTestId: string | null;
}

export interface IdentityOptions {
  doc: Document;
  /** Synchronous cached-destination lookup (runtime.getCachedDestination). */
  getDestination: (slug: string) => HippoShopDestinationDTO | null;
  /** Synchronous cached-funnel lookup (runtime.getCachedFunnel). */
  getFunnel: (slug: string) => HippoShopFunnelDTO | null;
  stepSlug: string | null;
  /** location.search, for the ?origdsidOrig= / ?origsplitTestingFunnelIdOrig= handoff. */
  search: string;
}

/** Resolve the Salesforce ids a Page View needs from DOM + cached DTOs. */
export function resolveEventIdentity(opts: IdentityOptions): EventIdentity {
  const slug = firstDestinationSlug(opts.doc);
  const destination = slug ? opts.getDestination(slug) : null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(opts.search);
  } catch {
    params = new URLSearchParams('');
  }

  const funnelId =
    destination?.funnelId || readAttrPreferringPage(opts.doc, FUNNEL_ID_ATTR) || null;
  const destinationId = destination?.id || params.get('origdsidOrig') || null;
  const splitTestId = params.get('origsplitTestingFunnelIdOrig') || null;

  const funnelSlug =
    destination?.funnelSlug || readAttrPreferringPage(opts.doc, FUNNEL_ATTR) || null;
  let stepId: string | null = null;
  if (funnelSlug && opts.stepSlug) {
    const funnel = opts.getFunnel(funnelSlug);
    stepId = funnel?.steps.find((s) => s.slug === opts.stepSlug)?.id ?? null;
  }

  return { funnelId, destinationId, stepId, splitTestId };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events-emitter.spec.ts && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/events.ts packages/sdk/test/events-emitter.spec.ts && git commit -m "feat(sdk): resolve funnel-event identity from destination, checkout, then data-gh-funnel-id (D5)"
```

---

### Task 24: The emitter — join on session + bindings, quiet window, hard deadline, and `gh.track`

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts` (append after `resolveEventIdentity`)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events-emitter.spec.ts` (append two new `describe` blocks)

**Interfaces:**
- Consumes: `emitPageViewOnce`, `resolveEventIdentity`, `readStepSlug`, `firstDestinationSlug`, `SessionState`, `GhConfig`, `GhDataClient`, `Logger`
- Produces:
  ```ts
  export const PAGE_VIEW_QUIET_MS = 100;
  export const PAGE_VIEW_DEADLINE_MS = 2000;
  export interface PageViewEmitterOptions {
    doc: Document; win: Window; config: GhConfig; client: GhDataClient; logger: Logger;
    getSession: () => SessionState | null;
    sessionPromise: Promise<unknown>;
    getDestination: (slug: string) => HippoShopDestinationDTO | null;
    getFunnel: (slug: string) => HippoShopFunnelDTO | null;
    ensureDestination: (slug: string) => Promise<void>;
  }
  export function installPageViewEmitter(opts: PageViewEmitterOptions): void;
  export function makeTrackFn(opts: PageViewEmitterOptions): (eventType: FunnelEventType) => Promise<void>;
  ```

A fixed `setTimeout` races: `ensureSession` can resolve synchronously (so `gh:session-ready` may fire before `DOMContentLoaded`) while a cold POST can take 800ms. So the emitter joins `gh:session-ready` **and** the session promise (belt-and-braces against Correction 3's listener-registered-too-late window) with `gh:bindings-ready`, then waits a ~100ms quiet window, capped by a hard ~2s deadline. It lives outside `bind()`, which re-runs on every observer mutation and again on `gh:session-ready`.

- [ ] **Step 1: Write the failing test**

Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events-emitter.spec.ts`:

```ts
import {
  installPageViewEmitter,
  makeTrackFn,
  emitPageViewOnce,
  _resetEventsForTests,
  PAGE_VIEW_QUIET_MS,
  PAGE_VIEW_DEADLINE_MS,
  type PageViewEmitterOptions,
} from '../src/events';
import { GhDataClient } from '../src/client';
import { createLogger } from '../src/log';
import type { GhConfig } from '../src/config';
import type { SessionState } from '../src/session';

function emitterConfig(overrides: Partial<GhConfig> = {}): GhConfig {
  return {
    key: 'gh_pk_test_abc123',
    brand: 'Gundry MD',
    debug: false,
    apiBaseUrl: 'https://api-prod.goldenhippo.io',
    checkoutBase: 'https://checkout.gundrymd.com',
    cookieDomain: null,
    ...overrides,
  };
}

function emitterSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'b2e4f0a1-7c3d-4a5b-9e8f-0123456789ab',
    adopted: false,
    params: { utmSource: 'fb' },
    ...overrides,
  };
}

function makeEmitterOpts(
  overrides: Partial<PageViewEmitterOptions> = {},
): { opts: PageViewEmitterOptions; postEvent: ReturnType<typeof vi.fn> } {
  const config = overrides.config ?? emitterConfig();
  const client = new GhDataClient(config, createLogger(false));
  const postEvent = vi.fn().mockResolvedValue(undefined);
  client.postEvent = postEvent as never;
  const opts: PageViewEmitterOptions = {
    doc: document,
    win: window,
    config,
    client,
    logger: createLogger(false),
    getSession: () => emitterSession(),
    sessionPromise: Promise.resolve(undefined),
    getDestination: (slug) => makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1'),
    getFunnel: () => null,
    ensureDestination: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { opts, postEvent };
}

describe('installPageViewEmitter', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEventsForTests();
  });

  it('emits after both readiness signals plus the quiet window', async () => {
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    expect(postEvent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('does not emit while only one signal has arrived', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      sessionPromise: new Promise<void>(() => {
        /* never resolves */
      }),
    });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).not.toHaveBeenCalled();
  });

  it('emits on the hard deadline when a signal never arrives', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      sessionPromise: new Promise<void>(() => {
        /* never resolves */
      }),
    });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('joins on the session promise when gh:session-ready fired before install', async () => {
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    // Only bindings-ready is dispatched; readiness comes from sessionPromise.
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('treats a rejected session promise as ready (degraded attribution, still emits)', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      sessionPromise: Promise.reject(new Error('session blew up')),
    });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('emits exactly once even after the deadline also elapses', async () => {
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS * 2);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('does not emit when the session never resolves to a state', async () => {
    const { opts, postEvent } = makeEmitterOpts({ getSession: () => null });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS + 1);
    expect(postEvent).not.toHaveBeenCalled();
  });
});

describe('makeTrackFn', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
  });
  afterEach(() => {
    _resetEventsForTests();
  });

  it('emits a Page View built from the live DOM', async () => {
    setBody(`
      <section data-gh-step="offer-selector"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    await makeTrackFn(opts)('Page View');
    expect(postEvent).toHaveBeenCalledOnce();
    const body = postEvent.mock.calls[0]![1] as Record<string, unknown>;
    expect(body['eventType']).toBe('Page View');
    expect(body['funnelSTFId']).toBe('a0Xfunnel1');
    expect(body['destinationId']).toBe('a0Ydest1');
    expect(body['url']).toBe('offer-selector');
    expect(body['utmSource']).toBe('fb');
  });

  it('respects the dedupe guard on a second call for the same step', async () => {
    const { opts, postEvent } = makeEmitterOpts();
    const track = makeTrackFn(opts);
    await track('Page View');
    await track('Page View');
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('emits again once data-gh-step changes (SPA route push)', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    const track = makeTrackFn(opts);
    await track('Page View');
    document.querySelector('[data-gh-step]')!.setAttribute('data-gh-step', 'step-2');
    await track('Page View');
    expect(postEvent).toHaveBeenCalledTimes(2);
    expect((postEvent.mock.calls[1]![1] as Record<string, unknown>)['url']).toBe('step-2');
  });

  it('warns and no-ops on an unsupported event type', async () => {
    const { opts, postEvent } = makeEmitterOpts();
    const warn = vi.spyOn(opts.logger, 'warn');
    await makeTrackFn(opts)('Order Paid' as never);
    expect(postEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('awaits ensureDestination when the identity destination is not yet cached', async () => {
    let cached = false;
    const ensureDestination = vi.fn().mockImplementation(async () => {
      cached = true;
    });
    const { opts, postEvent } = makeEmitterOpts({
      ensureDestination,
      getDestination: (slug) =>
        cached ? makeDestination(slug, 'a0Ylate', 'a0Xlate') : null,
    });
    await makeTrackFn(opts)('Page View');
    expect(ensureDestination).toHaveBeenCalledWith('bio3-1p-ot');
    expect(postEvent).toHaveBeenCalledOnce();
    expect((postEvent.mock.calls[0]![1] as Record<string, unknown>)['funnelSTFId']).toBe(
      'a0Xlate',
    );
  });
});
```

Also add this constant near the top of `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events-emitter.spec.ts`, directly below the imports:

```ts
const UA_CHROME_MAC_EMITTER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events-emitter.spec.ts
```

Expect failure: `SyntaxError: The requested module '/src/events.ts' does not provide an export named 'installPageViewEmitter'`.

- [ ] **Step 3: Write minimal implementation**

Append to the end of `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts`:

```ts
// ---------------------------------------------------------------------------
// Emitter timing (D9)
// ---------------------------------------------------------------------------

/** Quiet window so late-injected attributes land in the same event. */
export const PAGE_VIEW_QUIET_MS = 100;
/** Hard cap: emit with whatever resolved, or drop per the D5 gate. */
export const PAGE_VIEW_DEADLINE_MS = 2000;

const SESSION_READY_EVENT = 'gh:session-ready';
const BINDINGS_READY_EVENT = 'gh:bindings-ready';

export interface PageViewEmitterOptions {
  doc: Document;
  win: Window;
  config: GhConfig;
  client: GhDataClient;
  logger: Logger;
  /** Session THUNK, not a snapshot: null until `ensureSession` resolves. */
  getSession: () => SessionState | null;
  sessionPromise: Promise<unknown>;
  getDestination: (slug: string) => HippoShopDestinationDTO | null;
  getFunnel: (slug: string) => HippoShopFunnelDTO | null;
  ensureDestination: (slug: string) => Promise<void>;
}

/**
 * Install the one-shot Page View emitter.
 *
 * MUST live outside `bind()` — `bind()` re-runs on every observer-triggered
 * mutation (runtime.ts:154-163) and again on `gh:session-ready`
 * (runtime.ts:219-227).
 *
 * A fixed setTimeout races: `ensureSession` can resolve synchronously (so
 * `gh:session-ready` may fire before DOMContentLoaded — and before this
 * listener exists), while a cold POST can take 800ms. So readiness joins the
 * EVENT and the PROMISE, and the whole thing is capped by a hard deadline.
 */
export function installPageViewEmitter(opts: PageViewEmitterOptions): void {
  const { win, logger } = opts;
  let fired = false;
  let sessionReady = false;
  let bindingsReady = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  const fire = (reason: string): void => {
    if (fired) return;
    fired = true;
    if (quietTimer !== null) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }
    clearTimeout(deadlineTimer);
    logger.debug('funnel-event: Page View trigger —', reason);
    void runPageView(opts);
  };

  const deadlineTimer = setTimeout(() => fire('deadline'), PAGE_VIEW_DEADLINE_MS);

  const restartQuietWindow = (): void => {
    if (fired || !sessionReady || !bindingsReady) return;
    if (quietTimer !== null) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => fire('quiet-window'), PAGE_VIEW_QUIET_MS);
  };

  const markSession = (): void => {
    sessionReady = true;
    restartQuietWindow();
  };

  win.addEventListener(SESSION_READY_EVENT, markSession, { once: true });
  win.addEventListener(
    BINDINGS_READY_EVENT,
    () => {
      bindingsReady = true;
      restartQuietWindow();
    },
    { once: true },
  );

  // Second path to session readiness: the event can dispatch before this
  // listener is registered on the synchronous resolution path. `gh:session-ready`
  // fires on swallowed failure too, and so does this — a rejected promise still
  // means "attribution is as good as it is going to get".
  void opts.sessionPromise.then(markSession, markSession);
}

/**
 * Programmatic escape hatch: `gh.track('Page View')`.
 *
 * Respects the dedupe guard — a caller doing an SPA route push must update
 * `data-gh-step` before calling, otherwise the call is a deliberate no-op.
 * Single-member union in v4: adding an event type is a typed change.
 */
export function makeTrackFn(
  opts: PageViewEmitterOptions,
): (eventType: FunnelEventType) => Promise<void> {
  return async function track(eventType: FunnelEventType): Promise<void> {
    if (eventType !== 'Page View') {
      opts.logger.warn(`gh.track: unsupported event type "${String(eventType)}"`);
      return;
    }
    await opts.sessionPromise.then(
      () => undefined,
      () => undefined,
    );
    await runPageView(opts);
  };
}

/** Resolve identity from the live DOM, then emit once. Never throws. */
async function runPageView(opts: PageViewEmitterOptions): Promise<void> {
  const session = opts.getSession();
  if (!session) {
    if (opts.config.debug) {
      opts.logger.warn('funnel-event: session unresolved — Page View not emitted');
    }
    return;
  }

  // Identity comes from a destination binding; with the collectResources fix
  // the DTO is normally already cached by gh:bindings-ready. This covers the
  // deadline path and `gh.track` on a cold page.
  const slug = firstDestinationSlug(opts.doc);
  if (slug && !opts.getDestination(slug)) {
    try {
      await opts.ensureDestination(slug);
    } catch (err) {
      opts.logger.debug('funnel-event: destination load failed —', err);
    }
  }

  const search = opts.win.location.search;
  const stepSlug = readStepSlug(opts.doc);
  const identity = resolveEventIdentity({
    doc: opts.doc,
    getDestination: opts.getDestination,
    getFunnel: opts.getFunnel,
    stepSlug,
    search,
  });

  const ctx: PageViewContext = {
    config: opts.config,
    session,
    funnelId: identity.funnelId,
    destinationId: identity.destinationId,
    stepId: identity.stepId,
    stepSlug,
    splitTestId: identity.splitTestId,
    referrer: opts.doc.referrer,
    search,
  };

  await emitPageViewOnce(opts.client, ctx, opts.logger, opts.win.location.pathname);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events-emitter.spec.ts && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/events.ts packages/sdk/test/events-emitter.spec.ts && git commit -m "feat(sdk): Page View emitter timing (session+bindings join, quiet window, deadline) and gh.track (D9)"
```

---

### Additional steps for Task 24 — SPA re-emission of Page View (D9)

**Additional files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts` (replace `installPageViewEmitter` and the two readiness-event constants written in Step 3)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts` (new import after line 21; new field after line 38; new block inside `bind()` before the `bindingsReadyFired` dispatch at lines 94–97)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events-emitter.spec.ts` (append one `describe`)

**Additional interfaces:**
- Produces:
  ```ts
  export const STEP_CHANGED_EVENT = 'gh:step-changed';
  export function notifyStepChanged(win: Window): void;
  ```
- Consumes (runtime.ts): `readStepSlug(doc: Document): string | null`, `notifyStepChanged(win: Window): void`

Spec D9 puts `data-gh-step` in the observer's `attributeFilter` "so an SPA that swaps the attribute gets a new Page View through existing machinery". Task 31 Step 3 adds the attribute to that filter — but the filter only re-triggers `bind()`, and `bind()` had nothing to say about the step. Meanwhile Step 3 above sets `fired = true` permanently and registers both readiness listeners with `{ once: true }`, so the emitter can never re-arm. The only re-emit path is `gh.track`, which D9 designates an escape hatch, not the mechanism.

These steps close the loop: `bind()` (the observer path's terminus) compares the live `data-gh-step` against the last one it saw and calls `notifyStepChanged(win)` on a change; the emitter listens for that — **not** `{ once: true }` — and, when the observed slug differs from the one its last emission was built from, clears `fired` and reopens the quiet window. It does **not** re-implement dedupe: `emitPageViewOnce` already keys on `(sessionId, 'Page View', stepSlug ?? pathname)` (Task 22), so an unchanged slug is suppressed there. The `lastEmittedStep` comparison exists only to avoid pointless timer churn, and the guard remains the correctness backstop.

- [ ] **Step 6: Write the failing test**

Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events-emitter.spec.ts`:

```ts
import { GhRuntime } from '../src/runtime';
import { STEP_CHANGED_EVENT } from '../src/events';

describe('installPageViewEmitter — SPA step change (D9)', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEventsForTests();
  });

  it('re-emits when data-gh-step is swapped and the step change is signalled', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();
    expect((postEvent.mock.calls[0]![1] as Record<string, unknown>)['url']).toBe('step-1');

    // The SPA swaps the attribute. No gh.track call anywhere in this test.
    document.querySelector('[data-gh-step]')!.setAttribute('data-gh-step', 'step-2');
    window.dispatchEvent(new Event(STEP_CHANGED_EVENT));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    expect(postEvent).toHaveBeenCalledTimes(2);
    expect((postEvent.mock.calls[1]![1] as Record<string, unknown>)['url']).toBe('step-2');
  });

  it('re-arms on every subsequent step change, not just the first', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    for (const slug of ['step-2', 'step-3', 'step-4']) {
      document.querySelector('[data-gh-step]')!.setAttribute('data-gh-step', slug);
      window.dispatchEvent(new Event(STEP_CHANGED_EVENT));
      await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    }

    expect(postEvent).toHaveBeenCalledTimes(4);
    expect((postEvent.mock.calls[3]![1] as Record<string, unknown>)['url']).toBe('step-4');
  });

  it('does not re-emit when the signal arrives but the slug is unchanged', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();

    // A checkout-slug swap also lands here via the shared observer filter.
    window.dispatchEvent(new Event(STEP_CHANGED_EVENT));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS + 1);

    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('re-emits end to end through GhRuntime.bind when data-gh-step is mutated', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    const runtimeClient = {
      product: vi.fn(),
      destination: vi
        .fn()
        .mockResolvedValue(makeDestination('bio3-1p-ot', 'a0Ydest1', 'a0Xfunnel1')),
      funnel: vi.fn(),
      clearCache: vi.fn(),
    } as unknown as GhDataClient;
    const runtime = new GhRuntime({
      doc: document,
      win: window,
      logger: opts.logger,
      client: runtimeClient,
      config: opts.config,
    });

    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    // The runtime's own first bind fires gh:bindings-ready and records the
    // step-1 baseline; it must NOT signal a change on that first observation.
    await runtime.bind(document);
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();

    // Task 31 puts data-gh-step in the observer's attributeFilter, so in a real
    // browser this second bind() is the observer's, not the test's.
    document.querySelector('[data-gh-step]')!.setAttribute('data-gh-step', 'step-2');
    await runtime.bind(document);
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    expect(postEvent).toHaveBeenCalledTimes(2);
    expect((postEvent.mock.calls[1]![1] as Record<string, unknown>)['url']).toBe('step-2');
  });

  it('GhRuntime.bind stays silent when data-gh-step does not change', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const runtimeClient = {
      product: vi.fn(),
      destination: vi
        .fn()
        .mockResolvedValue(makeDestination('bio3-1p-ot', 'a0Ydest1', 'a0Xfunnel1')),
      funnel: vi.fn(),
      clearCache: vi.fn(),
    } as unknown as GhDataClient;
    const runtime = new GhRuntime({
      doc: document,
      win: window,
      logger: createLogger(false),
      client: runtimeClient,
      config: emitterConfig(),
    });
    const onStepChanged = vi.fn();
    window.addEventListener(STEP_CHANGED_EVENT, onStepChanged);

    await runtime.bind(document);
    await runtime.bind(document);
    await runtime.bind(document);

    window.removeEventListener(STEP_CHANGED_EVENT, onStepChanged);
    expect(onStepChanged).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events-emitter.spec.ts
```

Expect failure: `SyntaxError: The requested module '/src/events.ts' does not provide an export named 'STEP_CHANGED_EVENT'`.

- [ ] **Step 8: Re-arm the emitter on a step change**

In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/events.ts`, replace the two constants written in Step 3:

```ts
const SESSION_READY_EVENT = 'gh:session-ready';
const BINDINGS_READY_EVENT = 'gh:bindings-ready';
```

with:

```ts
const SESSION_READY_EVENT = 'gh:session-ready';
const BINDINGS_READY_EVENT = 'gh:bindings-ready';
/**
 * D9: an SPA swapped `data-gh-step`. Dispatched by `GhRuntime.bind()`, which is
 * where the MutationObserver's `data-gh-step` filter entry lands.
 */
export const STEP_CHANGED_EVENT = 'gh:step-changed';

/** Announce that the declared funnel step changed. Safe to call repeatedly. */
export function notifyStepChanged(win: Window): void {
  win.dispatchEvent(new Event(STEP_CHANGED_EVENT));
}
```

Then replace the whole `installPageViewEmitter` function written in Step 3 with:

```ts
export function installPageViewEmitter(opts: PageViewEmitterOptions): void {
  const { win, logger } = opts;
  /** Per-emission latch. Cleared by a step change so the SPA path can re-fire. */
  let fired = false;
  /** Sticky: the initial emission has happened at least once. */
  let firedOnce = false;
  let sessionReady = false;
  let bindingsReady = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  /** Step slug the last emission was built from. Null until the first fire. */
  let lastEmittedStep: string | null = null;

  const fire = (reason: string): void => {
    if (fired) return;
    fired = true;
    firedOnce = true;
    lastEmittedStep = readStepSlug(opts.doc);
    if (quietTimer !== null) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }
    clearTimeout(deadlineTimer);
    logger.debug('funnel-event: Page View trigger —', reason);
    void runPageView(opts);
  };

  const deadlineTimer = setTimeout(() => fire('deadline'), PAGE_VIEW_DEADLINE_MS);

  /**
   * Readiness gates the FIRST emission only. Once that has happened the page is
   * live by definition — including on the deadline path, where `sessionReady`
   * may still be false and would otherwise strand every later step change.
   */
  const ready = (): boolean => firedOnce || (sessionReady && bindingsReady);

  const restartQuietWindow = (): void => {
    if (fired || !ready()) return;
    if (quietTimer !== null) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => fire('quiet-window'), PAGE_VIEW_QUIET_MS);
  };

  const markSession = (): void => {
    sessionReady = true;
    restartQuietWindow();
  };

  win.addEventListener(SESSION_READY_EVENT, markSession, { once: true });
  win.addEventListener(
    BINDINGS_READY_EVENT,
    () => {
      bindingsReady = true;
      restartQuietWindow();
    },
    { once: true },
  );

  /**
   * The SPA re-emission path D9 asks for. NOT `{ once: true }`: a funnel can
   * push many steps in one page load.
   *
   * The slug comparison is a cheap filter against timer churn, not the dedupe
   * rule — `emitPageViewOnce` keys on (sessionId, 'Page View', step) and is the
   * authority. So a step change signalled after `gh.track` already emitted that
   * slug re-opens the quiet window here and is then correctly suppressed there.
   */
  const onStepChanged = (): void => {
    // Nothing to re-arm yet; the initial emission has its own readiness join.
    if (!firedOnce) return;
    const stepSlug = readStepSlug(opts.doc);
    if (stepSlug === lastEmittedStep) return;
    logger.debug('funnel-event: step changed, re-arming Page View —', stepSlug);
    fired = false;
    restartQuietWindow();
  };
  win.addEventListener(STEP_CHANGED_EVENT, onStepChanged);

  // Second path to session readiness: the event can dispatch before this
  // listener is registered on the synchronous resolution path. `gh:session-ready`
  // fires on swallowed failure too, and so does this — a rejected promise still
  // means "attribution is as good as it is going to get".
  void opts.sessionPromise.then(markSession, markSession);
}
```

- [ ] **Step 9: Signal the step change from the runtime's bind pass**

In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts`, add this import immediately after line 21 (`import { getSessionState } from './session';`):

```ts
import { notifyStepChanged, readStepSlug } from './events';
```

Replace the field block (lines 36–40):

```ts
  private observer: MutationObserver | null = null;
  private rebindScheduled = false;
  private bindingsReadyFired = false;
  private readonly doc: Document;
  private readonly win: Window;
```

with:

```ts
  private observer: MutationObserver | null = null;
  private rebindScheduled = false;
  private bindingsReadyFired = false;
  /** `undefined` = never observed; the first bind only records a baseline. */
  private lastStepSlug: string | null | undefined = undefined;
  private readonly doc: Document;
  private readonly win: Window;
```

Then replace the `bindingsReadyFired` block at the end of `bind()` (lines 94–97):

```ts
    if (!this.bindingsReadyFired) {
      this.bindingsReadyFired = true;
      this.win.dispatchEvent(new Event('gh:bindings-ready'));
    }
```

with:

```ts
    // Cluster G / D9: an SPA that swaps data-gh-step is declaring a new funnel
    // step. attachObserver watches that attribute (Task 31) and every such
    // mutation lands here — this is where the change becomes a signal the Page
    // View emitter can act on. Adding the attribute to the filter alone only
    // re-runs bind(); the emitter's `fired` latch would never clear.
    //
    // The first observation is a baseline, never a change: bind() runs before
    // any emission and must not re-arm an emitter that has not fired yet.
    const stepSlug = readStepSlug(this.doc);
    const stepChanged = this.lastStepSlug !== undefined && stepSlug !== this.lastStepSlug;
    this.lastStepSlug = stepSlug;
    if (stepChanged) {
      this.opts.logger.debug('data-gh-step changed —', stepSlug);
      notifyStepChanged(this.win);
    }

    if (!this.bindingsReadyFired) {
      this.bindingsReadyFired = true;
      this.win.dispatchEvent(new Event('gh:bindings-ready'));
    }
```

- [ ] **Step 10: Run tests to verify they pass**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events-emitter.spec.ts test/events.spec.ts test/runtime.spec.ts && pnpm exec tsc --noEmit
```

- [ ] **Step 11: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/events.ts packages/sdk/src/runtime.ts packages/sdk/test/events-emitter.spec.ts && git commit -m "fix(sdk): re-emit Page View when an SPA swaps data-gh-step (D9)

Putting data-gh-step in the MutationObserver's attributeFilter only re-runs
bind(). installPageViewEmitter set fired=true permanently and registered its
readiness listeners with { once: true }, so nothing re-armed it and gh.track
was the only re-emit path — an escape hatch, not the mechanism.

bind() now compares the live data-gh-step against the last one it saw and
calls notifyStepChanged(win); the emitter listens for gh:step-changed, clears
its latch and reopens the quiet window when the slug differs from the one it
last emitted. Dedupe is not duplicated — emitPageViewOnce still keys on
(sessionId, 'Page View', step) and suppresses an unchanged slug."
```

---

### Task 25: Wire the emitter and `gh.track` into boot; expose cached funnels on the runtime

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts` (line 13 import; insert a method after `getCachedDestination`, currently lines 191–194)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts` (the `GhWindow` interface, currently lines 23–35; the boot body immediately after the `root.__sessionPromise = …` assignment)
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/index.spec.ts` (append to the existing top-level `describe`)

**Interfaces:**
- Consumes: `installPageViewEmitter`, `makeTrackFn`, `PageViewEmitterOptions`, `FunnelEventType` (Task 24); `GhRuntime.getCachedDestination`, `GhRuntime.ensureDestination`
- Produces: `GhRuntime.prototype.getCachedFunnel(slug: string): HippoShopFunnelDTO | null`; `window.gh.track?: (eventType: FunnelEventType) => Promise<void>`

- [ ] **Step 1: Write the failing test**

Append to the existing top-level `describe` in `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/index.spec.ts` (immediately before its closing `});`):

```ts
  it('installs gh.track as a stable async function', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    const script = document.createElement('script');
    script.dataset['key'] = 'gh_pk_test_abc123';
    script.dataset['brand'] = 'Gundry MD';
    script.src = 'https://api-prod.goldenhippo.io/sdk/v4/gh.js';
    document.head.appendChild(script);
    delete (window as { gh?: unknown }).gh;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    expect(boot(document, window)).toBe(true);
    expect(typeof window.gh?.track).toBe('function');
    const captured = window.gh!.track!;
    await expect(captured('Page View')).resolves.toBeUndefined();
    // Stable identity: a captured reference is still the live function.
    expect(window.gh!.track).toBe(captured);
  });
```

Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/runtime.spec.ts` (inside its top-level `describe`, before the closing `});`):

```ts
  it('getCachedFunnel returns null before load and the DTO after', async () => {
    const logger = createLogger(false);
    const client = {
      funnel: vi.fn().mockResolvedValue({
        slug: 'bio3-main',
        name: 'Bio Complete 3 main',
        active: true,
        steps: [{ id: 'a0Zstep1', slug: 'offer-selector', stepNumber: 1, name: 'Offer', kind: 'landing' }],
      }),
      destination: vi.fn(),
      product: vi.fn(),
      clearCache: vi.fn(),
    } as unknown as GhDataClient;
    const runtime = new GhRuntime({ doc: document, win: window, logger, client, config: CONFIG });

    expect(runtime.getCachedFunnel('bio3-main')).toBeNull();
    document.body.innerHTML = '<div data-gh-funnel="bio3-main"></div>';
    await runtime.bind(document);
    expect(runtime.getCachedFunnel('bio3-main')?.steps[0]?.id).toBe('a0Zstep1');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/index.spec.ts test/runtime.spec.ts
```

Expect failures: `expected "undefined" to be "function"` for `gh.track`, and `TypeError: runtime.getCachedFunnel is not a function`.

- [ ] **Step 3: Write minimal implementation — runtime.ts**

Replace line 13 of `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts`:

```ts
import type { HippoShopDestinationDTO, HippoShopFunnelDTO } from '@goldenhippo/hippo-shop-types';
```

Insert this method immediately after the `getCachedDestination` method (after its closing `}`):

```ts
  /**
   * Cluster G: synchronous lookup of a cached funnel, or null. Funnel-event
   * identity needs `steps[].id` to resolve `funnelSTPId` from `data-gh-step`.
   */
  getCachedFunnel(slug: string): HippoShopFunnelDTO | null {
    return (this.resources.get(`funnel:${slug}`) as HippoShopFunnelDTO | undefined) ?? null;
  }
```

- [ ] **Step 4: Write minimal implementation — index.ts**

Add to the imports at the top of `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts`:

```ts
import {
  installPageViewEmitter,
  makeTrackFn,
  type FunnelEventType,
  type PageViewEmitterOptions,
} from './events';
```

Add this member to the `GhWindow` interface, after the `checkoutUrl` member:

```ts
  /** Cluster G / D9: programmatic Page View. Respects the per-page-load dedupe guard. */
  track?: (eventType: FunnelEventType) => Promise<void>;
```

Insert this block immediately after the `root.__sessionPromise = …` assignment completes and before the `logger.debug('booted', …)` line:

```ts
  // Cluster G / D9: funnel-event emitter. Deliberately outside bind() —
  // bind() re-runs on every observer mutation and again on gh:session-ready.
  // `getSession` is a THUNK (Correction 2): one stable identity always reads
  // live state, so a captured `gh.track` never goes stale.
  const emitterOptions: PageViewEmitterOptions = {
    doc,
    win,
    config,
    client,
    logger,
    getSession: () => getSessionState(),
    sessionPromise: root.__sessionPromise,
    getDestination: (slug) => runtime.getCachedDestination(slug),
    getFunnel: (slug) => runtime.getCachedFunnel(slug),
    ensureDestination: (slug) => runtime.ensureDestination(slug),
  };
  root.track = makeTrackFn(emitterOptions);
  installPageViewEmitter(emitterOptions);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm exec eslint src
```

- [ ] **Step 6: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/runtime.ts packages/sdk/src/index.ts packages/sdk/test/index.spec.ts packages/sdk/test/runtime.spec.ts && git commit -m "feat(sdk): wire the Page View emitter and gh.track into boot; expose getCachedFunnel"
```

---

### Task 26: Offer-selector integration test — six destinations, one event

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events-emitter.spec.ts` (append one `describe`)

**Interfaces:**
- Consumes: `installPageViewEmitter`, `_resetEventsForTests`, `PAGE_VIEW_QUIET_MS` (Task 24); `makeEmitterOpts` / `makeDestination` / `setBody` helpers already in this spec file
- Produces: no source change — this task pins the behaviour the whole group exists to guarantee

This is the pilot's canonical page shape (six destinations: quantity 1/3/6 × one-time/subscription). Six bound offers are six variants of **one** page view. The dedupe fallback is page-level rather than destination-keyed precisely so this cannot become six events.

- [ ] **Step 1: Write the failing test**

Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/events-emitter.spec.ts`:

```ts
describe('offer-selector page: six destinations, one Page View', () => {
  const SIX = [
    'bio3-1p-ot',
    'bio3-1p-sub',
    'bio3-3p-ot',
    'bio3-3p-sub',
    'bio3-6p-ot',
    'bio3-6p-sub',
  ];

  beforeEach(() => {
    _resetEventsForTests();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setBody(
      `<section data-gh-step="offer-selector">` +
        SIX.map((slug) => `<a data-gh-checkout="${slug}" data-gh-destination="${slug}"></a>`).join('') +
        `</section>`,
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEventsForTests();
  });

  it('emits exactly one event, identified by the first destination in document order', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      getDestination: (slug) =>
        makeDestination(slug, `id-${slug}`, `funnel-${slug}`, 'bio3-main'),
      getFunnel: (slug) =>
        slug === 'bio3-main'
          ? makeFunnel(slug, [{ slug: 'offer-selector', id: 'a0Zstep1' }])
          : null,
    });

    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    expect(postEvent).toHaveBeenCalledOnce();
    const body = postEvent.mock.calls[0]![1] as Record<string, unknown>;
    expect(body['funnelSTFId']).toBe('funnel-bio3-1p-ot');
    expect(body['mainFunnelId']).toBe('funnel-bio3-1p-ot');
    expect(body['destinationId']).toBe('id-bio3-1p-ot');
    expect(body['funnelSTPId']).toBe('a0Zstep1');
    expect(body['url']).toBe('offer-selector');
    expect(body['eventType']).toBe('Page View');
    expect(body['salesFunnel']).toBe('Funnel');
  });

  it('a late-arriving seventh offer does not produce a second event', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      getDestination: (slug) => makeDestination(slug, `id-${slug}`, `funnel-${slug}`),
    });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    const extra = document.createElement('a');
    extra.setAttribute('data-gh-destination', 'bio3-12p-sub');
    document.querySelector('[data-gh-step]')!.appendChild(extra);
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS + 1);

    expect(postEvent).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (the behaviour is already implemented; this pins it)**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run test/events-emitter.spec.ts
```

If either test fails, the defect is real: check that `firstDestinationSlug` prefers `[data-gh-destination]` (Task 23) and that `pageViewDedupeKey` keys on the step slug rather than the destination slug (Task 22).

- [ ] **Step 3: Run the whole SDK suite plus typecheck and lint**

```bash
cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm exec eslint src
```

- [ ] **Step 4: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/test/events-emitter.spec.ts && git commit -m "test(sdk): offer-selector page emits exactly one Page View for six bound destinations"
```


---


### Task 27: Docblock and SPEC corrections (Corrections 5 and 6)

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/types/src/destination.ts` (docblock, lines 3–9)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md` (line 103 and line 163)

**Interfaces:**
- Consumes: nothing
- Produces: nothing — prose only. Verified by grep, since no test can assert a comment.

- [ ] **Step 1: Verify both wrong statements are present**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && grep -n "Pre-Purchase only" packages/types/src/destination.ts packages/types/src/funnel.ts && grep -n 'posted to `/session`' packages/sdk/SPEC.md
  ```

  Expect exactly three hits: `packages/types/src/destination.ts:6` (wrong — destinations are Post-Purchase), `packages/types/src/funnel.ts:4` (correct — leave it alone), and two SPEC.md lines (103 and 163) naming `/session` where the code posts `/public/v1/session`.

- [ ] **Step 2: Fix the destination docblock**

  In `/Users/stevenhall/Code/hippo-shop/packages/types/src/destination.ts`, replace this docblock:

  ```ts
  /**
   * A destination resolves an offer to a funnel and a displayable price.
   *
   * Pre-Purchase only. Cross-brand requests return 404 (no enumeration).
   * Split tests are resolved server-side — host pages always see the
   * destination's `defaultFunnel`.
   */
  ```

  with:

  ```ts
  /**
   * A destination resolves an offer to a funnel and a displayable price.
   *
   * Post-Purchase only: the public API returns 404 unless both the destination
   * and its resolved `defaultFunnel` are Post-Purchase. Funnels are the
   * Pre-Purchase half of that pair — see `HippoShopFunnelDTO`. Cross-brand
   * requests return 404 (no enumeration). Split tests are resolved
   * server-side — host pages always see the destination's `defaultFunnel`.
   */
  ```

- [ ] **Step 3: Fix the two SPEC.md route references**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, replace line 103:

  ```md
  Returns the session parameters parsed from the landing URL and posted to `/session` during this visit, or `null` when the SDK skipped the POST (e.g., `connect.sid` cookie was already present).
  ```

  with:

  ```md
  Returns the session parameters parsed from the landing URL and posted to `/public/v1/session` during this visit.
  ```

  and replace line 163:

  ```md
  - `window.gh.session.params(): ParsedParams | null` — returns the session parameters parsed from the landing URL and posted to `/session` during this visit, or `null` when the SDK skipped the POST.
  ```

  with:

  ```md
  - `window.gh.session.params(): ParsedParams | null` — returns the session parameters parsed from the landing URL and posted to `/public/v1/session` during this visit.
  ```

- [ ] **Step 4: Verify the corrections landed and nothing else claims the old wording**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && grep -rn "Pre-Purchase only" packages/types/src packages/sdk/SPEC.md; grep -rn 'posted to `/session`' packages/sdk/SPEC.md; grep -n "Post-Purchase only" packages/types/src/destination.ts && grep -c 'posted to `/public/v1/session`' packages/sdk/SPEC.md
  ```

  Expect: the first two greps print nothing (exit 1), then `6:...Post-Purchase only...` from `destination.ts` and a count of `2` from SPEC.md. Note `packages/types/src/funnel.ts` keeps its "Pre-Purchase only" line — it is correct — so it no longer appears because the grep is scoped to `destination.ts` and `SPEC.md` in the last two commands.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git add packages/types/src/destination.ts packages/sdk/SPEC.md && git commit -m "docs: destinations are Post-Purchase; session POSTs to /public/v1/session

  The destination docblock was pasted from funnel.ts and inherited its
  Pre-Purchase claim; the server enforces the opposite for destinations.
  SPEC named /session where the client posts /public/v1/session."
  ```

---

### Task 28: The runtime carries the boot-time session promise (Corrections 1 and 2)

**Already landed upstream — do not redo any of it:** Task 4 rewrote the `SessionState` literals (`hasConnectSid` → `adopted`, `params: {}`). Task 15 replaced runtime.ts's snapshot call site with `getSession: () => getSessionState()` and made `bindOne` hold links at `href="#"` while the session is `null`. Task 16 made `makeCheckoutUrlFn` async, changed `GhWindow.checkoutUrl` to `(slug: string) => Promise<string>`, and rewrote boot's wiring to one `const sessionPromise = ensureSession(...)` plus a **single** `root.checkoutUrl = makeCheckoutUrlFn({ … getSession, sessionPromise … })` — the reassignment inside `.then()` is already gone.

What is still broken after Task 16: `GhRuntime` has no way to receive that promise, so `bind()` hands `applyCheckoutBindings` a fabricated `Promise.resolve()` (Task 15's placeholder) while boot holds the real one. One page, two different "session promises". This task closes that gap and installs the standing regression guard for Correction 2 — a *captured* `gh.checkoutUrl` reference must still compose an attributed URL.

**Files:**
- Test: create `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session-promise-wiring.spec.ts`
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts` (field block, located by the quoted anchors — Task 24 shifts these; the `sessionPromise` argument inside the `applyCheckoutBindings(target, { … })` call Task 15 left at lines 84–95)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts` (one inserted line after `root.__sessionPromise = sessionPromise;`)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md` (lines 91–95 and line 161 — Task 27 touched 103 and 163, so these are untouched)

**Interfaces:**
- Consumes: `applyCheckoutBindings(root: ParentNode, opts: CheckoutBindingsOptions): void` and `CheckoutBindingsOptions { config; getSession: () => SessionState | null; sessionPromise: Promise<unknown>; getDestination; ensureDestination; logger }` (Task 15); `makeCheckoutUrlFn(opts: Omit<CheckoutBindingsOptions,'logger'>): (slug: string) => Promise<string>` (Task 16); `getSessionState(): SessionState | null`; `ensureSession(config, client): Promise<SessionState>`
- Produces: `GhRuntime.prototype.setSessionPromise(promise: Promise<unknown>): void`

- [ ] **Step 1: Write the failing test**

  Create `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session-promise-wiring.spec.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { boot } from '../src/index';
  import { GhRuntime } from '../src/runtime';
  import { GhDataClient } from '../src/client';
  import { createLogger } from '../src/log';
  import { applyCheckoutBindings, type CheckoutBindingsOptions } from '../src/checkout';
  import { _resetForTests } from '../src/session';
  import type { GhConfig } from '../src/config';

  // Partial mock: the real implementation still runs on every call, but each
  // call is recorded so the options object handed to it can be inspected.
  vi.mock('../src/checkout', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/checkout')>();
    return { ...actual, applyCheckoutBindings: vi.fn(actual.applyCheckoutBindings) };
  });

  const CONFIG: GhConfig = {
    key: 'gh_pk_internal_test_abc123',
    brand: 'Gundry MD',
    debug: false,
    apiBaseUrl: 'https://api-prod.goldenhippo.io',
    checkoutBase: 'https://checkout.gundrymd.com',
    cookieDomain: null,
  };

  const DESTINATION = {
    id: 'a0D0m000002Dst1EAC',
    slug: 'bio3-3p-sub',
    name: 'Bio Complete 3 — 3-pack subscription',
    description: null,
    funnelSlug: 'bio-complete-3-main',
    funnelId: 'a0F0m000002Fnl1EAC',
    url: null,
    pricing: {
      familyOrBundleId: 'fam1',
      orderFormId: 'OF_123',
      sku: 'BIO3-3P-SUB',
      packageQuantity: 3,
      purchaseType: 'subscription',
      frequency: null,
      price: { amount: 49.95, currency: 'USD', savings: null },
      rebillPrice: { amount: 49.95, currency: 'USD', savings: null },
      outOfStock: false,
      restrictedCountryCodes: [],
      shipping: { domestic: 0, international: 0, freeShippingThreshold: null },
      bumpOffers: [],
      checkoutOverrideUrl: null,
    },
  };

  function installScript(attrs: Record<string, string>): void {
    const s = document.createElement('script');
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'src') s.src = v;
      else s.setAttribute(`data-${k}`, v);
    }
    document.head.appendChild(s);
  }

  function lastBindingOptions(): CheckoutBindingsOptions {
    const calls = vi.mocked(applyCheckoutBindings).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls.at(-1)![1];
  }

  describe('GhRuntime.setSessionPromise', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
      vi.mocked(applyCheckoutBindings).mockClear();
    });

    it('binds with a settled promise until boot hands one over, then with the real one', async () => {
      const runtime = new GhRuntime({
        logger: createLogger(false),
        client: new GhDataClient(CONFIG, createLogger(false)),
        config: CONFIG,
      });

      // Direct-construction path (tests, embedders): nothing is pending, so an
      // already-settled promise is the honest default.
      await runtime.bind(document);
      const beforeHandover = lastBindingOptions().sessionPromise;
      expect(beforeHandover).toBeInstanceOf(Promise);
      await expect(beforeHandover).resolves.toBeUndefined();

      const sessionPromise = Promise.resolve('resolved-session');
      runtime.setSessionPromise(sessionPromise);
      await runtime.bind(document);

      expect(lastBindingOptions().sessionPromise).toBe(sessionPromise);
    });
  });

  describe('boot hands its session promise to the runtime', () => {
    beforeEach(() => {
      document.head.innerHTML = '';
      document.body.innerHTML = '';
      delete (window as { gh?: unknown }).gh;
      vi.restoreAllMocks();
      vi.mocked(applyCheckoutBindings).mockClear();
      _resetForTests();

      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          href: 'https://info.gundrymd.com/lp?sessionid=abc123&utm_source=fb',
          search: '?sessionid=abc123&utm_source=fb',
          hostname: 'info.gundrymd.com',
          protocol: 'https:',
        },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });

      vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        const u = String(url);
        if (u.includes('/public/v1/destination/')) {
          return Promise.resolve(new Response(JSON.stringify(DESTINATION), { status: 200 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });
    });

    it('binds checkout links with the very promise exposed as __sessionPromise', async () => {
      installScript({
        key: 'gh_pk_internal_test_abc123',
        brand: 'Gundry MD',
        'checkout-base': 'https://checkout.gundrymd.com',
        src: 'https://api-prod.goldenhippo.io/sdk/v4/gh.js',
      });
      expect(boot()).toBe(true);

      // installAutoBind schedules the first bind pass with setTimeout(…, 0).
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(lastBindingOptions().sessionPromise).toBe(window.gh!.__sessionPromise);
    });

    it('a captured gh.checkoutUrl reference composes an attributed URL after the session resolves', async () => {
      installScript({
        key: 'gh_pk_internal_test_abc123',
        brand: 'Gundry MD',
        'checkout-base': 'https://checkout.gundrymd.com',
        src: 'https://api-prod.goldenhippo.io/sdk/v4/gh.js',
      });
      boot();

      // Captured in the pre-resolve window — exactly what a GTM variable or a
      // React prop does. Cluster F stranded this reference on a stub closure.
      const captured = window.gh!.checkoutUrl!;
      await window.gh!.__sessionPromise;

      const url = new URL(await captured('bio3-3p-sub'));
      expect(url.searchParams.get('sessionid')).toBe('abc123');
      expect(url.searchParams.get('utm_source')).toBe('fb');
      expect(url.searchParams.get('order_form_id')).toBe('OF_123');
      // One identity for the life of the page: boot must never reassign the slot.
      expect(window.gh!.checkoutUrl).toBe(captured);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/session-promise-wiring.spec.ts
  ```

  Expect exactly two failures:
  - `binds with a settled promise until boot hands one over, then with the real one` → `TypeError: runtime.setSessionPromise is not a function`
  - `binds checkout links with the very promise exposed as __sessionPromise` → `AssertionError: expected Promise{…} to be Promise{…} // Object.is equality` — `bind()` still passes the `Promise.resolve()` Task 15 hard-coded, which is not boot's promise.

  The third test (`a captured gh.checkoutUrl reference …`) **passes already**: Task 16 installed the stable async identity that reads the session through a thunk. It is here as the standing guard for Correction 2 — Steps 3–5 must not regress it.

- [ ] **Step 3: Give `GhRuntime` a session-promise field**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts`, add the field immediately after `private readonly win: Window;` (locate by the quoted text — Task 24 Step 9 inserts lines into this block, so the pristine line numbers no longer hold):

  ```ts
    /**
     * The boot-time session promise, handed over by `boot()` right after
     * `ensureSession` is invoked. Until then it is an already-settled promise,
     * which is the honest value for the direct-construction path (tests,
     * embedders) where no session resolution is pending at all.
     */
    private sessionPromise: Promise<unknown> = Promise.resolve();
  ```

  Then add this method immediately after the constructor's closing `}` (locate by structure, not line number — Task 24 runs first):

  ```ts
    /**
     * Hand the runtime the boot-time session promise, so every checkout bind
     * pass carries the real promise rather than a fabricated resolved one.
     * Called once, by `boot()`.
     */
    setSessionPromise(promise: Promise<unknown>): void {
      this.sessionPromise = promise;
    }
  ```

- [ ] **Step 4: Pass the real promise through `bind()`**

  In the same file, inside `bind()`, replace these six lines — the tail of the comment plus the head of the `applyCheckoutBindings` call Task 15 wrote (indentation is four spaces for the statement, six for the object properties; Task 15's fence showed the block over-indented, so match the file, not the fence):

  ```ts
      // the gh:session-ready rebind fills them in. The DOM pass never awaits
      // sessionPromise, so an already-resolved promise is the honest value here.
      applyCheckoutBindings(target, {
        config: this.opts.config,
        getSession: () => getSessionState(),
        sessionPromise: Promise.resolve(),
  ```

  with:

  ```ts
      // the gh:session-ready rebind fills them in. `sessionPromise` is boot's
      // own promise, handed over by setSessionPromise — the synchronous DOM
      // pass does not await it, but anything reading it back off these options
      // must get the real one, not a fabricated resolved stand-in.
      applyCheckoutBindings(target, {
        config: this.opts.config,
        getSession: () => getSessionState(),
        sessionPromise: this.sessionPromise,
  ```

  Leave the remaining four lines of the call (`getDestination`, `ensureDestination`, `logger`, `});`) exactly as Task 15 left them.

- [ ] **Step 5: Hand the promise over in `boot()`**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts`, insert one line immediately after `root.__sessionPromise = sessionPromise;` (the two-line pair Task 16 wrote; Task 25's emitter block may sit below it — insert above whatever follows), so the sequence reads:

  ```ts
    const sessionPromise = ensureSession(config, client).catch(() => undefined);
    root.__sessionPromise = sessionPromise;
    // The runtime's checkout bind pass gets this same promise — one session
    // promise for the whole page, never a second fabricated one.
    runtime.setSessionPromise(sessionPromise);
  ```

  Nothing else in `boot()` changes: Task 16 already deleted the `root.checkoutUrl` reassignment and wired the `getSession` thunk into the single `makeCheckoutUrlFn` call.

- [ ] **Step 6: Run the test to verify it passes**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/session-promise-wiring.spec.ts
  ```

  Expect `Test Files 1 passed (1)`, `Tests 3 passed (3)`.

- [ ] **Step 7: Run the full SDK suite, typecheck and lint**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop/packages/sdk && pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm exec eslint src
  ```

  Expect every spec file to pass, then no output and exit status 0 from both `tsc` and `eslint`. A `Property 'sessionPromise' is private` error means the `bind()` edit landed outside the class.

- [ ] **Step 8: Delete the closure-capture gotcha from SPEC.md**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, replace lines 91–95:

  ```md
  ### `window.gh.checkoutUrl(slug: string): string`

  Returns the composed checkout URL for the destination identified by `slug`, without navigating. Throws if the destination is not yet cached or if no base URL is configured.

  **Important — closure-capture gotcha:** Always call `window.gh.checkoutUrl(slug)` directly on each use. Do NOT cache the function reference, e.g., `const fn = window.gh.checkoutUrl; fn('slug')`. The SDK swaps the underlying closure when the session resolves so subsequent calls pick up the real `session_id` — a cached reference would keep returning URLs with an empty `session_id` indefinitely.
  ```

  with:

  ```md
  ### `window.gh.checkoutUrl(slug: string): Promise<string>`

  Resolves to the composed destination URL for `slug`, without navigating. Awaits session resolution and loads the destination if it is not yet cached, so it never resolves to an unattributed URL. Rejects with `GhError('not_found')` when the destination cannot be loaded and `GhError('config')` when no base URL resolves for it.

  The function identity is stable for the life of the page and reads live session state, so caching the reference (`const fn = window.gh.checkoutUrl`) is safe. One accepted cost of the async signature: `window.open(await gh.checkoutUrl(slug))` inside a click handler breaks the user-gesture chain and will be popup-blocked — assign `window.location.href` instead.
  ```

  Then replace line 161:

  ```md
  - `window.gh.checkoutUrl(slug: string): string` — returns the composed checkout URL for the destination identified by `slug`, without navigating. Throws if the destination is not yet cached or if no base URL is configured. See [Checkout handoff](#checkout-handoff) for the closure-capture gotcha.
  ```

  with:

  ```md
  - `window.gh.checkoutUrl(slug: string): Promise<string>` — resolves to the composed destination URL for `slug`, without navigating. Awaits session resolution and loads the destination if needed. The function identity is stable and safe to cache.
  ```

- [ ] **Step 9: Commit**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/index.ts packages/sdk/src/runtime.ts packages/sdk/test/session-promise-wiring.spec.ts packages/sdk/SPEC.md && git commit -m "fix(sdk): one session promise for the page — the runtime gets boot's, not its own

  Task 15 left applyCheckoutBindings receiving a hard-coded Promise.resolve()
  because GhRuntime had no way to reach the promise boot creates. GhRuntime now
  takes it via setSessionPromise and forwards it on every bind pass.

  Locks in Correction 2 with a regression test: a gh.checkoutUrl reference
  captured before the session resolves still composes a URL carrying sessionid
  and the UTMs, and boot never reassigns the slot. SPEC drops the
  closure-capture gotcha, which the async thunk retired."
  ```

---

### Task 29: Register the `gh:session-ready` rebind before `ensureSession` runs (Correction 3)

**Files:**
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/runtime.spec.ts` (append a new `describe` at the end)
- Create: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session-ready-ordering.spec.ts`
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts` (`installAutoBind`, lines 201–228; new private flag near line 38)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts` (boot body, immediately before the `ensureSession` invoke)

**Interfaces:**
- Consumes: `ensureSession(config, client): Promise<SessionState>`; `SessionState { sessionId; adopted; params }`
- Produces: `GhRuntime.installSessionReadyRebind(): void`

- [ ] **Step 1: Write the failing runtime unit tests**

  Append to `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/runtime.spec.ts`:

  ```ts
  describe('GhRuntime — session-ready rebind (Cluster G Correction 3)', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
      vi.restoreAllMocks();
    });

    it('installSessionReadyRebind() rebinds synchronously when gh:session-ready fires', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(PRODUCT), { status: 200 }),
      );
      document.body.innerHTML =
        `<div data-gh-product="bio-complete-3"><span data-field="name"></span></div>`;
      const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient(), config: CONFIG });

      runtime.installSessionReadyRebind();
      window.dispatchEvent(new CustomEvent('gh:session-ready', { detail: {} }));

      // bind() reaches fetch() synchronously, so no awaits are needed.
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('is idempotent — registering twice binds once per gh:session-ready', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(PRODUCT), { status: 200 }),
      );
      const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient(), config: CONFIG });
      const bindSpy = vi.spyOn(runtime, 'bind');

      runtime.installSessionReadyRebind();
      runtime.installSessionReadyRebind();
      window.dispatchEvent(new CustomEvent('gh:session-ready', { detail: {} }));

      expect(bindSpy).toHaveBeenCalledTimes(1);
    });
  });
  ```

- [ ] **Step 2: Write the failing boot-ordering test**

  Create `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/session-ready-ordering.spec.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

  /**
   * Cluster G Correction 3: `gh:session-ready` can be dispatched *synchronously*,
   * inside the very call that invokes `ensureSession` — an async function with no
   * awaits on its resolution path runs to completion before returning its
   * promise. This spec fakes exactly that session, so a listener registered
   * after the invoke never sees the event.
   */
  const SYNC_STATE = { sessionId: 'sync-session', adopted: false, params: {} };

  vi.mock('../src/session', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/session')>();
    return {
      ...actual,
      ensureSession: vi.fn(async () => {
        window.dispatchEvent(new CustomEvent('gh:session-ready', { detail: SYNC_STATE }));
        return SYNC_STATE;
      }),
    };
  });

  import { boot } from '../src/index';

  const PRODUCT = {
    slug: 'p1',
    name: 'Sync Product',
    variants: {
      subscription: { standard: [{ price: 49.95 }], myAccount: [] },
      oneTime: { standard: [], myAccount: [] },
    },
  };

  function installScript(attrs: Record<string, string>): HTMLScriptElement {
    const s = document.createElement('script');
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'src') s.src = v;
      else s.setAttribute(`data-${k}`, v);
    }
    document.head.appendChild(s);
    return s;
  }

  describe('boot() — gh:session-ready registration order (Correction 3)', () => {
    beforeEach(() => {
      document.head.innerHTML = '';
      document.body.innerHTML = '';
      delete (window as { gh?: unknown }).gh;
      // Fake timers keep installAutoBind's setTimeout(0) initial bind pending,
      // so any bind observed below can only be the session-ready rebind.
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('rebinds on a gh:session-ready dispatched synchronously during boot', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(PRODUCT), { status: 200 }),
      );
      document.body.innerHTML =
        `<div data-gh-product="p1"><span data-field="name">placeholder</span></div>`;
      installScript({
        key: 'gh_pk_internal_test_abc123',
        brand: 'Gundry MD',
        'checkout-base': 'https://checkout.gundrymd.com',
        src: 'https://api-prod.goldenhippo.io/sdk/v4/gh.js',
      });

      expect(boot()).toBe(true);

      // No awaits: bind() reaches fetch() synchronously, and awaiting here would
      // let the deferred initial bind run and mask the defect.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(
        'https://api-prod.goldenhippo.io/public/v1/product/p1',
      );
      fetchSpy.mockRestore();
    });
  });
  ```

- [ ] **Step 3: Run both specs to verify they fail**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/runtime.spec.ts test/session-ready-ordering.spec.ts
  ```

  Expect the two runtime tests to fail with `TypeError: runtime.installSessionReadyRebind is not a function`, and the ordering test to fail with `AssertionError: expected "spy" to be called 1 times, but got 0 times`.

- [ ] **Step 4: Extract `installSessionReadyRebind` on the runtime**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts`, add the flag immediately after `private bindingsReadyFired = false;` (line 38):

  ```ts
    private sessionReadyInstalled = false;
  ```

  Then replace the whole `installAutoBind` method (lines 201–228):

  ```ts
    /** Wire DOMContentLoaded → initial bind. Idempotent. */
    installAutoBind(): void {
      const run = (): void => {
        void this.bind(this.doc)
          .catch(err => this.opts.logger.error('initial bind failed', err))
          .finally(() => this.attachObserver());
      };
      if (this.doc.readyState === 'loading') {
        this.doc.addEventListener('DOMContentLoaded', run, { once: true });
      } else {
        // setTimeout(0) yields a full task so subsequent inline scripts (e.g.
        // registering a custom formatter) finish before the first bind pass.
        // queueMicrotask runs *between* script tags and would miss them.
        setTimeout(run, 0);
      }

      // Cluster F: re-bind once the session resolves so checkout hrefs pick up
      // the real session_id. Fire-and-forget; bind() handles its own errors.
      this.win.addEventListener(
        'gh:session-ready',
        () => {
          void this.bind(this.doc).catch((err) =>
            this.opts.logger.error('session-ready rebind failed', err),
          );
        },
        { once: true },
      );
    }
  ```

  with:

  ```ts
    /** Wire DOMContentLoaded → initial bind. Idempotent. */
    installAutoBind(): void {
      const run = (): void => {
        void this.bind(this.doc)
          .catch(err => this.opts.logger.error('initial bind failed', err))
          .finally(() => this.attachObserver());
      };
      if (this.doc.readyState === 'loading') {
        this.doc.addEventListener('DOMContentLoaded', run, { once: true });
      } else {
        // setTimeout(0) yields a full task so subsequent inline scripts (e.g.
        // registering a custom formatter) finish before the first bind pass.
        // queueMicrotask runs *between* script tags and would miss them.
        setTimeout(run, 0);
      }

      // Safety net for callers that only call installAutoBind(). boot() calls
      // this earlier — before ensureSession — and the flag makes it a no-op.
      this.installSessionReadyRebind();
    }

    /**
     * Re-bind once the session resolves, so checkout hrefs pick up the real
     * `sessionid` instead of staying at "#".
     *
     * Must be registered *before* `ensureSession` is invoked: a session that
     * resolves without awaiting anything dispatches `gh:session-ready`
     * synchronously, inside the invoking call, and a listener registered
     * afterwards would never see it. Idempotent. Fire-and-forget; `bind()`
     * handles its own errors.
     */
    installSessionReadyRebind(): void {
      if (this.sessionReadyInstalled) return;
      this.sessionReadyInstalled = true;
      this.win.addEventListener(
        'gh:session-ready',
        () => {
          void this.bind(this.doc).catch((err) =>
            this.opts.logger.error('session-ready rebind failed', err),
          );
        },
        { once: true },
      );
    }
  ```

- [ ] **Step 5: Register the listener before the invoke in boot**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/index.ts`, insert these lines immediately before `const sessionPromise = ensureSession(config, client).catch(() => undefined);`:

  ```ts
    // Registered before ensureSession is invoked: a session that resolves with
    // no awaits dispatches gh:session-ready synchronously, from inside the call
    // below, and a listener registered afterwards would never see it.
    runtime.installSessionReadyRebind();

  ```

- [ ] **Step 6: Run both specs to verify they pass**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/runtime.spec.ts test/session-ready-ordering.spec.ts
  ```

- [ ] **Step 7: Commit**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/runtime.ts packages/sdk/src/index.ts packages/sdk/test/runtime.spec.ts packages/sdk/test/session-ready-ordering.spec.ts && git commit -m "fix(sdk): register the gh:session-ready rebind before ensureSession runs

  The listener was installed by installAutoBind(), which boot() calls last —
  after ensureSession is invoked. A session that resolves without awaiting
  anything dispatches gh:session-ready synchronously from inside that invoke,
  so the rebind never fired and checkout hrefs stayed at '#'.

  Extracted installSessionReadyRebind() and call it from boot() before the
  invoke; installAutoBind() still calls it as an idempotent safety net."
  ```

---

### Task 30: `collectResources` treats `data-gh-checkout` as a destination reference (Correction 4a)

**Files:**
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/bindings.spec.ts` (append inside the existing `describe('collectResources', …)`, after the `<template>` test at lines 89–96)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/bindings.ts` (`collectResources`, lines 52–76; new module constant near line 39)

**Interfaces:**
- Consumes: `ResourceRef { kind: ResourceKind; slug: string }`, `resourceKey(ref): string`, `RESOURCE_KINDS`, `RESOURCE_ATTR` (all already exported from `bindings.ts`)
- Produces: `collectResources(root): ResourceRef[]` now also yields `{ kind: 'destination', slug }` for every `[data-gh-checkout]`

- [ ] **Step 1: Write the failing test**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/bindings.spec.ts`, add this test inside `describe('collectResources', …)`, immediately after the `'ignores content inside <template> tags'` test:

  ```ts
    it('treats data-gh-checkout as a destination reference (Cluster G Correction 4)', () => {
      setHtml(`
        <a data-gh-checkout="d1" href="#">Buy one</a>
        <button data-gh-checkout="d2">Buy two</button>
        <a data-gh-checkout="d1" href="#">Buy one again</a>
        <span data-gh-destination="d2"></span>
      `);
      const refs = collectResources(document);
      const keys = refs.map(resourceKey).sort();
      // d1 deduped across two links; d2 deduped across data-gh-checkout and
      // data-gh-destination — both name the same cache key.
      expect(keys).toEqual(['destination:d1', 'destination:d2']);
    });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/bindings.spec.ts
  ```

  Expect:

  ```
  AssertionError: expected [ 'destination:d2' ] to deeply equal [ 'destination:d1', 'destination:d2' ]
  ```

- [ ] **Step 3: Collect checkout slugs as destination refs**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/bindings.ts`, add this constant immediately after `const HIDDEN_BY_GH_ATTR = 'data-gh-hidden';` (line 40):

  ```ts
  /**
   * Cluster G: `data-gh-checkout="<slug>"` is a destination reference too — a
   * checkout link cannot be pointed anywhere until its DTO (and its `url`)
   * resolves, so `bind()` must await it like any other resource instead of
   * leaving the link at "#" and hoping something re-binds.
   */
  const CHECKOUT_ATTR = 'data-gh-checkout';
  ```

  Then replace the whole `collectResources` function (lines 52–76):

  ```ts
  export function collectResources(root: ParentNode | Element): ResourceRef[] {
    const seen = new Set<string>();
    const out: ResourceRef[] = [];
    const add = (kind: ResourceKind, slug: string): void => {
      const key = `${kind}:${slug}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ kind, slug });
    };
    const consider = (el: Element): void => {
      for (const kind of RESOURCE_KINDS) {
        const slug = el.getAttribute(RESOURCE_ATTR[kind]);
        if (!slug) continue;
        add(kind, slug);
      }
      const checkoutSlug = el.getAttribute(CHECKOUT_ATTR);
      if (checkoutSlug) add('destination', checkoutSlug);
    };
    if (root instanceof Element) consider(root);
    const selector = [
      ...RESOURCE_KINDS.map(k => `[${RESOURCE_ATTR[k]}]`),
      `[${CHECKOUT_ATTR}]`,
    ].join(',');
    // Note: querySelectorAll skips <template> content — good, those are loop bodies.
    for (const el of Array.from(root.querySelectorAll<Element>(selector))) {
      consider(el);
    }
    return out;
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/bindings.spec.ts
  ```

  All `collectResources` tests pass, including the two pre-existing ones.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/bindings.ts packages/sdk/test/bindings.spec.ts && git commit -m "fix(sdk): collect data-gh-checkout slugs as destination resources

  Checkout slugs were invisible to collectResources, so bind() never awaited
  their destination fetch: bindOne set href='#', fired ensureDestination
  fire-and-forget, and gh:bindings-ready fired with the link still at '#'.
  They now pre-warm in the first bind pass like any other resource, deduped
  against data-gh-destination on the same slug."
  ```

---

### Task 31: Rebind checkout links on destination load and attribute change (Correction 4b)

**Files:**
- Test: `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/runtime.spec.ts` (new import at line 1–6; append a new `describe` at the end)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts` (`attachObserver` filter, lines 119–128; `loadOne`, lines 171–186)

**Interfaces:**
- Consumes: `ensureSession(config, client): Promise<SessionState>`, `_resetForTests(): void`, `composeCheckoutUrl` via `applyCheckoutBindings`
- Produces: no new exported surface — `GhRuntime.ensureDestination` now schedules a rebind on success, and the observer watches `data-gh-checkout` and `data-gh-step`

- [ ] **Step 1: Write the failing tests**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/test/runtime.spec.ts`, add this import after the existing imports at the top:

  ```ts
  import { ensureSession, _resetForTests } from '../src/session';
  ```

  Then append this `describe` at the end of the file:

  ```ts
  describe('GhRuntime — checkout link rebinding (Cluster G Correction 4)', () => {
    const CHECKOUT_CONFIG: GhConfig = { ...CONFIG, checkoutBase: 'https://checkout.gundrymd.com' };

    const DESTINATION = {
      id: 'a0D0m000002Dst1EAC',
      slug: 'bio3-3p-sub',
      name: 'Bio Complete 3 — 3-pack subscription',
      description: null,
      funnelSlug: 'bio-complete-3-main',
      funnelId: 'a0F0m000002Fnl1EAC',
      url: null,
      pricing: {
        familyOrBundleId: 'fam1',
        orderFormId: 'OF_123',
        sku: 'BIO3-3P-SUB',
        packageQuantity: 3,
        purchaseType: 'subscription',
        frequency: null,
        price: { amount: 49.95, currency: 'USD', savings: null },
        rebillPrice: { amount: 49.95, currency: 'USD', savings: null },
        outOfStock: false,
        restrictedCountryCodes: [],
        shipping: { domestic: 0, international: 0, freeShippingThreshold: null },
        bumpOffers: [],
        checkoutOverrideUrl: null,
      },
    };

    const OTHER_DESTINATION = {
      ...DESTINATION,
      id: 'a0D0m000002Dst2EAC',
      slug: 'bio3-6p-sub',
      pricing: { ...DESTINATION.pricing, orderFormId: 'OF_OTHER', sku: 'BIO3-6P-SUB' },
    };

    function mockDestinationFetch(): void {
      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = String(input);
        const body = url.endsWith('/destination/bio3-6p-sub') ? OTHER_DESTINATION : DESTINATION;
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      });
    }

    beforeEach(async () => {
      document.body.innerHTML = '';
      vi.restoreAllMocks();
      _resetForTests();

      // Manual cookie jar: jsdom drops writes carrying a Domain attribute.
      const jar: Record<string, string> = {};
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get() {
          return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        },
        set(cookieStr: string) {
          const parts = cookieStr.split(';');
          const [nameValue] = parts;
          const [name, value] = (nameValue ?? '').split('=');
          const trimmedName = (name ?? '').trim();
          if (parts.some((p) => p.trim().startsWith('Max-Age=0'))) delete jar[trimmedName];
          else jar[trimmedName] = value ?? '';
        },
      });

      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          href: 'https://info.gundrymd.com/lp?sessionid=sess-42',
          search: '?sessionid=sess-42',
          hostname: 'info.gundrymd.com',
          protocol: 'https:',
        },
        writable: true,
      });
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });

      // Resolve a real session: checkout bindings leave href="#" while the
      // session is unresolved, so these tests need one settled first.
      const sessionClient = freshClient();
      sessionClient.postJson = vi.fn().mockResolvedValue({}) as never;
      await ensureSession(CHECKOUT_CONFIG, sessionClient);
    });

    it('rebinds a checkout link when its destination loads out of band', async () => {
      mockDestinationFetch();
      document.body.innerHTML = `<a id="buy" data-gh-checkout="bio3-3p-sub" href="#">Buy</a>`;
      const runtime = new GhRuntime({
        logger: createLogger(false), client: freshClient(), config: CHECKOUT_CONFIG,
      });

      // The fire-and-forget path: gh.checkoutUrl(slug) and bindOne on a cold
      // page both warm a destination with no bind pass wrapped around them.
      await runtime.ensureDestination('bio3-3p-sub');
      await new Promise((r) => setTimeout(r, 20));

      const href = document.getElementById('buy')!.getAttribute('href')!;
      expect(href).not.toBe('#');
      expect(href).toContain('order_form_id=OF_123');
      expect(href).toContain('sessionid=sess-42');
    });

    it('rebinds when data-gh-checkout changes to a different slug', async () => {
      mockDestinationFetch();
      document.body.innerHTML = `<a id="buy" data-gh-checkout="bio3-3p-sub" href="#">Buy</a>`;
      const runtime = new GhRuntime({
        logger: createLogger(false), client: freshClient(), config: CHECKOUT_CONFIG,
      });
      await runtime.bind(document);
      expect(document.getElementById('buy')!.getAttribute('href')).toContain('order_form_id=OF_123');

      runtime.attachObserver();
      document.getElementById('buy')!.setAttribute('data-gh-checkout', 'bio3-6p-sub');
      await new Promise((r) => setTimeout(r, 20));

      expect(document.getElementById('buy')!.getAttribute('href')).toContain('order_form_id=OF_OTHER');
      runtime.detachObserver();
    });

    it('rebinds when data-gh-step changes', async () => {
      mockDestinationFetch();
      document.body.innerHTML = `<div id="step" data-gh-step="vsl"></div>`;
      const runtime = new GhRuntime({
        logger: createLogger(false), client: freshClient(), config: CHECKOUT_CONFIG,
      });
      await runtime.bind(document);
      runtime.attachObserver();
      const bindSpy = vi.spyOn(runtime, 'bind');

      document.getElementById('step')!.setAttribute('data-gh-step', 'order-form');
      await new Promise((r) => setTimeout(r, 20));

      expect(bindSpy).toHaveBeenCalled();
      runtime.detachObserver();
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/runtime.spec.ts
  ```

  Expect three failures: `expected '#' not to be '#'` (no rebind after an out-of-band load), `expected '…order_form_id=OF_123…' to contain 'order_form_id=OF_OTHER'` (`data-gh-checkout` is not in the observer's `attributeFilter`), and `expected "bind" to be called at least once` (`data-gh-step` is not in the filter either).

- [ ] **Step 3: Add both attributes to the observer filter**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts`, replace the filter array in `attachObserver` (lines 119–128):

  ```ts
      const filter = [
        ...RESOURCE_KINDS.map(k => RESOURCE_ATTR[k]),
        'data-field',
        'data-format',
        'data-if',
        'data-if-not',
        'data-each',
        'data-with',
        'data-when',
      ];
  ```

  with:

  ```ts
      const filter = [
        ...RESOURCE_KINDS.map(k => RESOURCE_ATTR[k]),
        // Cluster G: swapping a checkout slug must re-point the link, and an
        // SPA that swaps data-gh-step is announcing a new step — both have to
        // reach bind() through the observer.
        'data-gh-checkout',
        'data-gh-step',
        'data-field',
        'data-format',
        'data-if',
        'data-if-not',
        'data-each',
        'data-with',
        'data-when',
      ];
  ```

- [ ] **Step 4: Schedule a rebind on a successful load**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/src/runtime.ts`, replace these three lines inside `loadOne`'s `try` block (lines 173–175):

  ```ts
          const data = await this.opts.client[kind](slug);
          this.resources.set(key, data);
          this.resourceStates.set(key, 'loaded');
  ```

  with:

  ```ts
          const data = await this.opts.client[kind](slug);
          this.resources.set(key, data);
          this.resourceStates.set(key, 'loaded');
          // A load can complete outside a bind pass — bindOne's fire-and-forget
          // ensureDestination, or gh.checkoutUrl warming a slug. Without this,
          // nothing repaints and a checkout link sits at href="#" for the life
          // of the page. Cannot loop: bind() is idempotent and a cached
          // resource short-circuits loadOne before reaching here.
          this.scheduleRebind();
  ```

- [ ] **Step 5: Run the tests to verify they pass**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/runtime.spec.ts test/bindings.spec.ts test/index.spec.ts test/session-ready-ordering.spec.ts
  ```

  Expect all four files green, including the pre-existing `fires gh:bindings-ready exactly once` test — the extra rebind must not re-fire that event.

- [ ] **Step 6: Typecheck the SDK source**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm --filter @goldenhippo/hippo-shop-sdk typecheck
  ```

- [ ] **Step 7: Commit**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git add packages/sdk/src/runtime.ts packages/sdk/test/runtime.spec.ts && git commit -m "fix(sdk): rebind checkout links on destination load and attribute change

  Nothing re-bound after a destination resolved out of band, and neither
  data-gh-checkout nor data-gh-step was in the MutationObserver's
  attributeFilter — so a checkout link stranded at href='#' stayed there and
  an SPA step swap went unnoticed. loadOne now schedules a rebind on success
  and both attributes are observed."
  ```

---

### Task 32: Changesets — both packages cut as v4

**Files:**
- Delete: `/Users/stevenhall/Code/hippo-shop/.changeset/cluster-f-sdk-session-handoff.md`
- Delete: `/Users/stevenhall/Code/hippo-shop/.changeset/cluster-f-types-checkout-override.md`
- Create: `/Users/stevenhall/Code/hippo-shop/.changeset/cluster-g-types-destination-identity.md`
- Create: `/Users/stevenhall/Code/hippo-shop/.changeset/cluster-g-sdk-superfunnel-pilot.md`

**Interfaces:**
- Consumes: nothing
- Produces: `@goldenhippo/hippo-shop-types@4.0.0` and `@goldenhippo/hippo-shop-sdk@4.0.0` on the next `changeset version`

- [ ] **Step 1: Confirm the current (wrong) release shape**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm changeset status --verbose
  ```

  Expect both packages listed under **minor** at `3.1.0`, sourced from the two Cluster F changesets. Cluster F never shipped and Cluster G corrects it, so those notes would publish a changelog describing behaviour (`subId1='fb'`, `session_id`, the `sessionId` cookie) that no released version ever had.

- [ ] **Step 2: Remove the superseded Cluster F changesets**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git rm .changeset/cluster-f-sdk-session-handoff.md .changeset/cluster-f-types-checkout-override.md
  ```

- [ ] **Step 3: Write the types changeset**

  Create `/Users/stevenhall/Code/hippo-shop/.changeset/cluster-g-types-destination-identity.md`:

  ```md
  ---
  "@goldenhippo/hippo-shop-types": major
  ---

  Cluster G (v4): destination identity and absolute URL.

  **Breaking.** Three required fields on `HippoShopDestinationDTO`, one on
  `HippoShopFunnelStepDTO`:

  - `HippoShopDestinationDTO.id: string` — Salesforce ID of the destination.
  - `HippoShopDestinationDTO.funnelId: string` — Salesforce ID of the funnel it
    resolves to (the resolved `defaultFunnel`).
  - `HippoShopDestinationDTO.url: string | null` — absolute landing URL for the
    destination. `null` when Salesforce has none, in which case callers fall
    back to their own configured checkout base.
  - `HippoShopFunnelStepDTO.id: string` — Salesforce ID of the step.

  Producers must supply all four. Consumers gain the identity a funnel-event
  payload requires (`funnelSTFId`, `mainFunnelId`, `destinationId`,
  `funnelSTPId`) from a destination fetch they were already making — the
  upstream Salesforce record carried every one of these and the serializer
  discarded them.

  Also corrects the `HippoShopDestinationDTO` docblock, which claimed
  "Pre-Purchase only". The public API serves **Post-Purchase** destinations and
  Pre-Purchase funnels; the docblock had been pasted from `funnel.ts`.

  Supersedes the unreleased Cluster F changeset for this package.
  ```

- [ ] **Step 4: Write the SDK changeset**

  Create `/Users/stevenhall/Code/hippo-shop/.changeset/cluster-g-sdk-superfunnel-pilot.md`:

  ```md
  ---
  "@goldenhippo/hippo-shop-sdk": major
  ---

  Cluster G (v4): Superfunnel.ai pilot — session handoff, funnel events, and
  destination links. A clean cut rather than a compatibility-preserving
  migration: there are no production consumers of the 3.x line, and several of
  its attribution behaviours were wrong.

  **Breaking**

  - `window.gh.checkoutUrl(slug)` is async: it returns `Promise<string>`, awaits
    session resolution, and fetches the destination if needed, so it can no
    longer hand back an unattributed URL. `window.open(await gh.checkoutUrl(x))`
    inside a click handler breaks the user-gesture chain and will be
    popup-blocked — assign `window.location.href` instead.
  - Outbound links emit `sessionid` (was `session_id`) and `subid1`…`subid5`
    (was `sub_id1`…`sub_id5`), plus `landing_url`, `referral_url`,
    `sales_funnel`, the seven raw click-ids, and `origdsidOrig` /
    `origsplitTestingFunnelIdOrig` forwarded from the current URL. A
    `?session_id=` handoff was silently ignored downstream, which showed up as
    duplicate sessions and orphaned attribution.
  - The session cookie is `hippo_session_id` (was `sessionId`) and its value is
    a UUID v4 (was a 12-character numeric string).
  - `?sessionid=` on the landing URL is validated and adopted over any existing
    cookie value.
  - The session POST body carries `affParameters.sessionId`, so the SDK's
    identifier and the server's `hippoSessionId` are the same value.
  - `connect.sid` is never read or reasoned about again — it is `httpOnly` and
    the gate that read it was dead code. `gh:session-ready` detail is
    `{ sessionId, adopted, params }`: `hasConnectSid` is gone and `params` is
    never `null`.
  - Click-id mapping is the canonical seven-row table (`fbclid`, `gclid`,
    `ScCid`, `qclid`, `twclid`, `ndclid`, `wbraid`) with correct slot semantics.
    3.x wrote `subId1='fb'` and the click value into `subId5` — the two slots
    reversed, and a literal no platform ever emits. Values are no longer
    truncated at 255 characters.
  - Requires `@goldenhippo/hippo-shop-types@4.x`.
  - New major means a new CDN line: `/sdk/v4/gh.js`.

  **New**

  - `Page View` funnel events (the 36-field payload) posted to
    `/public/v1/funnel-event`, gated on a resolvable funnel id, deduped in
    memory per page load, sent with `keepalive: true`.
  - `data-gh-step` and `data-gh-funnel-id` attributes;
    `window.gh.track('Page View')` as the programmatic escape hatch.
  - `data-gh-checkout` resolves through `destination.url`, so binding an offer
    navigates the visitor to that destination with attribution attached.

  **Fixed — latent defects in the unreleased 3.x line**

  - `gh.checkoutUrl` is one stable function identity that reads the session
    through a thunk. It used to be installed as a stub with an empty session and
    then *reassigned*, so a captured reference (a GTM variable, a React prop,
    `const f = gh.checkoutUrl`) composed URLs with no `sessionid` and no UTMs
    for the life of the page — with no error anywhere.
  - The `gh:session-ready` rebind listener is registered before `ensureSession`
    is invoked, so a synchronously-resolved session still triggers a rebind.
  - `data-gh-checkout` slugs are collected as destination resources, both
    `data-gh-checkout` and `data-gh-step` are in the MutationObserver's
    `attributeFilter`, and a completed destination load schedules a rebind —
    checkout links no longer strand at `href="#"`.
  - `SPEC.md` named `/session` where the client posts `/public/v1/session`.

  See `docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md`
  for the full design. Supersedes the unreleased Cluster F changeset for this
  package.
  ```

- [ ] **Step 5: Verify the release shape**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm changeset status --verbose
  ```

  Expect:

  ```
  🦋  info Packages to be bumped at major
  🦋  - @goldenhippo/hippo-shop-sdk 4.0.0
  🦋    - .changeset/cluster-g-sdk-superfunnel-pilot.md
  🦋  - @goldenhippo/hippo-shop-types 4.0.0
  🦋    - .changeset/cluster-g-types-destination-identity.md
  ```

  and no packages listed under minor or patch.

- [ ] **Step 6: Commit**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git add .changeset && git commit -m "chore: changesets — Cluster G ships types and sdk as v4

  Both packages go major. The two Cluster F changesets are removed rather than
  kept alongside: F never released, and its notes describe behaviour Cluster G
  corrects (subId1='fb', session_id, the sessionId cookie), which would have
  published a changelog for a version that never existed."
  ```

---

### Task 33: Public session route on `HippoShopController`

Covers Workstream 2 item 1. Adds `POST /hippo-shop/v1/session` to the already-public, brand-scoped `HippoShopController` and delegates to the existing `SessionService.getSession`. The authenticated `SessionController` is left untouched.

**Files:**
- Create (worktree): `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g` — a `git worktree` off `prerelease`. **Every absolute path in Tasks 33–39 is rooted here.** A worktree rather than a checkout because the main clone has another branch checked out.
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/controllers/hippo-shop/HippoShop.controller.ts` (imports lines 1–8; `routes()` array lines 20–38; new handler appended after `getPublicDestination`, which ends at line 99)
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/controllers/hippo-shop/HippoShop.spec.ts` (imports lines 1–21; `paths` object lines 421–500)
- Test: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/components/HippoShopController.session.test.ts` (new)

**Interfaces:**
- Consumes: `SessionService.getSession(req: Request, res: Response): Promise<Partial<AffParams> & { sessionId?: string; visitorId?: string }>` (default-exported singleton from `@services/session/Session.service`); `preRequestMiddleware.requireBrandName`; `BaseController.send(res, statusCode?, req?)`.
- Produces: route definition `{ path: '/v1/session', method: 'post', handler: [preRequestMiddleware.requireBrandName, this.publicSession.bind(this)] }` on `HippoShopController` (`basePath = 'hippo-shop'`, `disableAuth = true`) → the wire endpoint `POST /hippo-shop/v1/session`.

- [ ] **Step 1: Create the worktree and install dependencies**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service && \
  git worktree add /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g \
  -b feat/cluster-g-hippo-shop-session-destination-url prerelease
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && npm ci
cp /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service/.env \
   /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/.env 2>/dev/null || true
```

The `.env` copy is best-effort: `jest.config.ts` sets `setupFiles: ['dotenv/config']`, and every test below mocks `@utils/constants` or avoids it, so a missing `.env` does not fail these tests.

- [ ] **Step 2: Write the failing test**

Create `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/components/HippoShopController.session.test.ts`:

```ts
// The public session route must live on HippoShopController — already `disableAuth = true` and
// brand-scoped — and NOT on SessionController, whose `/session` route stays auth-protected.
import 'jest'
import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import type { CommerceBrand } from '@models/Brand.model'

const mockGetSession = jest.fn()

jest.mock('@services/session/Session.service', () => ({
  __esModule: true,
  default: { getSession: mockGetSession },
}))

// HippoShopService drags in Prisma/Redis through ProductService; the session route never uses it.
jest.mock('@services/hippo-shop/HippoShop.service', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    getProductByIdOrSlug: jest.fn(),
    getFunnelByIdOrSlug: jest.fn(),
    getDestinationByIdOrSlug: jest.fn(),
  })),
}))

// preRequest.middleware imports Brand.service (Prisma + Redis + Salesforce). Identity matters
// here, not behaviour: the assertion below checks the handler array wires this exact function.
jest.mock('@middleware/preRequest.middleware', () => ({
  __esModule: true,
  default: { requireBrandName: jest.fn() },
}))

jest.mock('@goldenhippo/gh-service-utils', () => ({
  ...jest.requireActual('@goldenhippo/gh-service-utils'),
  HippoLogger: jest.fn().mockImplementation(() => ({ note: jest.fn(), event: jest.fn(), log: jest.fn() })),
}))

import HippoShopController from '@controllers/hippo-shop/HippoShop.controller'
import SessionController from '@controllers/session/Session.controller'
import preRequestMiddleware from '@middleware/preRequest.middleware'

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void

const getSessionHandler = (): Handler => {
  const route = new HippoShopController()
    .routes()
    .find((r) => r.path === '/v1/session' && r.method === 'post')
  if (!route) throw new Error('POST /v1/session is not registered on HippoShopController')
  const handlers = route.handler as Handler[]
  return handlers[handlers.length - 1]
}

describe('HippoShopController — POST /v1/session', () => {
  let request: Partial<Request>
  let response: Partial<Response>
  let next: NextFunction

  beforeEach(() => {
    jest.clearAllMocks()
    request = { session: {} as Request['session'] }
    response = {
      locals: { brand: 'gundry-md', brandSetting: {} as CommerceBrand },
      status: jest.fn().mockImplementation(() => response),
      send: jest.fn(),
    }
    next = jest.fn()
  })

  it('registers the route on the public, brand-scoped controller', () => {
    const controller = new HippoShopController()
    expect(controller.basePath).toBe('hippo-shop')
    expect(controller.disableAuth).toBe(true)

    const route = controller.routes().find((r) => r.path === '/v1/session' && r.method === 'post')
    expect(route).toBeDefined()
    const handlers = route!.handler as Handler[]
    expect(Array.isArray(handlers)).toBe(true)
    expect(handlers[0]).toBe(preRequestMiddleware.requireBrandName)
  })

  it('leaves the authenticated SessionController auth-protected', () => {
    expect(new SessionController().disableAuth).toBe(false)
  })

  it('delegates to SessionService.getSession and sends the result', async () => {
    mockGetSession.mockResolvedValue({ utmSource: 'facebook', sessionId: 'abc', visitorId: 'v-1' })

    await getSessionHandler()(request as Request, response as Response, next)

    expect(mockGetSession).toHaveBeenCalledWith(request, response)
    expect(response.locals?.data).toEqual({ utmSource: 'facebook', sessionId: 'abc', visitorId: 'v-1' })
    expect(response.status).toHaveBeenCalledWith(StatusCodes.OK)
    expect(response.send).toHaveBeenCalledWith({ utmSource: 'facebook', sessionId: 'abc', visitorId: 'v-1' })
    expect(next).not.toHaveBeenCalled()
  })

  it('forwards a SessionService failure to next() instead of throwing', async () => {
    mockGetSession.mockRejectedValue(new Error('redis down'))

    await getSessionHandler()(request as Request, response as Response, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(Error)
    expect(response.send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/components/HippoShopController.session.test.ts
```

Expected: every test except the `SessionController` one fails with
`Error: POST /v1/session is not registered on HippoShopController`, and the registration test fails with `expect(received).toBeDefined() / Received: undefined`.

- [ ] **Step 4: Add the route and handler to the controller**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/controllers/hippo-shop/HippoShop.controller.ts`, add one import after the `CommerceBrand` import on line 8:

```ts
import SessionService from '@services/session/Session.service'
```

Then add this entry as the last element of the array returned by `routes()` (after the `/v1/destination/:destinationSlugOrId` object that closes on line 36, before the `]` on line 37):

```ts
      {
        path: '/v1/session',
        method: 'post',
        handler: [preRequestMiddleware.requireBrandName, this.publicSession.bind(this)],
      },
```

Then add this method immediately after `getPublicDestination` (which closes on line 99), before the class's closing brace:

```ts
  /**
   * Public session endpoint. The browser SDK POSTs
   * `{ affParameters: { ...attribution, sessionId } }`. The global middleware in `App.ts` lifts
   * `affParameters.sessionId` into `res.locals.sessionId` and then DELETES the body key, and the
   * gh-service-utils session middleware has already merged the attribution into
   * `req.session[brand]` — so by the time this handler runs everything it needs is on
   * `res.locals` and `req.session`, never on `req.body`.
   *
   * This route lives here rather than on SessionController because HippoShopController is already
   * `disableAuth = true` and brand-scoped. Flipping `SessionController.disableAuth` would expose
   * the authenticated internal route as collateral damage.
   */
  private async publicSession(req: Request, res: Response, next: NextFunction) {
    try {
      this.log.event({
        brand: res.locals.brand,
        action: 'publicSession',
        details: 'Public session request received',
        status: 'initiated',
      })
      const sessionAffParams = await SessionService.getSession(req, res)
      res.locals.data = { ...sessionAffParams }
      super.send(res)
    } catch (err) {
      this.log.event({
        brand: res.locals.brand,
        action: 'publicSession',
        details: `Error resolving public session. Error: ${(err as Error).message}`,
        level: 'error',
      })
      next(err)
    }
  }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/components/HippoShopController.session.test.ts
```

Expected: 4 passed.

- [ ] **Step 6: Document the route in the OpenAPI spec**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/controllers/hippo-shop/HippoShop.spec.ts`, add this import directly below the `RouteSpecDefinition` import (line 4):

```ts
import { ZAffParams } from '@goldenhippo/gh-service-utils'
```

Then add this entry as the last member of the `paths` object (after the `'/hippo-shop/v1/destination/{destinationSlugOrId}'` block, before the closing `}` of `paths`):

```ts
  '/hippo-shop/v1/session': {
    post: {
      tags: [tag],
      summary: 'Create or refresh the public session',
      operationId: 'postPublicSession',
      description:
        'Records attribution against the caller’s commerce session and echoes back what is stored. Send the browser-resolved session id inside `affParameters.sessionId`. Every key present in `affParameters` is treated as authoritative and overwrites the stored value, so omit blanks rather than sending empty strings.',
      requestParams: {
        header: zBrandHeader,
      },
      requestBody: {
        description: 'Attribution parameters plus the browser-resolved session id.',
        content: {
          'application/json': {
            schema: z.object({
              affParameters: ZAffParams.extend({
                sessionId: z.string().max(128).optional().openapi({
                  description:
                    'Session id resolved by the browser SDK. Must match `[A-Za-z0-9._-]{1,128}`; anything else is rejected with 400 `bad_request`.',
                  example: '3f1c8b2e-9a44-4f2a-9d33-8b1e7c6a5d90',
                }),
              })
                .openapi({ description: 'The session parameters.' })
                .optional(),
            }),
          },
        },
      },
      responses: {
        200: {
          description: 'The stored session parameters.',
          content: {
            'application/json': {
              schema: ZAffParams.extend({
                sessionId: z.string().optional(),
                visitorId: z.string().optional(),
              }).openapi({ description: 'The session parameters.' }),
            },
          },
        },
        ...publicSdkErrorResponses,
      },
    },
  },
```

- [ ] **Step 7: Typecheck and lint**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && npx tsc --noEmit && npm run lint
```

Expected: no output from `tsc`, and eslint reports no errors.

If running `npm run dev` at any point regenerates `src/api-spec.yaml` / `src/api-spec.json` (`src/docs.ts` writes both on boot), include them in the commit below; otherwise leave them alone.

- [ ] **Step 8: Commit**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
git add src/controllers/hippo-shop/HippoShop.controller.ts \
        src/controllers/hippo-shop/HippoShop.spec.ts \
        src/tests/unit-tests/components/HippoShopController.session.test.ts && \
git commit -m "feat(hippo-shop): add public POST /hippo-shop/v1/session route

Delegates to the existing SessionService.getSession from HippoShopController,
which is already disableAuth=true and brand-scoped. SessionController stays
auth-protected."
```

---

### Task 34: Validate the client-supplied session id

Covers Workstream 2 item 2. No format validation exists anywhere in the service or in `gh-service-utils` today; this handler is the only place on the public path where it can go.

**Files:**
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/controllers/hippo-shop/HippoShop.controller.ts` (module-level constant after the imports; guard at the top of `publicSession`'s `try`)
- Test: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/components/HippoShopController.session.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `res.locals.sessionId: unknown` (set by the global middleware in `App.ts` from `req.body.affParameters.sessionId`); `ApiError(msg: string, statusCode: StatusCodes, name?: string, fields?: Record<string,string>)`.
- Produces: `SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/` (module-private); a `400` `ApiError('Invalid session id', StatusCodes.BAD_REQUEST, 'BAD_REQUEST')` passed to `next()`, which `errorHandler.middleware` renders as `{ code: 'bad_request', message: 'Invalid session id' }` because `req.path` starts with `/hippo-shop/`.

- [ ] **Step 1: Write the failing test**

Append this `describe` block to the end of `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/components/HippoShopController.session.test.ts` (after the existing `describe('HippoShopController — POST /v1/session', …)` block closes):

```ts
describe('HippoShopController — POST /v1/session session-id validation', () => {
  let request: Partial<Request>
  let response: Partial<Response>
  let next: NextFunction

  const run = async (sessionId: unknown) => {
    response = {
      locals: { brand: 'gundry-md', brandSetting: {} as CommerceBrand, sessionId },
      status: jest.fn().mockImplementation(() => response),
      send: jest.fn(),
    }
    await getSessionHandler()(request as Request, response as Response, next)
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSession.mockResolvedValue({ utmSource: 'facebook' })
    request = { session: {} as Request['session'] }
    next = jest.fn()
  })

  it.each([
    ['cookie separator', 'abc;def'],
    ['equals sign', 'abc=def'],
    ['comma', 'abc,def'],
    ['whitespace', 'abc def'],
    ['empty string', ''],
    ['129 characters', 'a'.repeat(129)],
    ['non-string', 12345],
  ])('rejects %s with 400 BAD_REQUEST and never reaches the service', async (_label, badId) => {
    await run(badId)

    expect(mockGetSession).not.toHaveBeenCalled()
    expect(response.send).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
    const err = (next as jest.Mock).mock.calls[0][0]
    expect(err.status).toBe(StatusCodes.BAD_REQUEST)
    expect(err.name).toBe('BAD_REQUEST')
    expect(err.message).toBe('Invalid session id')
  })

  it.each([
    ['a UUID v4', '3f1c8b2e-9a44-4f2a-9d33-8b1e7c6a5d90'],
    ['a legacy 12-digit numeric id', '481920374615'],
    ['a legacy 26-digit numeric id', '17654968312045876120394855'],
    ['dots and underscores', 'sf.pilot_id-01'],
    ['exactly 128 characters', 'a'.repeat(128)],
  ])('accepts %s', async (_label, goodId) => {
    await run(goodId)

    expect(next).not.toHaveBeenCalled()
    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(response.status).toHaveBeenCalledWith(StatusCodes.OK)
  })

  it('accepts a request that supplies no session id at all', async () => {
    await run(undefined)

    expect(next).not.toHaveBeenCalled()
    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/components/HippoShopController.session.test.ts
```

Expected: the 7 rejection cases fail with `expect(jest.fn()).not.toHaveBeenCalled()` on `mockGetSession` — every malformed id currently reaches the service.

- [ ] **Step 3: Add the guard**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/controllers/hippo-shop/HippoShop.controller.ts`, add these two imports below the existing `SessionService` import:

```ts
import ApiError from '@abstractions/ApiError'
import { StatusCodes } from 'http-status-codes'
```

Add this constant between the import block and `class HippoShopController extends BaseController {`:

```ts
// The browser supplies this inside `affParameters.sessionId`; `App.ts` lifts it to
// `res.locals.sessionId`. From there it becomes an express-session key and is interpolated into
// the AlternActivate JSONP URL, and nothing in this service or in gh-service-utils validates it —
// this guard is the only one on the path. The charset matches the SDK's SESSION_ID_PATTERN and the
// funnel app's, and deliberately excludes `;`, `=`, `,` and whitespace because the funnel writes
// the value into `document.cookie` unencoded. 128 characters accommodates a UUID and both legacy
// numeric formats still in circulation.
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
```

Then replace the first statement inside `publicSession`'s `try` block so it reads:

```ts
    try {
      const providedSessionId: unknown = res.locals.sessionId
      if (
        providedSessionId !== undefined &&
        (typeof providedSessionId !== 'string' || !SESSION_ID_PATTERN.test(providedSessionId))
      ) {
        throw new ApiError('Invalid session id', StatusCodes.BAD_REQUEST, 'BAD_REQUEST')
      }
      this.log.event({
        brand: res.locals.brand,
        action: 'publicSession',
        details: 'Public session request received',
        status: 'initiated',
      })
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/components/HippoShopController.session.test.ts && \
  npx tsc --noEmit && npm run lint
```

Expected: 17 passed, clean `tsc`, clean lint.

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
git add src/controllers/hippo-shop/HippoShop.controller.ts \
        src/tests/unit-tests/components/HippoShopController.session.test.ts && \
git commit -m "feat(hippo-shop): validate the client-supplied session id

The value reaches an express-session key and an outbound JSONP URL with no
format check anywhere on the path. Reject anything outside
[A-Za-z0-9._-]{1,128} with 400 BAD_REQUEST before the service sees it."
```

---

### Task 35: Stop logging client-supplied ids and full attribution

Covers Workstream 2 item 8. Must land before this surface goes public.

**Files:**
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/controllers/session/Session.controller.ts` (line 48)
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/session/Session.service.ts` (lines 37 and 62–65)
- Test: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/components/SessionController.test.ts` (new)
- Test: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/session/Session.service.test.ts` (new)

**Interfaces:**
- Consumes: `SessionService.getSession(req, res)`; `getSessionAffParams(req, res)` from `@goldenhippo/gh-service-utils`; `envServerSchema.FUNNEL_CMS_URL`.
- Produces: no signature change. `console.log` of the session id and of the attribution payload is removed; the AlternActivate failure path logs via `console.error` with no identifiers.

- [ ] **Step 1: Write the failing controller test**

Create `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/components/SessionController.test.ts`:

```ts
// `affParameters` carries the visitor's full attribution — click ids, landing url, sub-ids.
// Cluster G opens a public route onto the same service, so none of it may reach stdout.
import 'jest'
import { NextFunction, Request, Response } from 'express'
import type { CommerceBrand } from '@models/Brand.model'

const mockGetSession = jest.fn()

jest.mock('@services/session/Session.service', () => ({
  __esModule: true,
  default: { getSession: mockGetSession },
}))

jest.mock('@middleware/preRequest.middleware', () => ({
  __esModule: true,
  default: { requireBrandName: jest.fn() },
}))

jest.mock('@goldenhippo/gh-service-utils', () => ({
  ...jest.requireActual('@goldenhippo/gh-service-utils'),
  HippoLogger: jest.fn().mockImplementation(() => ({ note: jest.fn(), event: jest.fn(), log: jest.fn() })),
}))

import SessionController from '@controllers/session/Session.controller'

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void

describe('SessionController logging', () => {
  it('never writes the attribution payload to stdout', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    mockGetSession.mockResolvedValue({
      utmSource: 'facebook',
      subId1: 'IwAR2clickidvalue',
      sessionId: '3f1c8b2e-9a44-4f2a-9d33-8b1e7c6a5d90',
    })

    const route = new SessionController().routes().find((r) => r.method === 'post')!
    const handlers = route.handler as Handler[]
    const response: Partial<Response> = {
      locals: { brand: 'gundry-md', brandSetting: {} as CommerceBrand },
      status: jest.fn().mockImplementation(() => response),
      send: jest.fn(),
    }

    await handlers[handlers.length - 1](
      { session: {} as Request['session'] } as Request,
      response as Response,
      jest.fn(),
    )

    expect(logSpy).not.toHaveBeenCalled()
    expect(response.locals?.data).toEqual({
      utmSource: 'facebook',
      subId1: 'IwAR2clickidvalue',
      sessionId: '3f1c8b2e-9a44-4f2a-9d33-8b1e7c6a5d90',
    })
    logSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Write the failing service test**

Create `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/session/Session.service.test.ts`:

```ts
import 'jest'
import type { Request, Response } from 'express'

jest.mock('@goldenhippo/gh-service-utils', () => ({
  getSessionAffParams: jest.fn(() => ({ utmSource: 'facebook' })),
}))

jest.mock('@utils/constants', () => ({
  __esModule: true,
  envServerSchema: { FUNNEL_CMS_URL: 'https://funnel.test' },
}))

import SessionService from '@services/session/Session.service'

const BRAND = 'gundry-md'
const PROVIDED_ID = '3f1c8b2e-9a44-4f2a-9d33-8b1e7c6a5d90'

const makeReq = (brandSession: Record<string, unknown> = {}) =>
  ({
    session: { [BRAND]: brandSession },
    sessionID: 'express-sid-1',
  }) as unknown as Request

const makeRes = (sessionId?: string) =>
  ({ locals: sessionId === undefined ? { brand: BRAND } : { brand: BRAND, sessionId } }) as unknown as Response

const jsonp = (visitorStream: unknown[]) =>
  `alternAiCallback(${JSON.stringify({ visitorStream })});`

describe('SessionService logging', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  it('never writes the client-supplied session id to stdout on the happy path', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => jsonp([{ visitor_id: 'v-1' }]),
    })

    await SessionService.getSession(makeReq(), makeRes(PROVIDED_ID))

    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('logs an AlternActivate failure without the session id and without throwing', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('socket hang up'))

    await expect(SessionService.getSession(makeReq(), makeRes(PROVIDED_ID))).resolves.toBeDefined()

    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const printed = JSON.stringify(errorSpy.mock.calls[0])
    expect(printed).not.toContain(PROVIDED_ID)
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/components/SessionController.test.ts \
           src/tests/unit-tests/services/session/Session.service.test.ts
```

Expected: `expect(spy).not.toHaveBeenCalled()` fails in all three tests — the controller prints `SESSION AFF PARAMS …`, and the service prints `Provided session ID: 3f1c8b2e-…`. The failure-path test additionally reports `TypeError: Cannot read properties of undefined (reading 'hippoSessionId')` from the `catch` block, because `req.session[brand]` was never written before `getVisitorId` rejected.

- [ ] **Step 4: Remove the controller log**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/controllers/session/Session.controller.ts`, delete line 48 entirely:

```ts
      console.log('SESSION AFF PARAMS', sessionAffParams)
```

- [ ] **Step 5: Remove the service logs**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/session/Session.service.ts`, delete line 37 entirely:

```ts
        console.log(`Provided session ID: ${providedSessionId}, Session ID from session: ${sessionIdFromSession}`)
```

Then replace the `catch` block on lines 62–65:

```ts
    } catch (e) {
      // Return the session with whatever we have.
      console.log(`Error fetching visitor ID from AlternActivate for session ${req.session[brand].hippoSessionId}:`, e)
    }
```

with:

```ts
    } catch (e) {
      // Visitor id is best-effort — return the session with whatever we have. Deliberately logged
      // without the session id: this service now backs a public route, and the old message also
      // dereferenced `req.session[brand]`, which is undefined on the very path that throws.
      console.error('Error fetching visitor ID from AlternActivate', e)
    }
```

- [ ] **Step 6: Run both tests to verify they pass**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/components/SessionController.test.ts \
           src/tests/unit-tests/services/session/Session.service.test.ts && \
  npx tsc --noEmit && npm run lint
```

Expected: 3 passed, clean `tsc`, clean lint.

- [ ] **Step 7: Commit**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
git add src/controllers/session/Session.controller.ts \
        src/services/session/Session.service.ts \
        src/tests/unit-tests/components/SessionController.test.ts \
        src/tests/unit-tests/services/session/Session.service.test.ts && \
git commit -m "fix(session): stop logging client-supplied ids and attribution

Removes the SESSION AFF PARAMS dump and the provided-session-id log before the
service backs a public route. The AlternActivate catch also dereferenced
req.session[brand], which is undefined on the path that throws."
```

---

### Task 36: Return the fallback session id under `sessionId`, not `session`

Covers Workstream 2 item 6. `Session.service.ts:68` emits key `session` where the two happy paths and the OpenAPI response schema both use `sessionId`.

Evidence for the "check `hippo-builder-funnel` consumption first" caveat, already gathered: the funnel app deserialises this response into `HippoSession` (`hippo-builder-funnel/src/app/core/services/hippo-api/models/session.model.ts`), which declares **neither** `session` nor `sessionId` — it reads only the attribution keys and `visitorId`. No consumer breaks.

**Files:**
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/session/Session.service.ts` (line 68)
- Test: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/session/Session.service.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `req.session[brand].hippoSessionId`, `req.sessionID`.
- Produces: the fallback return becomes `{ ...session, sessionId: sessionIdFromSession, visitorId: currentVisitorId }` — same key as the two early returns above it.

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/session/Session.service.test.ts`:

```ts
describe('SessionService response shape', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  it('returns the stored id under `sessionId` when no id was provided', async () => {
    const result = await SessionService.getSession(makeReq({ hippoSessionId: 'stored-id' }), makeRes())

    expect(result).toEqual({ utmSource: 'facebook', sessionId: 'stored-id', visitorId: 'express-sid-1' })
    expect('session' in result).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('uses the same key on the fallback path as on the happy path', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => jsonp([{ visitor_id: 'v-1' }]),
    })

    const happy = await SessionService.getSession(makeReq(), makeRes(PROVIDED_ID))
    const fallback = await SessionService.getSession(makeReq({ hippoSessionId: 'stored-id' }), makeRes())

    expect(Object.keys(happy).sort()).toEqual(Object.keys(fallback).sort())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/services/session/Session.service.test.ts
```

Expected: the first test fails with an object diff showing `- sessionId: "stored-id"` against `+ session: "stored-id"`, and `expect('session' in result).toBe(false)` fails with `Received: true`. The second fails on `["session", …]` vs `["sessionId", …]`.

- [ ] **Step 3: Rename the key**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/session/Session.service.ts`, change line 68 from:

```ts
      session: sessionIdFromSession,
```

to:

```ts
      // `sessionId`, matching both early returns above and the OpenAPI response schema. The old
      // `session` key was consumed by nothing — hippo-builder-funnel's HippoSession model declares
      // neither key and reads only the attribution fields plus `visitorId`.
      sessionId: sessionIdFromSession,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/services/session/Session.service.test.ts && \
  npx tsc --noEmit && npm run lint
```

Expected: 4 passed, clean `tsc`, clean lint.

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
git add src/services/session/Session.service.ts \
        src/tests/unit-tests/services/session/Session.service.test.ts && \
git commit -m "fix(session): return the fallback id under sessionId, not session

The two happy paths and the OpenAPI response both use sessionId. Verified no
consumer reads the old key: hippo-builder-funnel's HippoSession declares
neither."
```

---

### Task 37: Cache the negative visitor lookup

Covers Workstream 2 item 7. `Session.service.ts:38` short-circuits only when the provided id matches **and** `visitorIdFromSession` is truthy, so when AlternActivate has nothing the `getVisitorId` JSONP fetch re-fires on every POST — one wasted outbound call per page view for a value no caller consumes. Pre-existing, but Cluster G formalises always-POST, which turns it from occasional into per-page-load.

**Files:**
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/session/Session.service.ts` (whole `getSession` method, lines 29–71)
- Test: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/session/Session.service.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `req.session[brand].hippoSessionId`, `req.session[brand].hippoVisitorId`, `res.locals.sessionId`.
- Produces: new express-session key `req.session[brand].hippoVisitorLookupMissFor: string` — the session id AlternActivate had no visitor for. `SessionData extends Record<string, any>` in `gh-service-utils`, so no type augmentation is needed. No change to the returned shape.

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/session/Session.service.test.ts`:

```ts
describe('SessionService visitor lookup caching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  it('re-uses a cached visitor id without re-fetching', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => jsonp([{ visitor_id: 'v-1' }]),
    })
    const req = makeReq()

    const first = await SessionService.getSession(req, makeRes(PROVIDED_ID))
    const second = await SessionService.getSession(req, makeRes(PROVIDED_ID))

    expect(first).toEqual({ utmSource: 'facebook', sessionId: PROVIDED_ID, visitorId: 'v-1' })
    expect(second).toEqual({ utmSource: 'facebook', sessionId: PROVIDED_ID, visitorId: 'v-1' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not re-fire the JSONP fetch once AlternActivate has returned nothing for the id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => jsonp([]) })
    const req = makeReq()

    await SessionService.getSession(req, makeRes(PROVIDED_ID))
    const second = await SessionService.getSession(req, makeRes(PROVIDED_ID))
    const third = await SessionService.getSession(req, makeRes(PROVIDED_ID))

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(second).toEqual({ utmSource: 'facebook', sessionId: PROVIDED_ID, visitorId: 'express-sid-1' })
    expect(third).toEqual(second)
  })

  it('re-queries when a different session id arrives', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => jsonp([]) })
    const req = makeReq()

    await SessionService.getSession(req, makeRes(PROVIDED_ID))
    await SessionService.getSession(req, makeRes('a-different-id'))

    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/services/session/Session.service.test.ts
```

Expected: the negative-cache test fails with `Expected number of calls: 1 / Received number of calls: 3`. The other two pass already.

- [ ] **Step 3: Add the negative marker**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/session/Session.service.ts`, replace the entire `getSession` method with:

```ts
  public async getSession(req: Request, res: Response) {
    const brand = res.locals.brand
    const session = getSessionAffParams(req, res)
    const sessionIdFromSession = req.session[brand]?.hippoSessionId as string | undefined
    const visitorIdFromSession = req.session[brand]?.hippoVisitorId as string | undefined
    const visitorMissForSessionId = req.session[brand]?.hippoVisitorLookupMissFor as string | undefined
    const currentVisitorId = visitorIdFromSession || req.sessionID || ''
    try {
      if (res.locals.sessionId) {
        const providedSessionId = res.locals.sessionId as string
        if (providedSessionId === sessionIdFromSession && visitorIdFromSession) {
          return {
            ...session,
            sessionId: providedSessionId,
            visitorId: visitorIdFromSession,
          }
        }
        // AlternActivate already returned nothing for this id inside this express-session. Without
        // this guard the JSONP fetch re-fires on every POST — and Cluster G makes the SDK POST once
        // per page load — for a value no caller consumes. Cached negatively, not positively-only.
        if (providedSessionId === visitorMissForSessionId) {
          return {
            ...session,
            sessionId: providedSessionId,
            visitorId: currentVisitorId,
          }
        }
        req.session[brand] = {
          ...req.session[brand],
          hippoSessionId: providedSessionId,
        }
        const visitorIdFromAlternActivate = await this.getVisitorId(providedSessionId)
        if (visitorIdFromAlternActivate) {
          req.session[brand] = {
            ...req.session[brand],
            hippoVisitorId: visitorIdFromAlternActivate,
          }
          return {
            ...session,
            sessionId: providedSessionId,
            visitorId: visitorIdFromAlternActivate,
          }
        }
        req.session[brand] = {
          ...req.session[brand],
          hippoVisitorLookupMissFor: providedSessionId,
        }
      }
    } catch (e) {
      // Visitor id is best-effort — return the session with whatever we have. Deliberately logged
      // without the session id: this service now backs a public route, and the old message also
      // dereferenced `req.session[brand]`, which is undefined on the very path that throws.
      console.error('Error fetching visitor ID from AlternActivate', e)
    }
    return {
      ...session,
      // `sessionId`, matching both early returns above and the OpenAPI response schema. The old
      // `session` key was consumed by nothing — hippo-builder-funnel's HippoSession model declares
      // neither key and reads only the attribution fields plus `visitorId`.
      sessionId: sessionIdFromSession,
      visitorId: currentVisitorId,
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/services/session/Session.service.test.ts && \
  npx tsc --noEmit && npm run lint
```

Expected: 7 passed, clean `tsc`, clean lint.

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
git commit -am "perf(session): cache the negative AlternActivate visitor lookup

The early return required a truthy stored visitor id, so an empty
AlternActivate response re-fired the getVisitorId JSONP on every POST. Record
the miss against the session id and skip the refetch."
```

---

### Task 38: Bump the types pin to `^4.0.0`, mirror the schema, and pass destination identity through

Covers Workstream 2 items 5 **and** 4 in one commit. They cannot be separated: `HippoShop.spec.ts:503-519` asserts bidirectional `Equals<z.infer<typeof ZHippoShopDestinationDTO>, HippoShopDestinationDTO>`, and `HippoShopService`'s return types are the same DTOs — so the pin bump, the Zod mirrors, and the serializer must all move together or `tsc` fails.

The v4 delta over the installed `3.0.0` is five fields: `HippoShopDestinationDTO.id`, `.funnelId`, `.url`; `HippoShopPricingDTO.checkoutOverrideUrl` (carried over from the unmerged Cluster F); and `HippoShopFunnelStepDTO.id`.

Every value except `url` and `checkoutOverrideUrl` is already in the payload `DestinationService` fetches — `Destination.id`, `Destination.defaultFunnel.id`, `Destination.defaultFunnel.steps[].id` are all on `ZDestination` and `formatDestinationToDTO` / `formatFunnelToDTO` simply drop them.

**Precondition:** `@goldenhippo/hippo-shop-types@4.0.0` must be published (release ordering step 1) before this task runs. Verify with `npm view @goldenhippo/hippo-shop-types versions`.

**Files:**
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/package.json` (dependency `@goldenhippo/hippo-shop-types`) and `package-lock.json`
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/controllers/hippo-shop/HippoShop.spec.ts` (`ZHippoShopFunnelStepDTO` lines 43–59; `ZHippoShopPricingDTO` lines 188–231; `ZHippoShopDestinationDTO` lines 233–260)
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/hippo-shop/HippoShop.service.ts` (`formatFunnelToDTO` lines 204–224; `formatDestinationToDTO` lines 226–235; `buildPricing` return object lines 260–279)
- Test: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/hippo-shop/HippoShop.service.test.ts` (new)

**Interfaces:**
- Consumes: `Destination.id`, `Destination.defaultFunnel.id`, `Destination.defaultFunnel.steps[].id` (all present on `ZDestination` from `@goldenhippo/hippo-salesforce-service`).
- Produces: `HippoShopDestinationDTO` gains `id: string`, `funnelId: string`, `url: string | null`; `HippoShopPricingDTO` gains `checkoutOverrideUrl: string | null`; `HippoShopFunnelStepDTO` gains `id: string`. `url` is emitted as `null` here and wired to the real value in Task 39.

- [ ] **Step 1: Write the failing test**

Create `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/hippo-shop/HippoShop.service.test.ts`:

```ts
// The Salesforce ids the SDK needs for funnel events are already in the payload
// DestinationService fetches; the serializer was dropping them. Fixtures are cast rather than
// fully constructed — ZDestination is ~400 lines wide and only these fields are under test.
import 'jest'
import type { Destination, FunnelDetails } from '@goldenhippo/hippo-salesforce-service'
import type { CommerceBrand } from '@models/Brand.model'

const mockGetDestinationByGEP = jest.fn()
const mockGetDestinationById = jest.fn()
const mockGetFunnelByGEP = jest.fn()
const mockGetFunnelById = jest.fn()

jest.mock('@services/destination/Destination.service', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    getDestinationByGEP: mockGetDestinationByGEP,
    getDestinationById: mockGetDestinationById,
  })),
}))

jest.mock('@services/funnel/Funnel.service', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    getFunnelByGEP: mockGetFunnelByGEP,
    getFunnelById: mockGetFunnelById,
  })),
}))

jest.mock('@services/product/Product.service', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ getProduct: jest.fn() })),
}))

import HippoShopService from '@services/hippo-shop/HippoShop.service'

const brand = { id: 'a000m000005MJUmAAO', name: 'Gundry MD', accessToken: 'tok' } as unknown as CommerceBrand

const DESTINATION_ID = 'a0Xde0000001AAABCD'
const FUNNEL_ID = 'a0Ffu0000001AAABCD'
const STEP_ID = 'a0Sst0000001AAABCD'

const purchaseDetails = {
  funnelId: FUNNEL_ID,
  familyOrBundleId: 'a0f1a00000B1H2AAAV',
  orderFormId: 'a0o1a00000C1H2AAAV',
  productId: 'a0p1a00000D1H2AAAV',
  sku: 'BC3-3PK-SUB',
  quantity: 3,
  subscription: true,
  subscriptionFrequency: {
    count: 1,
    scale: 'month',
    publicCount: 30,
    publicScale: 'day',
    description: 'Every 30 Days',
  },
  purchasePrice: 119.85,
  listPrice: 149.85,
  postTrialSubscriptionPrice: null,
  subscriptionConversionPrice: null,
  outOfStock: false,
  restrictedCountryCodes: [],
  shipping: { domestic: 0, international: 14.95, freeShippingThreshold: 0 },
}

const destinationFixture = {
  id: DESTINATION_ID,
  type: 'Post-Purchase',
  slug: 'bio-complete-3-3-pack-sub',
  name: 'Bio Complete 3 — 3 Pack (Subscribe & Save)',
  description: null,
  defaultFunnel: {
    id: FUNNEL_ID,
    brandId: brand.id,
    name: 'BC3 Post-Purchase',
    active: true,
    slug: 'bc3-post-purchase',
    funnelType: 'Post-Purchase',
    steps: [
      {
        id: STEP_ID,
        stepNumber: 1,
        slug: 'upsell-1',
        pageType: 'Upsell',
        name: 'Upsell 1',
        active: true,
        gep: null,
        orderForm: null,
      },
    ],
    purchaseDetails,
    bumpOffers: [],
  },
} as unknown as Destination

const funnelFixture = {
  id: FUNNEL_ID,
  brandId: brand.id,
  name: 'Bio Complete 3 — VSL',
  active: true,
  slug: 'bio-complete-3-vsl',
  funnelType: 'Pre-Purchase',
  steps: [
    {
      id: STEP_ID,
      stepNumber: 1,
      slug: 'order-form',
      pageType: 'Order Form Page',
      name: 'Order Form',
      active: true,
      gep: null,
      orderForm: null,
    },
  ],
} as unknown as FunnelDetails

describe('HippoShopService destination identity pass-through', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetDestinationByGEP.mockResolvedValue(destinationFixture)
    mockGetFunnelByGEP.mockResolvedValue(funnelFixture)
  })

  it('emits the destination id and the default funnel id', async () => {
    const dto = await new HippoShopService(brand).getDestinationByIdOrSlug('bio-complete-3-3-pack-sub')

    expect(dto.id).toBe(DESTINATION_ID)
    expect(dto.funnelId).toBe(FUNNEL_ID)
    expect(dto.funnelSlug).toBe('bc3-post-purchase')
    expect(dto.slug).toBe('bio-complete-3-3-pack-sub')
  })

  it('emits url and checkoutOverrideUrl as null when Salesforce supplies neither', async () => {
    const dto = await new HippoShopService(brand).getDestinationByIdOrSlug('bio-complete-3-3-pack-sub')

    expect(dto.url).toBeNull()
    expect(dto.pricing.checkoutOverrideUrl).toBeNull()
  })

  it('emits the funnel step id', async () => {
    const dto = await new HippoShopService(brand).getFunnelByIdOrSlug('bio-complete-3-vsl')

    expect(dto.steps).toHaveLength(1)
    expect(dto.steps[0].id).toBe(STEP_ID)
    expect(dto.steps[0].kind).toBe('order-form')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/services/hippo-shop/HippoShop.service.test.ts
```

Expected: ts-jest reports type errors before any assertion runs —
`error TS2339: Property 'id' does not exist on type 'HippoShopDestinationDTO'.`,
`Property 'funnelId' does not exist…`, `Property 'url' does not exist…`,
`Property 'checkoutOverrideUrl' does not exist on type 'HippoShopPricingDTO'.`,
`Property 'id' does not exist on type 'HippoShopFunnelStepDTO'.`

- [ ] **Step 3: Bump the types pin**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npm install @goldenhippo/hippo-shop-types@^4.0.0
```

Confirm `package.json` now reads `"@goldenhippo/hippo-shop-types": "^4.0.0"` and that `package-lock.json` resolved a `4.x` version.

- [ ] **Step 4: Update the Zod mirrors**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/controllers/hippo-shop/HippoShop.spec.ts`:

**(a)** Add `id` as the first field of `ZHippoShopFunnelStepDTO` (before `stepNumber`, line 45):

```ts
    id: z.string().openapi({
      description: 'Salesforce funnel-step ID. Supplies `funnelSTPId` on funnel events.',
      example: 'a0S1a00000E1H2AAAV',
    }),
```

**(b)** Add `checkoutOverrideUrl` to `ZHippoShopPricingDTO`, immediately after the `bumpOffers` field (line 227–229) and before the object closes:

```ts
    checkoutOverrideUrl: z.string().nullable().openapi({
      description:
        'Per-destination override for the checkout base URL. `null` means fall through to the destination `url`, then to the brand-level default.',
      example: null,
    }),
```

**(c)** In `ZHippoShopDestinationDTO`, add `id` as the first field (before `slug`, line 235):

```ts
    id: z.string().openapi({
      description: 'Salesforce destination ID. Supplies `destinationId` on funnel events.',
      example: 'a0X1a00000F1H2AAAV',
    }),
```

and add `funnelId` and `url` immediately after the `funnelSlug` field (lines 246–249):

```ts
    funnelId: z.string().openapi({
      description:
        'Salesforce ID of the funnel this destination resolves to. Supplies `funnelSTFId`/`mainFunnelId` on funnel events.',
      example: 'a0F1a00000G1H2AAAV',
    }),
    url: z.string().nullable().openapi({
      description: 'Absolute landing URL for this destination. `null` when Salesforce has none.',
      example: 'https://www.gundrymd.com/bc3-3pk-sub',
    }),
```

- [ ] **Step 5: Update the serializer**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/hippo-shop/HippoShop.service.ts`:

**(a)** In `formatFunnelToDTO`, change the `steps.push({…})` call (lines 209–214) to:

```ts
      steps.push({
        id: step.id,
        stepNumber: step.stepNumber,
        slug: step.slug,
        name: step.name,
        kind,
      })
```

**(b)** Replace `formatDestinationToDTO` (lines 226–235) with:

```ts
  private formatDestinationToDTO(destination: PostPurchaseDestination): HippoShopDestinationDTO {
    const funnel = destination.defaultFunnel
    return {
      // Salesforce ids the SDK cannot otherwise obtain — our resources are slug-keyed, and a funnel
      // event is silently dropped upstream when `funnelSTFId` is blank. Both are already in the
      // payload DestinationService fetched; this serializer used to discard them.
      id: destination.id,
      slug: destination.slug,
      name: destination.name,
      description: destination.description,
      funnelId: funnel.id,
      funnelSlug: funnel.slug,
      // Wired to the interim SOQL lookup in the next commit.
      url: null,
      pricing: this.buildPricing(funnel.purchaseDetails, funnel.bumpOffers),
    }
  }
```

**(c)** In `buildPricing`, add this as the last property of the returned object, after `bumpOffers` (line 277):

```ts
      // No Salesforce field backs a per-destination checkout override today. The DTO field exists
      // for the SDK's resolution chain (override -> destination url -> brand default); emitting
      // null is what makes that chain fall through to `url`.
      checkoutOverrideUrl: null,
```

- [ ] **Step 6: Run the test and the full type check**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx tsc --noEmit && \
  npx jest src/tests/unit-tests/services/hippo-shop/HippoShop.service.test.ts && \
  npm run lint
```

Expected: `tsc` clean — in particular no `TS2322: Type 'boolean' is not assignable to type 'never'` from the `Equals<…>` assertions at `HippoShop.spec.ts:504-519`. Then 3 tests passed, clean lint.

- [ ] **Step 7: Run the whole suite**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && npm test
```

Expected: no new failures relative to `prerelease`.

- [ ] **Step 8: Commit — pin bump, schema, and serializer together**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
git add package.json package-lock.json \
        src/controllers/hippo-shop/HippoShop.spec.ts \
        src/services/hippo-shop/HippoShop.service.ts \
        src/tests/unit-tests/services/hippo-shop/HippoShop.service.test.ts && \
git commit -m "feat(hippo-shop): pin types v4 and pass destination identity through

Emits destination.id, defaultFunnel.id and step ids that the serializer was
dropping, plus null url and checkoutOverrideUrl. The pin bump and the Zod
mirrors must be one commit: HippoShop.spec.ts asserts bidirectional type
equality, so either alone fails tsc."
```

---

### Task 39: Interim destination-URL lookup via SOQL

Covers Workstream 2 item 3. Destinations are fetched through an Apex REST route, so the URL is retrieved with a separate direct SOQL query until the managed-package field lands.

The spec's instruction for this item is **"Copy the `Campaign.service.ts:44-70` pattern verbatim"**, and that pattern is two controls, not one:

- `SALESFORCE_ID_PATTERN` (`Campaign.service.ts:13`) tested against **both** the record id and `this.brand.id` (`Campaign.service.ts:49`), because both are interpolated into the same `WHERE`.
- `AND TouchCRBase__Business_Unit__c = '${this.brand.id}'` in the `WHERE` (`Campaign.service.ts:53`).

Both are load-bearing here. Without the business-unit predicate, `WHERE Id = '<destinationId>'` matches on id alone, so a destination id belonging to another brand resolves and this service hands brand A brand B's landing URL — breaking `SPEC.md:18`, *"**Brand-scoped isolation** — every request is scoped to one brand by the `data-brand` attribute and the access key. Cross-brand reads return 404."* And without the `brand.id` shape check the predicate itself is forgeable, which is exactly why `Campaign.service.ts:45-48` checks it:

> ```
> // Both interpolated values are re-checked here: this is the only method in the codebase that
> // hand-builds SOQL, so the guard lives next to the interpolation rather than only at the entry
> // point. brand.id is internal (resolved from brand settings, not the x-brand header), but it is
> // in the same WHERE as the id filter, so a malformed one could void the brand scoping too.
> ```

One deliberate divergence from `CampaignService`: it throws `ApiError(…, BAD_REQUEST, 'INVALID_CAMPAIGN_ID')` on a failed guard. This service cannot — the lookup is supplementary and must never fail the destination response — so the same guard degrades to `url: null` and logs.

> **IMPLEMENTER INPUT — one unresolved value.** The URL **field** is confirmed as `TouchCRBase__Full_Generic_URL__c` and is filled in. The **sObject API name** is not: it is inferred to be `TouchCRBase__Destination__c` from the lookup field of that name on `Campaign` (`Campaign.service.ts:52`), but destinations reach this service through an Apex REST route rather than SOQL, so nothing in either repository confirms it. Everything in this task is complete except that one string in `DestinationUrl.config.ts`. While it is empty the lookup issues **no query at all** and every destination serialises `url: null` — exactly the degradation the SDK's resolution chain already handles — so this task is safe to merge and deploy before the answer arrives. A wrong object name is a runtime `INVALID_TYPE` on every destination request, six per offer-selector page load. **Confirm, do not guess.**

**Files:**
- Create: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/destination/DestinationUrl.config.ts`
- Create: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/destination/DestinationUrl.service.ts`
- Modify: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/hippo-shop/HippoShop.service.ts` (add one import below line 20; replace `getDestinationByIdOrSlug`, lines 101–107; re-sign `formatDestinationToDTO` — the 17-line block Task 38 leaves at lines 227–243)
- Test: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/destination/DestinationUrl.service.test.ts` (new)
- Test: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/destination/DestinationUrl.unconfigured.test.ts` (new)
- Test: `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/hippo-shop/HippoShop.service.test.ts` (created by Task 38 — add a mock, two imports, and a `describe` block)

**Interfaces:**
- Consumes: `SalesforceService.runQueryViaRest(query: string, accessToken?: string, options?: Partial<QueryOptions>): Promise<QueryResult<JSForceRecord>>`; `CacheService.get(key: string, fullKey?: boolean): Promise<string | null>` / `CacheService.set({ key, value, expirationInSeconds }): Promise<boolean>`; `CommerceBrand.id`, `CommerceBrand.name`, `CommerceBrand.accessToken`; `HippoLogger.event({ filePath?, brand?, level?, requestId?, action?, status?, details? }): void`.
- Produces:
  - `DESTINATION_URL_SOBJECT: string` and `DESTINATION_URL_FIELD: string` from `@services/destination/DestinationUrl.config`
  - `class DestinationUrlService { constructor(brand: CommerceBrand); isSalesforceId(value: string): boolean; getDestinationUrl(destinationId: string): Promise<string | null> }` (default export)
  - `HippoShopService.formatDestinationToDTO(destination: PostPurchaseDestination, url: string | null): HippoShopDestinationDTO`

- [ ] **Step 1: Write the failing configured-path test**

Create `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/destination/DestinationUrl.service.test.ts`:

```ts
// runQueryViaRest interpolates BOTH the destination id and brand.id into a SOQL string, and
// composeQuery does NOT escape single quotes, so both must be shape-validated before they reach
// the query — the same control, for the same reason, as CampaignService (Campaign.service.ts:45-49).
// The TouchCRBase__Business_Unit__c predicate is what keeps SPEC.md:18 ("Cross-brand reads return
// 404") true for this second, hand-built query. And per Goal 8 this lookup must never fail the
// destination response.
import 'jest'
import type { CommerceBrand } from '@models/Brand.model'

const mockRunQuery = jest.fn()
const mockCacheGet = jest.fn()
const mockCacheSet = jest.fn()

jest.mock('@goldenhippo/hippo-salesforce-service', () => ({
  SalesforceService: jest.fn().mockImplementation(() => ({ runQueryViaRest: mockRunQuery })),
}))

jest.mock('@lib/salesforceApi.lib', () => ({ __esModule: true, default: {} }))

jest.mock('@services/cache/Cache.service', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ get: mockCacheGet, set: mockCacheSet })),
}))

jest.mock('@goldenhippo/gh-service-utils', () => ({
  ...jest.requireActual('@goldenhippo/gh-service-utils'),
  HippoLogger: jest.fn().mockImplementation(() => ({ note: jest.fn(), event: jest.fn(), log: jest.fn() })),
}))

jest.mock('@services/destination/DestinationUrl.config', () => ({
  __esModule: true,
  DESTINATION_URL_SOBJECT: 'TestDestination__c',
  DESTINATION_URL_FIELD: 'Test_Landing_URL__c',
}))

import DestinationUrlService from '@services/destination/DestinationUrl.service'

const brand = { id: 'a000m000005MJUmAAO', name: 'Gundry MD', accessToken: 'tok' } as unknown as CommerceBrand
const otherBrand = {
  id: 'a000m000009XYZqAAO',
  name: 'Beverly Hills MD',
  accessToken: 'tok2',
} as unknown as CommerceBrand

const DESTINATION_ID = 'a0Xde0000001AAABCD'
const OTHER_BRAND_DESTINATION_ID = 'a0Xde0000002BBBCDE'
const URL_FOR_DESTINATION = 'https://www.gundrymd.com/bc3-3pk-sub'
const URL_FOR_OTHER_BRAND = 'https://www.beverlyhillsmd.com/dermal-repair-3pk'

// A stand-in for the org. A record comes back only when the query's Business Unit literal matches
// the brand that actually owns that record — which is precisely what Salesforce does with the
// predicate present. Drop `AND TouchCRBase__Business_Unit__c = '<brand.id>'` from the service and
// the WHERE matches on Id alone, so this fixture starts handing one brand another brand's URL.
const ORG_RECORDS: Record<string, { businessUnit: string; url: string }> = {
  [DESTINATION_ID]: { businessUnit: brand.id, url: URL_FOR_DESTINATION },
  [OTHER_BRAND_DESTINATION_ID]: { businessUnit: otherBrand.id, url: URL_FOR_OTHER_BRAND },
}

const fakeOrg = (query: string) => {
  const requestedId = /\bId = '([^']*)'/.exec(query)?.[1] ?? ''
  const requestedBusinessUnit = /TouchCRBase__Business_Unit__c = '([^']*)'/.exec(query)?.[1] ?? ''
  const record = ORG_RECORDS[requestedId]
  if (!record || record.businessUnit !== requestedBusinessUnit) return { totalSize: 0, records: [] }
  return { totalSize: 1, records: [{ Id: requestedId, Test_Landing_URL__c: record.url }] }
}

describe('DestinationUrlService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCacheGet.mockResolvedValue(null)
    mockCacheSet.mockResolvedValue(true)
    mockRunQuery.mockImplementation((query: string) => Promise.resolve(fakeOrg(query)))
  })

  it('scopes the query to the brand and returns the URL Salesforce holds', async () => {
    const url = await new DestinationUrlService(brand).getDestinationUrl(DESTINATION_ID)

    expect(url).toBe(URL_FOR_DESTINATION)
    expect(mockRunQuery).toHaveBeenCalledTimes(1)
    const [sent, token] = mockRunQuery.mock.calls[0] as [string, string]
    expect(sent).toContain('TestDestination__c')
    expect(sent).toContain('Test_Landing_URL__c')
    expect(sent).toContain(`Id = '${DESTINATION_ID}'`)
    expect(sent).toContain(`AND TouchCRBase__Business_Unit__c = '${brand.id}'`)
    expect(token).toBe('tok')
  })

  it('returns null for a well-formed destination id that belongs to another brand', async () => {
    const url = await new DestinationUrlService(brand).getDestinationUrl(OTHER_BRAND_DESTINATION_ID)

    expect(url).toBeNull()
  })

  it('returns that same id to the brand that does own it', async () => {
    // Proves the null above is the brand filter doing its job, not an inert fixture.
    const url = await new DestinationUrlService(otherBrand).getDestinationUrl(OTHER_BRAND_DESTINATION_ID)

    expect(url).toBe(URL_FOR_OTHER_BRAND)
  })

  it('returns null when Salesforce has no matching record', async () => {
    mockRunQuery.mockResolvedValue({ totalSize: 0, records: [] })

    await expect(new DestinationUrlService(brand).getDestinationUrl(DESTINATION_ID)).resolves.toBeNull()
  })

  it('returns null when the field is present but empty', async () => {
    mockRunQuery.mockResolvedValue({ totalSize: 1, records: [{ Id: DESTINATION_ID, Test_Landing_URL__c: '' }] })

    await expect(new DestinationUrlService(brand).getDestinationUrl(DESTINATION_ID)).resolves.toBeNull()
  })

  it('resolves to null instead of rejecting when the query fails', async () => {
    mockRunQuery.mockRejectedValue(new Error('INVALID_FIELD: No such column'))

    await expect(new DestinationUrlService(brand).getDestinationUrl(DESTINATION_ID)).resolves.toBeNull()
  })

  it.each([
    ['quote break-out', "x' OR Id != null OR Id = 'y"],
    ['brand-filter bypass', "x' OR TouchCRBase__Business_Unit__c != '"],
    ['empty id', ''],
    ['too short', 'abc123'],
    ['trailing quote', `${DESTINATION_ID}'`],
  ])('rejects %s without querying Salesforce', async (_label, badId) => {
    await expect(new DestinationUrlService(brand).getDestinationUrl(badId)).resolves.toBeNull()

    expect(mockRunQuery).not.toHaveBeenCalled()
    expect(mockCacheGet).not.toHaveBeenCalled()
  })

  it('issues no query when the brand id itself is malformed', async () => {
    // brand.id is internal — resolved from brand settings, not the x-brand header — but it lands in
    // the same WHERE as the id filter, so a malformed one could void the brand scoping.
    const brokenBrand = {
      id: "x' OR Id != null OR Id = 'y",
      name: 'Gundry MD',
      accessToken: 'tok',
    } as unknown as CommerceBrand

    await expect(new DestinationUrlService(brokenBrand).getDestinationUrl(DESTINATION_ID)).resolves.toBeNull()

    expect(mockRunQuery).not.toHaveBeenCalled()
    expect(mockCacheGet).not.toHaveBeenCalled()
  })

  it('serves a repeat lookup from a cache key that carries the brand id', async () => {
    mockCacheGet.mockResolvedValueOnce(null).mockResolvedValueOnce(`"${URL_FOR_DESTINATION}"`)
    const service = new DestinationUrlService(brand)

    await service.getDestinationUrl(DESTINATION_ID)
    const second = await service.getDestinationUrl(DESTINATION_ID)

    expect(second).toBe(URL_FOR_DESTINATION)
    expect(mockRunQuery).toHaveBeenCalledTimes(1)
    expect(mockCacheSet).toHaveBeenCalledWith({
      key: `destinationUrl:${brand.id}:${DESTINATION_ID}`,
      value: `"${URL_FOR_DESTINATION}"`,
      expirationInSeconds: 900,
    })
  })

  it('cannot serve one brand a cache entry written under another brand id', async () => {
    await new DestinationUrlService(brand).getDestinationUrl(DESTINATION_ID)
    await new DestinationUrlService(otherBrand).getDestinationUrl(DESTINATION_ID)

    expect(mockCacheGet).toHaveBeenNthCalledWith(1, `destinationUrl:${brand.id}:${DESTINATION_ID}`)
    expect(mockCacheGet).toHaveBeenNthCalledWith(2, `destinationUrl:${otherBrand.id}:${DESTINATION_ID}`)
  })

  it('identifies Salesforce ids for the parallel-start decision', () => {
    const service = new DestinationUrlService(brand)

    expect(service.isSalesforceId(DESTINATION_ID)).toBe(true)
    expect(service.isSalesforceId('a0Xde0000001AAA')).toBe(true)
    expect(service.isSalesforceId('bio-complete-3-3-pack-sub')).toBe(false)
  })
})
```

- [ ] **Step 2: Write the failing unconfigured-path test**

Create `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/destination/DestinationUrl.unconfigured.test.ts`:

```ts
// Cluster G open question 5 is unanswered, so this is the shipping configuration today: with no
// sObject the lookup must issue no query at all and yield null, which the SDK degrades from.
import 'jest'
import type { CommerceBrand } from '@models/Brand.model'

const mockRunQuery = jest.fn()
const mockCacheGet = jest.fn()

jest.mock('@goldenhippo/hippo-salesforce-service', () => ({
  SalesforceService: jest.fn().mockImplementation(() => ({ runQueryViaRest: mockRunQuery })),
}))

jest.mock('@lib/salesforceApi.lib', () => ({ __esModule: true, default: {} }))

jest.mock('@services/cache/Cache.service', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ get: mockCacheGet, set: jest.fn() })),
}))

jest.mock('@goldenhippo/gh-service-utils', () => ({
  ...jest.requireActual('@goldenhippo/gh-service-utils'),
  HippoLogger: jest.fn().mockImplementation(() => ({ note: jest.fn(), event: jest.fn(), log: jest.fn() })),
}))

jest.mock('@services/destination/DestinationUrl.config', () => ({
  __esModule: true,
  DESTINATION_URL_SOBJECT: '',
  DESTINATION_URL_FIELD: 'TouchCRBase__Full_Generic_URL__c',
}))

import DestinationUrlService from '@services/destination/DestinationUrl.service'

const brand = { id: 'a000m000005MJUmAAO', name: 'Gundry MD', accessToken: 'tok' } as unknown as CommerceBrand

describe('DestinationUrlService when the sObject is not yet identified', () => {
  it('issues no query and resolves to null', async () => {
    const url = await new DestinationUrlService(brand).getDestinationUrl('a0Xde0000001AAABCD')

    expect(url).toBeNull()
    expect(mockRunQuery).not.toHaveBeenCalled()
    expect(mockCacheGet).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/services/destination/
```

Expected: both files fail before any assertion runs, ts-jest reporting
`error TS2307: Cannot find module '@services/destination/DestinationUrl.service' or its corresponding type declarations.`
and, from the `jest.mock` factory, `Cannot find module '@services/destination/DestinationUrl.config' from 'src/tests/unit-tests/services/destination/DestinationUrl.service.test.ts'`.

- [ ] **Step 4: Create the config module**

Create `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/destination/DestinationUrl.config.ts`:

```ts
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPLEMENTER INPUT — the only unresolved value in the destination-URL feature.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The FIELD is confirmed: `TouchCRBase__Full_Generic_URL__c`.
 *
 * The SOBJECT is not. It is inferred to be `TouchCRBase__Destination__c` from
 * the lookup field of that name on `Campaign` (Campaign.service.ts:52), but
 * destinations reach this service through an Apex REST route rather than SOQL,
 * so nothing in this repository or in hippo-salesforce-service confirms the
 * object's API name. Confirm it with the Salesforce team before filling it in:
 * a wrong object name is a runtime INVALID_TYPE on every destination request,
 * and an offer-selector page issues six of those per load.
 *
 * DO NOT GUESS the object name. `Campaign.TouchCRBase__URL_V2__c` is a
 * different, campaign-scoped field — it is NOT this one.
 *
 * While either string is empty, `DestinationUrlService` issues no query at all
 * and every destination serialises `url: null`. That is indistinguishable to the
 * client from "Salesforce has none", which the SDK's resolution chain already
 * falls through (override -> destination url -> brand-level `data-checkout-base`).
 * So this file may ship empty; filling it is a one-line change plus a test-fixture
 * update, with no other code movement.
 *
 * The brand filter is deliberately NOT configurable here. `TouchCRBase__Business_Unit__c`
 * is hard-coded in the query so no empty or mistyped config value can silently
 * remove the predicate that keeps cross-brand reads returning 404 (SPEC.md:18).
 *
 * This is a separate module purely so tests can `jest.mock` it and exercise both
 * the configured and unconfigured paths.
 */
// CONFIRM THIS ONE before enabling — see the note above.
export const DESTINATION_URL_SOBJECT = '' // inferred: 'TouchCRBase__Destination__c'
export const DESTINATION_URL_FIELD = 'TouchCRBase__Full_Generic_URL__c'
```

- [ ] **Step 5: Create the lookup service**

Create `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/destination/DestinationUrl.service.ts`:

```ts
import { CommerceBrand } from '@models/Brand.model'
import { SalesforceService as SFSDK } from '@goldenhippo/hippo-salesforce-service'
import salesforceApiLib from '@lib/salesforceApi.lib'
import CacheService from '@services/cache/Cache.service'
import { HippoLogger } from '@goldenhippo/gh-service-utils'
import rTracer from 'cls-rtracer'
import { DESTINATION_URL_FIELD, DESTINATION_URL_SOBJECT } from '@services/destination/DestinationUrl.config'

// Copied verbatim from Campaign.service.ts:9-13, the only other hand-built SOQL in the codebase:
//   "Salesforce ids are 15 or 18 case-sensitive alphanumerics. Anything else cannot be a real id,
//    and since queryCampaignById interpolates the value into a SOQL string — composeQuery does NOT
//    escape quotes, so there is no safe-escaping path here — validating the shape is the control
//    that stops a crafted id from breaking out of the literal and neutralising the brand filter."
const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/

// Matches DestinationService's own destination cache. An offer-selector page binds six distinct
// destination slugs, so without this the supplementary lookup would add six SOQL trips per load.
const CACHE_TTL_SECONDS = 60 * 15

/**
 * Interim retrieval of a destination's absolute landing URL.
 *
 * Destinations come from an Apex REST route that does not expose the field, so this is a second,
 * direct trip to Salesforce for the same record. The durable fix is a managed-package field
 * surfaced through hippo-salesforce-service; that is a later cluster.
 *
 * The query is brand-scoped exactly as CampaignService's is. `WHERE Id = '<id>'` alone matches on
 * id regardless of owner, so a destination id from another brand would resolve and this service
 * would hand brand A brand B's landing URL — SPEC.md:18 ("Cross-brand reads return 404") broken
 * through a side channel that the 404 on the primary Apex fetch never sees.
 *
 * This lookup MUST NEVER fail the destination response. A SOQL error, a timeout, an unconfigured
 * sObject, a malformed id, or a malformed brand id all degrade to `null`, which is
 * indistinguishable to the client from "Salesforce has none" — the correct degradation given the
 * SDK's fallback chain. Making a supplementary field a hard dependency would turn one flaky
 * Salesforce call into six failed requests per offer-selector page load. This is the one place the
 * pattern diverges from CampaignService, which throws a 400 on the same guard.
 */
class DestinationUrlService {
  private readonly brand: CommerceBrand
  private readonly salesforceService: SFSDK
  private readonly cacheService: CacheService
  private readonly log = new HippoLogger({
    filePath: __filename,
    level: 'info',
    requestId: (rTracer.id() as string) ?? '',
  })

  constructor(brand: CommerceBrand) {
    this.brand = brand
    this.salesforceService = new SFSDK(salesforceApiLib)
    this.cacheService = new CacheService(brand)
  }

  /** Whether a request identifier is already a Salesforce id, so the lookup can start early. */
  public isSalesforceId(value: string): boolean {
    return SALESFORCE_ID_PATTERN.test(value)
  }

  public async getDestinationUrl(destinationId: string): Promise<string | null> {
    // Not yet identified — see DestinationUrl.config.ts. Fail closed rather than query blindly.
    if (!DESTINATION_URL_SOBJECT || !DESTINATION_URL_FIELD) return null

    // Campaign.service.ts:45-48 gives the reason, and it holds verbatim here:
    //   "Both interpolated values are re-checked here: this is the only method in the codebase that
    //    hand-builds SOQL, so the guard lives next to the interpolation rather than only at the
    //    entry point. brand.id is internal (resolved from brand settings, not the x-brand header),
    //    but it is in the same WHERE as the id filter, so a malformed one could void the brand
    //    scoping too."
    // Checked before the cache read as well, because both values are in the cache key.
    if (!this.isSalesforceId(destinationId) || !this.isSalesforceId(this.brand.id)) {
      this.log.event({
        brand: this.brand.name,
        action: 'getDestinationUrl',
        level: 'warn',
        details: 'Rejected destination URL lookup: destination id or brand id is not a Salesforce id',
      })
      return null
    }

    // CacheService already namespaces by brand *name* (`commerce:<name>:cache:`), but the query is
    // scoped by brand *id* — a different value off the same record. Keying by the id that actually
    // scoped the query means a cached URL can never be served under a business unit it was not
    // queried for.
    const cacheKey = `destinationUrl:${this.brand.id}:${destinationId}`
    try {
      const cached = await this.cacheService.get(cacheKey)
      if (cached !== null) return JSON.parse(cached) as string | null

      // TouchCRBase__Business_Unit__c is hard-coded, not read from config: an empty or mistyped
      // config value must never be able to drop the brand predicate.
      const query =
        `SELECT Id, ${DESTINATION_URL_FIELD} FROM ${DESTINATION_URL_SOBJECT} ` +
        `WHERE Id = '${destinationId}' AND TouchCRBase__Business_Unit__c = '${this.brand.id}' LIMIT 1`
      const result = await this.salesforceService.runQueryViaRest(query, this.brand.accessToken)
      const record =
        result.totalSize > 0 ? (result.records[0] as unknown as Record<string, unknown>) : undefined
      const value = record?.[DESTINATION_URL_FIELD]
      const url = typeof value === 'string' && value.length > 0 ? value : null

      await this.cacheService.set({
        key: cacheKey,
        value: JSON.stringify(url),
        expirationInSeconds: CACHE_TTL_SECONDS,
      })
      return url
    } catch (err) {
      this.log.event({
        brand: this.brand.name,
        action: 'getDestinationUrl',
        level: 'error',
        details: `Destination URL lookup failed for ${destinationId}: ${(err as Error).message}`,
      })
      return null
    }
  }
}

export default DestinationUrlService
```

- [ ] **Step 6: Run both destination tests to verify they pass**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/services/destination/
```

Expected: 16 passed across the two files — 15 in `DestinationUrl.service.test.ts` (the `it.each` contributes 5), 1 in `DestinationUrl.unconfigured.test.ts`.

- [ ] **Step 7: Add the lookup mock to the HippoShop test file**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/hippo-shop/HippoShop.service.test.ts`, add these two imports directly below the existing `import type { CommerceBrand } from '@models/Brand.model'` line:

```ts
import ApiError from '@abstractions/ApiError'
import { StatusCodes } from 'http-status-codes'
```

and add this mock alongside the existing `jest.mock` calls, immediately before the `import HippoShopService from '@services/hippo-shop/HippoShop.service'` line:

```ts
const mockGetDestinationUrl = jest.fn()
const mockIsSalesforceId = jest.fn()

jest.mock('@services/destination/DestinationUrl.service', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    getDestinationUrl: mockGetDestinationUrl,
    isSalesforceId: mockIsSalesforceId,
  })),
}))
```

- [ ] **Step 8: Write the failing wiring test**

Append this `describe` block to the end of `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/tests/unit-tests/services/hippo-shop/HippoShop.service.test.ts`:

```ts
describe('HippoShopService destination URL wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetDestinationByGEP.mockResolvedValue(destinationFixture)
    mockIsSalesforceId.mockImplementation((v: string) => /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(v))
    mockGetDestinationUrl.mockResolvedValue(null)
  })

  it('serialises the looked-up URL onto the DTO root', async () => {
    mockGetDestinationUrl.mockResolvedValue('https://www.gundrymd.com/bc3-3pk-sub')

    const dto = await new HippoShopService(brand).getDestinationByIdOrSlug('bio-complete-3-3-pack-sub')

    expect(dto.url).toBe('https://www.gundrymd.com/bc3-3pk-sub')
    expect(mockGetDestinationUrl).toHaveBeenCalledWith(DESTINATION_ID)
  })

  it('starts the lookup against the request identifier when it is already a Salesforce id', async () => {
    // The early start is what makes the second SOQL trip overlap the primary Apex fetch rather
    // than follow it. resolveDestination tries GEP first, so the id path needs a 404 from GEP.
    mockGetDestinationByGEP.mockRejectedValue(
      new ApiError('Destination with GEP not found', StatusCodes.NOT_FOUND, 'DESTINATION_NOT_FOUND'),
    )
    mockGetDestinationById.mockResolvedValue(destinationFixture)
    mockGetDestinationUrl.mockResolvedValue('https://www.gundrymd.com/bc3-3pk-sub')

    const dto = await new HippoShopService(brand).getDestinationByIdOrSlug(DESTINATION_ID)

    expect(dto.url).toBe('https://www.gundrymd.com/bc3-3pk-sub')
    expect(mockGetDestinationUrl).toHaveBeenCalledTimes(1)
    expect(mockGetDestinationUrl).toHaveBeenCalledWith(DESTINATION_ID)
  })

  it('still returns the destination when the URL lookup rejects', async () => {
    mockGetDestinationUrl.mockRejectedValue(new Error('SOQL timeout'))

    const dto = await new HippoShopService(brand).getDestinationByIdOrSlug('bio-complete-3-3-pack-sub')

    expect(dto.url).toBeNull()
    expect(dto.id).toBe(DESTINATION_ID)
    expect(dto.funnelId).toBe(FUNNEL_ID)
  })

  it('does not swallow a genuine destination 404 just because a lookup is in flight', async () => {
    mockGetDestinationByGEP.mockResolvedValue(null)
    mockGetDestinationById.mockResolvedValue(null)
    mockGetDestinationUrl.mockRejectedValue(new Error('SOQL timeout'))

    await expect(new HippoShopService(brand).getDestinationByIdOrSlug(DESTINATION_ID)).rejects.toMatchObject({
      status: StatusCodes.NOT_FOUND,
      name: 'NOT_FOUND',
    })
  })
})
```

- [ ] **Step 9: Run the wiring test to verify it fails**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx jest src/tests/unit-tests/services/hippo-shop/HippoShop.service.test.ts
```

Expected: `expect(received).toBe(expected) / Expected: "https://www.gundrymd.com/bc3-3pk-sub" / Received: null` and `expect(jest.fn()).toHaveBeenCalledWith(…) / Number of calls: 0` — `HippoShopService` does not call the lookup yet.

- [ ] **Step 10: Wire the lookup into `HippoShopService`**

In `/Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g/src/services/hippo-shop/HippoShop.service.ts`, add this import directly below the `DestinationService` import (line 20):

```ts
import DestinationUrlService from '@services/destination/DestinationUrl.service'
```

Replace `getDestinationByIdOrSlug` (lines 101–107) with:

```ts
  public async getDestinationByIdOrSlug(destinationIdOrSlug: string): Promise<HippoShopDestinationDTO> {
    const urlService = new DestinationUrlService(this.brand)
    // The URL is a supplementary, brand-scoped SOQL trip. Start it against the request identifier
    // when that identifier is already a Salesforce id, so it overlaps the primary Apex fetch
    // instead of following it. Either way it is awaited once, at DTO build time, and it never
    // fails the response: any error degrades to `url: null`, which the SDK's chain handles.
    const earlyUrl = urlService.isSalesforceId(destinationIdOrSlug)
      ? urlService.getDestinationUrl(destinationIdOrSlug).catch(() => null)
      : null
    const destination = await this.resolveDestination(destinationIdOrSlug)
    if (!destination) notFound()
    if (destination.type !== 'Post-Purchase') notFound()
    if (destination.defaultFunnel.funnelType !== 'Post-Purchase') notFound()
    const url = await (earlyUrl ?? urlService.getDestinationUrl(destination.id).catch(() => null))
    return this.formatDestinationToDTO(destination as PostPurchaseDestination, url)
  }
```

Then change the signature and the `url` property of `formatDestinationToDTO` (lines 227–243 as Task 38 leaves it):

```ts
  private formatDestinationToDTO(
    destination: PostPurchaseDestination,
    url: string | null,
  ): HippoShopDestinationDTO {
    const funnel = destination.defaultFunnel
    return {
      // Salesforce ids the SDK cannot otherwise obtain — our resources are slug-keyed, and a funnel
      // event is silently dropped upstream when `funnelSTFId` is blank. Both are already in the
      // payload DestinationService fetched; this serializer used to discard them.
      id: destination.id,
      slug: destination.slug,
      name: destination.name,
      description: destination.description,
      funnelId: funnel.id,
      funnelSlug: funnel.slug,
      // Null when Salesforce has none, when the record belongs to another brand, when the SOQL
      // lookup failed, and while the sObject is unidentified — all four are the same, correct
      // degradation for the client.
      url,
      pricing: this.buildPricing(funnel.purchaseDetails, funnel.bumpOffers),
    }
  }
```

- [ ] **Step 11: Run the full suite**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
  npx tsc --noEmit && npm run lint && npm test
```

Expected: clean `tsc`, clean lint, and the whole suite green — 7 tests in `HippoShop.service.test.ts` (3 from Task 38 plus these 4), 16 across the two `DestinationUrl` files, no regressions elsewhere.

- [ ] **Step 12: Commit**

```bash
cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && \
git add src/services/destination/DestinationUrl.config.ts \
        src/services/destination/DestinationUrl.service.ts \
        src/services/hippo-shop/HippoShop.service.ts \
        src/tests/unit-tests/services/destination/DestinationUrl.service.test.ts \
        src/tests/unit-tests/services/destination/DestinationUrl.unconfigured.test.ts \
        src/tests/unit-tests/services/hippo-shop/HippoShop.service.test.ts && \
git commit -m "feat(hippo-shop): emit the destination URL via an interim brand-scoped SOQL lookup

Destinations come from an Apex REST route that does not expose the field, so
this is a second direct query, started alongside the primary fetch and cached
for 15 minutes under a brand-scoped key.

Copies the Campaign.service.ts pattern in full: SALESFORCE_ID_PATTERN checked
against both the destination id and brand.id, and AND TouchCRBase__Business_Unit__c
in the WHERE. Without the predicate a WHERE on Id alone resolves another brand's
destination, breaking the cross-brand 404 guarantee in SPEC.md.

It never fails the response: errors, timeouts, a foreign-brand id and an
unidentified sObject all degrade to url: null.

The sObject name is unresolved (the field is confirmed) and lives alone in
DestinationUrl.config.ts. While empty, no query is issued."
```

---

### Task 40: Integration harness asserts the v4 destination and funnel shapes

Covers the Workstream 1 row `apps/integration-harness/src/public-v1.test.ts` — "Assert the new destination fields; assert the full key set rather than the three sampled paths at `:41-46`".

> **IMPLEMENTER NOTE — this task's runtime assertions cannot go green locally.** `apps/integration-harness` talks to a **live** API (`https://api-uat.goldenhippo.io` by default, `X-GH-Key` header, `X-GH-Brand: Gundry MD` — see the existing `get()` at `:17-30`). The new `id` / `funnelId` / `url` / step-`id` fields only exist on the wire once **Task 38** (identity pass-through + Zod schema + `^4.0.0` pin) and **Task 39** (interim SOQL URL lookup) are merged **and deployed to UAT**. Until then Step 2's run fails with a key-set diff, and that failure *is* the point of Step 2 — it is the pre-deploy red. The green re-run is Step 7, which you come back to after the commerce deploy. Everything in between (Steps 3–6) is real, committable work that passes today: the compile-time half of the contract, wired into `pnpm typecheck` so CI enforces it on every PR whether or not a UAT key is present.
>
> The suite is gated by `const describeIf = KEY ? describe : describe.skip;` (`:15`), so with no `HIPPO_SHOP_KEY` in the environment the network tests skip and CI stays green — that behaviour is preserved exactly, and Step 5 verifies it.

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/apps/integration-harness/src/public-v1.test.ts` (whole file — currently 59 lines)
- Modify: `/Users/stevenhall/Code/hippo-shop/apps/integration-harness/package.json` (`scripts` block, lines 7–10)
- Modify: `/Users/stevenhall/Code/hippo-shop/apps/integration-harness/README.md` (lines 7 and 21–26)

**Interfaces:**
- Consumes: `HippoShopFunnelDTO`, `HippoShopFunnelStepDTO`, `HippoShopDestinationDTO`, `HippoShopPricingDTO`, `HippoShopPriceDTO`, `HippoShopShippingDTO`, `HippoShopBumpOfferDTO`, `HippoShopFrequencyDTO`, `HippoShopProductDTO` from `@goldenhippo/hippo-shop-types` — **post-Task 12**, i.e. `HippoShopDestinationDTO` already carries `id: string`, `funnelId: string`, `url: string | null` and `HippoShopFunnelStepDTO` already carries `id: string`. Task 12 must be committed and `packages/types/dist` rebuilt before this task typechecks; the harness resolves the workspace link through `"types": "dist/index.d.ts"` (`packages/types/package.json:13`), there is no `paths` mapping in `tsconfig.base.json`.
- Consumes: the deployed `/public/v1/funnel/:slug` and `/public/v1/destination/:slug` responses (Tasks 38 and 39).
- Produces, inside the test file only (not exported, no runtime dependency added):
  - `keysOf<T>()(keys): readonly string[]` — a curried helper whose argument is a compile error unless `keys` lists **every** string key of `T` and nothing else; duplicates compile clean and are caught by `expectExactKeys` at runtime, not by tsc.
  - `expectExactKeys(actual: unknown, expected: readonly string[], label: string): void`
- Produces: an nx `typecheck` target on the `integration-harness` project. `nx show project integration-harness --json` currently reports only `test` and `test:watch` under `"NPM Scripts"`; adding the script is what pulls this file into root `pnpm typecheck`.

- [ ] **Step 1: Write the failing test**

Overwrite `/Users/stevenhall/Code/hippo-shop/apps/integration-harness/src/public-v1.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import type {
  HippoShopFunnelDTO,
  HippoShopFunnelStepDTO,
  HippoShopDestinationDTO,
  HippoShopPricingDTO,
  HippoShopPriceDTO,
  HippoShopShippingDTO,
  HippoShopBumpOfferDTO,
  HippoShopFrequencyDTO,
  HippoShopProductDTO,
} from '@goldenhippo/hippo-shop-types';

const BASE = process.env['HIPPO_SHOP_BASE_URL'] ?? 'https://api-uat.goldenhippo.io';
const KEY = process.env['HIPPO_SHOP_KEY'];
const BRAND = process.env['HIPPO_SHOP_BRAND'] ?? 'Gundry MD';
const FUNNEL_SLUG = process.env['HIPPO_SHOP_FUNNEL_SLUG'] ?? 'bio-complete-3-main';
const DESTINATION_SLUG = process.env['HIPPO_SHOP_DESTINATION_SLUG'] ?? 'bio-complete-3-6btl-sub';
const PRODUCT_SLUG = process.env['HIPPO_SHOP_PRODUCT_SLUG'] ?? 'bio-complete-3';

const describeIf = KEY ? describe : describe.skip;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'X-GH-Key': KEY as string,
      'X-GH-Brand': BRAND,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} — ${body}`);
  }
  return (await res.json()) as T;
}

/**
 * Compile-time exhaustive key list for `T`.
 *
 * The argument is rejected by tsc unless it lists every string key of `T`:
 * an unknown key fails the `K extends readonly Extract<keyof T, string>[]`
 * constraint, and a *missing* key collapses the conditional to a tuple the
 * array cannot satisfy, so the error names what was left out. That is the
 * half of this contract CI can enforce without a UAT key — add a field to a
 * DTO and forget this file, and `pnpm typecheck` fails.
 */
function keysOf<T>() {
  return <K extends readonly Extract<keyof T, string>[]>(
    keys: K &
      ([Extract<keyof T, string>] extends [K[number]]
        ? unknown
        : ['MISSING KEY(S)', Exclude<Extract<keyof T, string>, K[number]>]),
  ): readonly string[] => [...keys] as readonly string[];
}

/**
 * The runtime half: the server's key set must equal the contract's key set.
 * Not `toMatchObject`, not a handful of sampled paths — a field the API stops
 * sending and a field it starts sending are both failures, because the SDK
 * ships a `.d.ts` that promises exactly this shape.
 */
function expectExactKeys(actual: unknown, expected: readonly string[], label: string): void {
  expect(actual, `${label} is not a JSON object`).toBeTypeOf('object');
  expect(actual, `${label} is null`).not.toBeNull();
  expect(
    Object.keys(actual as object).sort(),
    `${label} key set drifted from @goldenhippo/hippo-shop-types`,
  ).toEqual([...expected].sort());
}

const FUNNEL_KEYS = keysOf<HippoShopFunnelDTO>()(['slug', 'name', 'active', 'steps']);
const FUNNEL_STEP_KEYS = keysOf<HippoShopFunnelStepDTO>()([
  'id', 'stepNumber', 'slug', 'name', 'kind',
]);
const DESTINATION_KEYS = keysOf<HippoShopDestinationDTO>()([
  'id', 'slug', 'name', 'description', 'funnelSlug', 'funnelId', 'url', 'pricing',
]);
const PRICING_KEYS = keysOf<HippoShopPricingDTO>()([
  'familyOrBundleId', 'orderFormId', 'sku', 'packageQuantity', 'purchaseType', 'frequency',
  'price', 'rebillPrice', 'outOfStock', 'restrictedCountryCodes', 'shipping', 'bumpOffers',
  'checkoutOverrideUrl',
]);
const PRICE_KEYS = keysOf<HippoShopPriceDTO>()(['amount', 'currency', 'savings']);
const SHIPPING_KEYS = keysOf<HippoShopShippingDTO>()([
  'domestic', 'international', 'freeShippingThreshold',
]);
const BUMP_OFFER_KEYS = keysOf<HippoShopBumpOfferDTO>()([
  'familyOrBundleId', 'orderFormId', 'sku', 'productName', 'unitOfMeasure', 'quantity', 'price',
  'outOfStock', 'restrictedCountryCodes',
]);
const FREQUENCY_KEYS = keysOf<HippoShopFrequencyDTO>()([
  'interval', 'scale', 'publicInterval', 'publicScale', 'value', 'label',
]);
const STEP_KINDS = ['landing', 'content', 'order-form', 'bump', 'upsell', 'downsell', 'thank-you'];

// Runs with or without a key — the only test in this file that does. It proves the
// comparator itself fails on both directions of drift, so a green CI run without a
// UAT key still means something.
describe('key-set helper', () => {
  it('passes on an exact match and fails on drift', () => {
    expectExactKeys({ amount: 1, currency: 'USD', savings: null }, PRICE_KEYS, 'price');
    expect(() => expectExactKeys({ amount: 1, currency: 'USD' }, PRICE_KEYS, 'price')).toThrow(
      /price key set drifted/,
    );
    expect(() =>
      expectExactKeys({ amount: 1, currency: 'USD', savings: null, extra: 1 }, PRICE_KEYS, 'price'),
    ).toThrow(/price key set drifted/);
  });
});

describeIf('public/v1 — UAT E2E', () => {
  it('GET /public/v1/funnel/:slug returns exactly the HippoShopFunnelDTO shape', async () => {
    const funnel = await get<HippoShopFunnelDTO>(`/public/v1/funnel/${FUNNEL_SLUG}`);

    expectExactKeys(funnel, FUNNEL_KEYS, 'funnel');
    expect(funnel.slug).toBeTypeOf('string');
    expect(funnel.name).toBeTypeOf('string');
    expect(funnel.active).toBeTypeOf('boolean');
    expect(Array.isArray(funnel.steps)).toBe(true);
    expect(funnel.steps.length).toBeGreaterThan(0);

    funnel.steps.forEach((step, i) => {
      expectExactKeys(step, FUNNEL_STEP_KEYS, `funnel.steps[${i}]`);
      // Cluster G: the Salesforce step id rides as `funnelSTPId` on every funnel event.
      // A blank value is silently dropped upstream, so blank is a failure, not a null case.
      expect(step.id, `funnel.steps[${i}].id`).toBeTypeOf('string');
      expect(step.id.length, `funnel.steps[${i}].id is blank`).toBeGreaterThan(0);
      expect(step.stepNumber).toBeTypeOf('number');
      expect(step.slug).toBeTypeOf('string');
      expect(step.name).toBeTypeOf('string');
      expect(STEP_KINDS).toContain(step.kind);
    });
  });

  it('GET /public/v1/destination/:slug returns exactly the HippoShopDestinationDTO shape', async () => {
    const dest = await get<HippoShopDestinationDTO>(`/public/v1/destination/${DESTINATION_SLUG}`);

    expectExactKeys(dest, DESTINATION_KEYS, 'destination');

    // Cluster G identity: `destinationId` and `mainFunnelId` on the funnel-event payload.
    expect(dest.id, 'destination.id').toBeTypeOf('string');
    expect(dest.id.length, 'destination.id is blank').toBeGreaterThan(0);
    expect(dest.funnelId, 'destination.funnelId').toBeTypeOf('string');
    expect(dest.funnelId.length, 'destination.funnelId is blank').toBeGreaterThan(0);

    // Cluster G navigation target. `null` is a valid, expected value: Task 39 degrades to
    // null when Salesforce has no URL, when the SOQL lookup fails, and while the sObject
    // name is unconfigured. What is *not* acceptable is a non-absolute string.
    const url = dest.url;
    expect(url === null || typeof url === 'string', 'destination.url').toBe(true);
    if (url !== null) {
      expect(() => new URL(url), `destination.url is not absolute: ${url}`).not.toThrow();
    }

    expect(dest.slug).toBeTypeOf('string');
    expect(dest.name).toBeTypeOf('string');
    expect(dest.description === null || typeof dest.description === 'string').toBe(true);
    expect(dest.funnelSlug).toBeTypeOf('string');

    expectExactKeys(dest.pricing, PRICING_KEYS, 'destination.pricing');
    expectExactKeys(dest.pricing.price, PRICE_KEYS, 'destination.pricing.price');
    expect(dest.pricing.price.currency).toBe('USD');
    expect(['subscription', 'one-time']).toContain(dest.pricing.purchaseType);
    expectExactKeys(dest.pricing.shipping, SHIPPING_KEYS, 'destination.pricing.shipping');

    // Both are null on a one-time destination; the default DESTINATION_SLUG is a
    // subscription, so with default env these two branches do run.
    if (dest.pricing.rebillPrice !== null) {
      expectExactKeys(dest.pricing.rebillPrice, PRICE_KEYS, 'destination.pricing.rebillPrice');
    }
    if (dest.pricing.frequency !== null) {
      expectExactKeys(dest.pricing.frequency, FREQUENCY_KEYS, 'destination.pricing.frequency');
    }

    expect(Array.isArray(dest.pricing.bumpOffers)).toBe(true);
    dest.pricing.bumpOffers.forEach((bump, i) => {
      expectExactKeys(bump, BUMP_OFFER_KEYS, `destination.pricing.bumpOffers[${i}]`);
      expectExactKeys(bump.price, PRICE_KEYS, `destination.pricing.bumpOffers[${i}].price`);
    });
  });

  // Left as sampled paths on purpose: Cluster G does not touch HippoShopProductDTO, and
  // its variant matrix is a Record keyed by quantity, so an exact key set would assert the
  // catalogue rather than the contract. Locking it down is a follow-up, not this task.
  it('GET /public/v1/product/:slug returns a HippoShopProductDTO', async () => {
    const product = await get<HippoShopProductDTO>(`/public/v1/product/${PRODUCT_SLUG}`);
    expect(product.id).toBeTypeOf('string');
    expect(product.reviews.count).toBeGreaterThanOrEqual(0);
    expect(product.variants.subscription).toBeDefined();
    expect(product.variants.oneTime).toBeDefined();
  });

  it('unknown slug returns 404', async () => {
    await expect(get(`/public/v1/funnel/__definitely_not_a_real_funnel__`)).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

This is the run that needs a real key and a real environment. `HIPPO_SHOP_KEY` is the publishable Kong key for UAT — take the value already used by whoever ran this harness for Cluster F; do not invent one. Nothing else changes: `HIPPO_SHOP_BASE_URL` defaults to `https://api-uat.goldenhippo.io` and `HIPPO_SHOP_BRAND` to `Gundry MD`, so UAT is what you get by setting only the key.

```bash
cd /Users/stevenhall/Code/hippo-shop && \
  HIPPO_SHOP_KEY=<uat publishable key> \
  pnpm --filter @hippo-shop/integration-harness test
```

Expected **before** Tasks 38–39 reach UAT — two of the five tests fail, and both diffs name exactly the fields Cluster G adds:

```
 ❯ src/public-v1.test.ts (5 tests | 2 failed)
   ✓ key-set helper > passes on an exact match and fails on drift
   × public/v1 — UAT E2E > GET /public/v1/funnel/:slug returns exactly the HippoShopFunnelDTO shape
     → funnel.steps[0] key set drifted from @goldenhippo/hippo-shop-types: expected [ Array(4) ] to deeply equal [ 'id', 'kind', 'name', 'slug', …(1) ]
   × public/v1 — UAT E2E > GET /public/v1/destination/:slug returns exactly the HippoShopDestinationDTO shape
     → destination key set drifted from @goldenhippo/hippo-shop-types: expected [ 'description', 'funnelSlug', …(3) ] to deeply equal [ 'description', 'funnelId', …(6) ]
```

with the destination diff spelling out all three missing keys:

```
- Expected
+ Received

  Array [
    "description",
-   "funnelId",
    "funnelSlug",
-   "id",
    "name",
    "pricing",
    "slug",
-   "url",
  ]
```

and the funnel-step diff:

```
- Expected
+ Received

  Array [
-   "id",
    "kind",
    "name",
    "slug",
    "stepNumber",
  ]
```

Summary line: `Test Files  1 failed (1)` / `Tests  2 failed | 3 passed (5)`. If instead you see `401` or `403` from `get()`, the key is wrong or Kong has not been given it — that is an environment problem, not this failure.

- [ ] **Step 3: Add a `typecheck` script so the compile-time half runs in CI**

In `/Users/stevenhall/Code/hippo-shop/apps/integration-harness/package.json`, replace the `scripts` block (lines 7–10):

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

with:

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
```

Nx infers targets from package.json scripts for this project (`nx show project integration-harness --json` lists them under `metadata.targetGroups["NPM Scripts"]`), so this one line is what makes root `nx run-many -t typecheck` cover the harness. The harness already devDepends on `typescript@^5.7.2` and its `tsconfig.json` sets `"noEmit": true` with `"include": ["src/**/*"]`, so no other config is needed.

- [ ] **Step 4: Run the typecheck to verify the key lists are exhaustive**

`packages/types/dist` must be current — the harness reads the contract through the built `.d.ts`, not through `src` — so build types first:

```bash
cd /Users/stevenhall/Code/hippo-shop && \
  pnpm --filter @goldenhippo/hippo-shop-types build && \
  pnpm --filter @hippo-shop/integration-harness typecheck
```

Expected: the tsup build lines, then no tsc output and exit status 0.

This is the guard that fires on future contract changes. Drop `'url'` and `'funnelId'` from `DESTINATION_KEYS` and tsc reports, at the offending array:

```
src/public-v1.test.ts(76,3): error TS2322: Type '"id"' is not assignable to type '"MISSING KEY(S)"'.
src/public-v1.test.ts(76,9): error TS2322: Type '"slug"' is not assignable to type '"url" | "funnelId"'.
```

and an unknown key is caught by the constraint directly:

```
src/public-v1.test.ts(76,84): error TS2322: Type '"nope"' is not assignable to type 'keyof HippoShopDestinationDTO'.
```

- [ ] **Step 5: Run the suite with no key to confirm CI stays green**

```bash
cd /Users/stevenhall/Code/hippo-shop && env -u HIPPO_SHOP_KEY pnpm --filter @hippo-shop/integration-harness test
```

Expected — the four network tests skip, the helper self-test runs:

```
 ✓ src/public-v1.test.ts (5 tests | 4 skipped) 2ms

 Test Files  1 passed (1)
      Tests  1 passed | 4 skipped (5)
```

Note this is a deliberate change from the previous `1 skipped (1)` / `4 skipped (4)`: the file now contributes one always-on test. The gate on the network tests is untouched.

- [ ] **Step 6: Document the contract and the deploy ordering in the README**

In `/Users/stevenhall/Code/hippo-shop/apps/integration-harness/README.md`, replace line 7:

```markdown
The suite is **skipped** unless `HIPPO_SHOP_KEY` is set, so it's safe to leave in CI without secrets.
```

with:

```markdown
The network tests are **skipped** unless `HIPPO_SHOP_KEY` is set, so it's safe to leave in CI without secrets. The key-set helper's own self-test always runs, and `pnpm --filter @hippo-shop/integration-harness typecheck` checks the DTO key lists against `@goldenhippo/hippo-shop-types` with no key and no network at all.
```

Then replace lines 21–26 (the whole `## What it verifies` section):

```markdown
## What it verifies

- Funnel / destination / product routes return the published DTO shape.
- Unknown slugs return 404 (the brand-mismatch and not-found case shares this code by design).

This is *not* a unit-test substitute — it's a smoke check that the producer (commerce API) and the contract (`@goldenhippo/hippo-shop-types`) are still in sync.
```

with:

```markdown
## What it verifies

- Funnel and destination responses carry **exactly** the DTO key set — no missing field, no extra field, at every level (`destination`, `pricing`, `price`, `shipping`, `bumpOffers[]`, `frequency`, `funnel`, `funnel.steps[]`). A field the API quietly stops sending and a field it quietly starts sending both fail here.
- The Cluster G additions specifically: `destination.id`, `destination.funnelId` (non-blank — a blank id makes a funnel event undeliverable upstream) and `destination.url` (absolute, or `null`, which is the documented degradation), plus `funnel.steps[].id`.
- The product route still uses sampled assertions — its variant matrix is keyed by quantity, so an exact key set would assert the catalogue rather than the contract.
- Unknown slugs return 404 (the brand-mismatch and not-found case shares this code by design).

The key lists are built with a `keysOf<T>()` helper whose argument fails to compile unless it names every key of `T`. So a DTO field added in `packages/types` without a matching line here is caught by `pnpm typecheck` in CI, long before anyone runs this against UAT.

This is *not* a unit-test substitute — it's a smoke check that the producer (commerce API) and the contract (`@goldenhippo/hippo-shop-types`) are still in sync.

**Ordering:** the exact-key assertions describe the **v4** contract. They fail against any environment still serving v3 — that is intended. UAT must have the commerce identity pass-through and destination-URL lookup deployed before this suite can pass with a key set.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/stevenhall/Code/hippo-shop && \
git add apps/integration-harness/src/public-v1.test.ts \
        apps/integration-harness/package.json \
        apps/integration-harness/README.md && \
git commit -m "test(harness): assert exact v4 key sets for funnel and destination

The destination test sampled three paths (funnelSlug, pricing.price.currency,
pricing.purchaseType), so the API could add or drop any other field without the
harness noticing. Both DTOs are now compared key-for-key at every level, and the
Cluster G additions — destination id/funnelId/url and funnel-step id — are
asserted directly, with blank ids treated as failures because upstream drops
events that carry them.

The key lists are exhaustive by construction: keysOf<T>() rejects a list that
omits a key of T, and a new typecheck script puts that check in root
pnpm typecheck, so contract drift fails CI without needing a UAT key.

The network tests stay gated on HIPPO_SHOP_KEY and will fail against UAT until
the commerce identity pass-through and destination-URL lookup are deployed."
```

- [ ] **Step 8: After the commerce deploy, re-run against UAT to verify it passes**

Do not run this until the Task 38 and Task 39 commits are merged on `prerelease` **and** deployed to UAT.

```bash
cd /Users/stevenhall/Code/hippo-shop && \
  HIPPO_SHOP_KEY=<uat publishable key> \
  pnpm --filter @hippo-shop/integration-harness test
```

Expected: `Test Files  1 passed (1)` / `Tests  5 passed (5)`.

If `destination.url` comes back `null`, the test still passes — that is Task 39's documented degradation and cannot be distinguished from "Salesforce has none" at this layer. Confirm the URL is actually populated by reading one response body directly rather than by trusting a green run:

```bash
curl -s -H "X-GH-Key: <uat publishable key>" -H "X-GH-Brand: Gundry MD" \
  https://api-uat.goldenhippo.io/public/v1/destination/bio-complete-3-6btl-sub | python3 -m json.tool
```

A `null` here after the deploy means the `DESTINATION_URL_SOBJECT` value in `DestinationUrl.config.ts` is still empty or wrong — see the open input on Task 39.


---


### Task 41: Documentation for the v4 surface

> **Locate edits by the quoted text, not by line number.** Every line citation in this task is against the *pristine* file; the task's own earlier steps shift them (Step 2 is +1, Step 3 is +2, Step 4 is +4, and so on cumulatively). Each quoted anchor is unique within its file, so search for it rather than seeking to a line.

Covers the `Docs` row of Workstream 1 and the "Reconcile the routing doc" item of Workstream 3. No unit test exists for prose, so every step is verified by grep plus a real `pnpm build` — the SDK build concatenates both READMEs into `dist/llms-full.txt` (`packages/sdk/scripts/build-llms.mjs:68-88`), so a README edit that does not land there did not land at all.

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md` (Contents lines 20–40; observer bullet line 117; script-config table lines 131–135; attribute reference table lines 160–173; new section inserted between line 367 and `## Recipes` at line 369; checkout recipe lines 496–520; `window.gh` block lines 542–556; lifecycle events lines 595–602; HTTP endpoints lines 658–664 and line 676; Safety line 750)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md` (CDN URL line 12; `data-gh-checkout` bullet line 53; new section inserted before `## Checkout handoff` at line 71; composed-URL contract lines 75–84; script-tag attributes lines 86–89; `checkoutUrl` lines 91–95; session accessors and `gh:session-ready` lines 97–107; cookie table lines 109–114; new `## Write calls` section inserted before `## Formatters` at line 128; Programmatic API bullets lines 161–163; lifecycle bullet line 174; `config` error row line 197; Deprecated surface lines 218–222)
- Modify: `/Users/stevenhall/Code/hippo-shop/packages/types/README.md` (version note line 9; funnel example lines 70–78; destination example lines 83–119)
- Modify: `/Users/stevenhall/Code/hippo-shop/docs/architecture/kong-public-routing.md` (header line 3; diagram lines 7–18; Service table `Path` row line 62; Route table `Strip Path` row line 75 and `Path Handling` row line 77; new section after the Route table which ends line 77; new section before `## Verification` at line 192; smoke test lines 234–263)

**Interfaces:**
- Consumes (documents, does not define): `window.gh.checkoutUrl(slug: string): Promise<string>` (Task 16); `window.gh.track(eventType: 'Page View'): Promise<void>` (Tasks 24–25); `window.gh.session.id(): string | undefined`; `window.gh.session.params(): ParsedParams | null`; `SESSION_ID_PATTERN: RegExp` = `/^[A-Za-z0-9._-]{1,128}$/` and `readSessionIdFromUrl(search: string): string | null` (Task 2); `SESSION_COOKIE_NAME: 'hippo_session_id'` (Task 5); `STEP_ATTR = 'data-gh-step'` / `FUNNEL_ID_ATTR = 'data-gh-funnel-id'` (Task 23); `HippoShopDestinationDTO.{id, funnelId, url}` and `HippoShopFunnelStepDTO.id` (Task 12); `GhConfig.{checkoutBase, cookieDomain}` (`packages/sdk/src/config.ts:12-15`); `PUBLIC_SDK_PATH_PREFIX = '/hippo-shop/'` (`errorHandler.middleware.ts:15`); `HippoShopController.basePath = 'hippo-shop'` (`HippoShop.controller.ts:12`)
- Produces: three new link anchors that other docs point at — `packages/sdk/README.md#session-attribution-and-events`, `packages/sdk/SPEC.md#session-identity-and-inbound-sessionid`, and `packages/sdk/SPEC.md#write-calls-session-and-funnel-events`. No code.

- [ ] **Step 1: Confirm the four documents still describe the v3 surface**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && \
    grep -n "Two events fire" packages/sdk/README.md; \
    grep -n "sends no analytics, no PII" packages/sdk/README.md; \
    grep -c "sdk/v3" packages/sdk/README.md packages/sdk/SPEC.md; \
    grep -n "Cookies managed by the SDK (Cluster F)" packages/sdk/SPEC.md; \
    grep -c "data-gh-step\|data-gh-funnel-id\|hippo_session_id\|sessionid=" packages/sdk/README.md; \
    grep -c "funnelId" packages/types/README.md; \
    grep -c "hippo-shop/v1" docs/architecture/kong-public-routing.md
  ```

  Expect exactly: `597:Two events fire on \`window\` during boot:`; `750:The SDK is read-only by design. It sends no analytics, no PII, and never executes data as code.`; counts `4` and `1` for `sdk/v3`; `109:### Cookies managed by the SDK (Cluster F)`; then `0`, `0`, `0` — the README documents none of the v4 session/event surface, the types README never mentions `funnelId`, and the Kong doc never mentions the upstream path the rewrite targets.

- [ ] **Step 2: Add the new section to the README's Contents list**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md`, replace this pair of lines (28–29):

  ```md
  - [Resource lifecycle (`data-when`)](#resource-lifecycle-data-when)
  - [Recipes](#recipes)
  ```

  with:

  ```md
  - [Resource lifecycle (`data-when`)](#resource-lifecycle-data-when)
  - [Session, attribution, and events](#session-attribution-and-events)
  - [Recipes](#recipes)
  ```

- [ ] **Step 3: Add the two new observed attributes to the re-binding list**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md`, replace line 117:

  ```md
  - Attribute changes on any of: `data-gh-product`, `data-gh-destination`, `data-gh-funnel`, `data-field`, `data-format`, `data-if`, `data-if-not`, `data-each`, `data-with`, `data-when`.
  ```

  with:

  ```md
  - Attribute changes on any of: `data-gh-product`, `data-gh-destination`, `data-gh-funnel`, `data-gh-checkout`, `data-gh-step`, `data-field`, `data-format`, `data-if`, `data-if-not`, `data-each`, `data-with`, `data-when`.

  `data-gh-checkout` and `data-gh-step` are watched for a specific reason: swapping a checkout slug re-composes that link's `href` against the new destination, and swapping a step slug is how an SPA route change produces a fresh `Page View` without any JavaScript of yours. See [Session, attribution, and events](#session-attribution-and-events).
  ```

- [ ] **Step 4: Promote `data-checkout-base` and `data-cookie-domain` into the script-tag config table**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md`, replace the Attributes table (lines 131–135):

  ```md
  | Attribute | Required | Default | Description |
  |-----------|----------|---------|-------------|
  | `data-key` | yes | — | Publishable key. Must match `/^gh_pk_[a-z0-9_-]+_<hex>$/` (e.g. `gh_pk_yourbrand_a1b2c3d4e5f6`). |
  | `data-brand` | yes | — | Brand display name. Must be non-empty after trimming. Validated server-side. |
  | `data-debug` | no | `"false"` | If set to the string `"true"`, the SDK logs requests, cache hits, and bind passes to the browser console with a `[gh]` prefix. Also sets `window.gh.debug = true`. |
  ```

  with:

  ```md
  | Attribute | Required | Default | Description |
  |-----------|----------|---------|-------------|
  | `data-key` | yes | — | Publishable key. Must match `/^gh_pk_[a-z0-9_-]+_<hex>$/` (e.g. `gh_pk_yourbrand_a1b2c3d4e5f6`). |
  | `data-brand` | yes | — | Brand display name. Must be non-empty after trimming. Validated server-side. |
  | `data-debug` | no | `"false"` | If set to the string `"true"`, the SDK logs requests, cache hits, and bind passes to the browser console with a `[gh]` prefix. Also sets `window.gh.debug = true`. |
  | `data-checkout-base` | conditional | — | Brand-level fallback base URL for outbound offer links (e.g. `https://checkout.gundrymd.com`). Used only when the destination carries neither a per-destination override nor its own `url`. Required if any page on this brand uses `data-gh-checkout` or `gh.checkoutUrl()` against destinations Salesforce has no URL for; optional otherwise. |
  | `data-cookie-domain` | conditional | auto-detect | Explicit `Domain` for the `hippo_session_id` cookie (e.g. `.gundrymd.com`). When absent the SDK derives the registrable root from `location.hostname` using a single-segment TLD allowlist — `com, net, org, io, app, dev, ai, co, us, store, shop`. **Multi-part TLDs (`.co.uk`, `.com.au`, `.co.jp`) require this attribute**; auto-detect refuses to guess them and falls back to a host-only cookie, which breaks the cross-subdomain handoff. |

  Set `data-checkout-base` and `data-cookie-domain` together on brands running a Superfunnel-hosted subdomain — see [Session, attribution, and events](#session-attribution-and-events).
  ```

- [ ] **Step 5: Document the three new `data-gh-*` attributes in the reference table**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md`, replace this row (line 164):

  ```md
  | `data-gh-funnel="slug"` | Any element | Sets the **funnel** context. |
  ```

  with:

  ```md
  | `data-gh-funnel="slug"` | Any element | Sets the **funnel** context. |
  | `data-gh-checkout="destination-slug"` | Any element | Marks the element as the control that sends the visitor to buy that offer. Fills `href` on `<a>`; attaches a navigating `click` handler on anything else. See [Session, attribution, and events](#session-attribution-and-events). |
  | `data-gh-step="step-slug"` | Any element, or the SDK `<script>` tag | Names the funnel step for the `Page View` event. Read from the **live DOM at emit time**, so an SPA can change it; a page element wins over the script tag. |
  | `data-gh-funnel-id="salesforce-id"` | Any element, or the SDK `<script>` tag | Supplies the funnel's Salesforce ID directly, for pages that bind no destination. Ignored when a bound destination already yields one. |
  ```

- [ ] **Step 6: Insert the `Session, attribution, and events` section**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md`, insert the following **between** the closing line of the `Resource lifecycle` section (line 367, `Loading skeletons render immediately on page load; …`) and the `## Recipes` heading (line 369):

  ````md
  ## Session, attribution, and events

  The SDK participates in Golden Hippo's session and attribution model rather than inventing its own. It resolves one session id per visitor, persists it at the brand's root domain, posts it to the API along with the landing URL's attribution, stamps it onto every outbound offer link, and emits one `Page View` funnel event per page load.

  All of it degrades quietly. A blocked cookie, a failed POST, an unresolvable funnel id — attribution gets worse; the page never breaks.

  ### The session id

  One id per visitor, resolved once per page load, in this order:

  1. **`?sessionid=` on the current URL.** Matched **case-sensitively** — `?SessionId=` is ignored. Validated against `/^[A-Za-z0-9._-]{1,128}$/`. On a pass the value is adopted **even when the cookie already holds a different one**, and written back to the cookie. On a fail the SDK warns and falls through.
  2. **The `hippo_session_id` cookie.**
  3. **A freshly minted UUID v4** — `crypto.randomUUID()`, with an RFC-4122 `getRandomValues` fallback.

  | Cookie | Max-Age | Path | Domain | SameSite | Secure |
  |--------|---------|------|--------|----------|--------|
  | `hippo_session_id` | 30 days (`2592000`) | `/` | `data-cookie-domain`, else the auto-detected registrable root (`.gundrymd.com`) | `Lax` | on `https:` |

  Root-domain scoping is the point: `sf.gundrymd.com` and `www.gundrymd.com` read the same cookie, so a visitor moving between them is one visitor.

  Read it with `window.gh.session.id()` — `undefined` until `gh:session-ready` fires. The attribution parsed from the landing URL is on `window.gh.session.params()`.

  ### Inbound handoff — `?sessionid=`

  Land a visitor with `?sessionid=<id>` and the SDK adopts that id as its own, overriding whatever it had:

  ```
  https://sf.gundrymd.com/offer?sessionid=3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455&utm_source=fb&fbclid=IwAR…
  ```

  That is how one page hands a visitor to another without minting a second identifier for a single visit. The SDK trusts the URL here **by design** — see [SPEC — Session identity and inbound `?sessionid=`](./SPEC.md#session-identity-and-inbound-sessionid) for the threat note and why the blast radius is analytics only. With `data-debug="true"` the adoption is logged as `[gh] session: adopting ?sessionid= handoff <id>`.

  ### Outbound handoff — `data-gh-checkout`

  `data-gh-checkout="<destination-slug>"` marks the control that sends a visitor to buy that offer. On `<a>` the SDK fills in `href`; on anything else it attaches a `click` handler that navigates the page.

  ```html
  <section data-gh-destination="bio3-3p-sub">
    <h3 data-field="name"></h3>
    <a data-gh-checkout="bio3-3p-sub">Select this offer</a>
  </section>
  ```

  The base URL resolves in this order, and the first one present wins:

  1. `destination.pricing.checkoutOverrideUrl` — per-destination override.
  2. `destination.url` — the destination's own absolute URL. The normal case.
  3. `data-checkout-base` on the script tag — brand-level fallback.

  Onto that base the SDK appends, in this order and skipping anything empty: `order_form_id`, `sessionid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_campaign_id`, `utm_content`, `utm_term`, `utm_chat`, `utm_action`, `off_id`, `aff_id`, `subid1`…`subid5`, `landing_url`, `referral_url`, `sales_funnel`, the seven raw click-ids (`fbclid`, `gclid`, `ScCid`, `qclid`, `twclid`, `ndclid`, `wbraid`), then `origdsidOrig` and `origsplitTestingFunnelIdOrig` forwarded verbatim from the current URL.

  ```
  https://www.gundrymd.com/bio3-3pk-sub?order_form_id=OF_123&sessionid=3f6b2c11-…&utm_source=fb&subid1=IwAR…&fbclid=IwAR…
  ```

  Parameters already present on the base URL win — the SDK only fills what is absent. Values are never truncated.

  ### `await gh.checkoutUrl(slug)`

  The programmatic twin of `data-gh-checkout`. It returns a `Promise<string>`: it awaits session resolution and fetches the destination if it isn't cached yet, so it can never hand back a URL with the session id and UTMs silently missing.

  ```js
  document.getElementById('buy').addEventListener('click', async (event) => {
    event.preventDefault();
    window.location.href = await window.gh.checkoutUrl('bio3-3p-sub');
  });
  ```

  > **`window.open()` will be popup-blocked.** Awaiting inside a click handler breaks the user-gesture chain, so `window.open(await window.gh.checkoutUrl(slug))` is blocked in every major browser. Assign `window.location.href` instead — a same-tab navigation is unaffected by the `await`, and it is the checkout pattern Golden Hippo actually uses.
  >
  > If you genuinely need a new tab, resolve the URL **before** the click and stash it, so the handler itself stays synchronous:
  >
  > ```js
  > let checkoutUrl = '#';
  > window.addEventListener('gh:bindings-ready', async () => {
  >   checkoutUrl = await window.gh.checkoutUrl('bio3-3p-sub');
  > }, { once: true });
  >
  > document.getElementById('buy').addEventListener('click', () => {
  >   window.open(checkoutUrl, '_blank'); // no await in the handler — gesture intact
  > });
  > ```

  ### `Page View` events

  The SDK emits exactly **one** `Page View` funnel event per page load, however many offers the page binds. Six bound destinations on an offer selector are six variants of one page view, not six page views.

  Identity is read from the DOM at emit time:

  | Attribute | What it supplies |
  |-----------|------------------|
  | `data-gh-destination` / `data-gh-checkout` | The funnel and destination Salesforce IDs, out of the destination the page already fetched. First match in document order wins, and `data-gh-destination` beats `data-gh-checkout`. |
  | `data-gh-step` | The funnel step. A page element wins over the script tag. |
  | `data-gh-funnel-id` | The funnel ID directly, for pages that bind no destination. |

  ```html
  <body data-gh-step="offer-selector">
    <section data-gh-destination="bio3-1p-ot">…</section>
    <section data-gh-destination="bio3-3p-sub">…</section>
    <!-- four more offers -->
  </body>
  ```

  **No funnel ID, no event.** If neither a bound destination nor `data-gh-funnel-id` yields one, the event is dropped — an event with a blank funnel ID is discarded silently further upstream, so sending it would be strictly worse than not sending it. With `data-debug="true"` the drop is logged with the reason.

  The event fires once session resolution and the first bind pass have both settled, plus a short quiet window so late-injected attributes land in the same event instead of a second one. It is sent with `keepalive: true` so it survives page unload, and it is **never retried** — not even on `429`.

  #### `gh.track('Page View')`

  The programmatic escape hatch, for SPA route changes:

  ```js
  await window.gh.track('Page View');
  ```

  It respects the same per-page-load dedupe guard as the automatic emit, keyed on the session id, the event type, and the step. **Update `data-gh-step` before calling it** — otherwise the key is unchanged and the call is a deliberate no-op. Often you don't need it at all: `data-gh-step` is in the `MutationObserver`'s filter, so an SPA that swaps the attribute gets a new `Page View` through the existing machinery.

  ````

- [ ] **Step 7: Rewrite the Checkout handoff recipe for v4**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md`, replace the whole `### Checkout handoff` recipe (lines 496–520, from the heading through the `See the [SDK SPEC for checkout handoff details]…` line):

  ````md
  ### Checkout handoff

  Capture attribution on landing and carry it onto outbound offer links:

  ```html
  <script src="https://api-prod.goldenhippo.io/sdk/v4/gh.js"
          data-key="gh_pk_internal_gundry_abc123"
          data-brand="Gundry MD"
          data-checkout-base="https://checkout.gundrymd.com"
          data-cookie-domain=".gundrymd.com"></script>

  <a data-gh-checkout="bio3-3p-sub">Buy now</a>
  ```

  On click the link navigates to the destination's own URL with `?order_form_id=…&sessionid=…&utm_source=…&subid1=…` appended, carrying the attribution captured from the landing URL. `data-checkout-base` is the brand-level fallback for destinations Salesforce has no URL for.

  The programmatic twin is **async**:

  ```js
  const url = await window.gh.checkoutUrl('bio3-3p-sub');
  window.location.href = url;
  ```

  `window.open(await …)` inside a click handler is popup-blocked; see [Session, attribution, and events](#session-attribution-and-events) for the resolution order, the full outbound parameter set, and the new-tab workaround — and the [SDK SPEC](./SPEC.md#checkout-handoff) for the contract.
  ````

- [ ] **Step 8: Update the `window.gh` surface block**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md`, replace the fenced `ts` block under `### \`window.gh\` surface` (lines 542–556):

  ```ts
  window.gh.data.funnel(slugOrId):      Promise<HippoShopFunnelDTO>;
  window.gh.data.destination(slugOrId): Promise<HippoShopDestinationDTO>;
  window.gh.data.product(slugOrId):     Promise<HippoShopProductDTO>;

  window.gh.bind(rootElement):    Promise<void>;
  window.gh.refresh():            Promise<void>;

  window.gh.checkoutUrl(slug):    Promise<string>;   // composed outbound URL for a destination
  window.gh.track('Page View'):   Promise<void>;     // re-emit a Page View (dedupe-guarded)
  window.gh.session.id():         string | undefined; // current hippo_session_id cookie value
  window.gh.session.params():     ParsedParams | null; // attribution parsed from the landing URL

  window.gh.format: FormatRegistry; // see the Formatters section
  window.gh.debug?: boolean;        // set to true when data-debug="true" on the script tag
  ```

  and replace the paragraph directly beneath it (line 558) with these two paragraphs:

  ```md
  `checkoutUrl` and `track` are **stable function identities** — capturing one (`const buy = window.gh.checkoutUrl`, a GTM variable, a React prop) is safe. They read live session state through a thunk rather than closing over a snapshot, so a captured reference behaves identically to a fresh property read for the life of the page. `session.id()` and `session.params()` return `undefined` / `null` until `gh:session-ready` fires.

  The promises returned by `gh.data.*` resolve with **enriched** payloads. Products in particular gain the `<tier>List` and `<tier>ByQuantity` sibling fields described under [Loops](#loops) and [Declarative scope](#declarative-scope-data-with) — the same shape your declarative bindings see.
  ```

- [ ] **Step 9: Add `gh:session-ready` to the Lifecycle events section**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md`, replace lines 595–602 (the heading, the "Two events fire" line, and the two-row table):

  ````md
  ## Lifecycle events

  Three events fire on `window` during boot:

  | Event | When |
  |-------|------|
  | `gh:data-ready` | The synchronous setup is done — `window.gh.data`, `bind`, `refresh`, and `format` are attached. Fires before the first bind pass. |
  | `gh:bindings-ready` | The initial bind pass has completed, including all initial fetches. Fires **once** per page lifetime. |
  | `gh:session-ready` | Session resolution has settled — on success **and** on swallowed failure, so it always fires. `event.detail` is `{ sessionId: string, adopted: boolean, params: ParsedParams }`, where `adopted` is `true` when the id came from `?sessionid=` on this page load. Fires **once** per page lifetime. |

  `gh:session-ready` is the hook to use when your own analytics need the session id — it is the only point at which `window.gh.session.id()` is guaranteed to be populated:

  ```js
  window.addEventListener('gh:session-ready', (event) => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'gh_session', sessionId: event.detail.sessionId });
  }, { once: true });
  ```

  A successful session POST is **not** a precondition: the event fires with a resolved `sessionId` even when the network call failed, because the id itself is resolved client-side.
  ````

- [ ] **Step 10: Document the two POST endpoints and what the SDK actually sends**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md`, replace the Endpoints intro and table (lines 656–666):

  ```md
  ### Endpoints

  The three resource reads share one shape; v4 adds two write endpoints:

  | Method | URL | Purpose |
  |--------|-----|---------|
  | `GET` | `<base>/public/v1/funnel/<slugOrId>` | Returns `HippoShopFunnelDTO` |
  | `GET` | `<base>/public/v1/destination/<slugOrId>` | Returns `HippoShopDestinationDTO` |
  | `GET` | `<base>/public/v1/product/<slugOrId>` | Returns `HippoShopProductDTO` |
  | `POST` | `<base>/public/v1/session` | Registers this visit's attribution. Body is `{ "affParameters": { …attribution, "sessionId": "<id>" } }`. Fires once per page load. Empty values are **omitted**, never sent as `""` — the server treats every key present as authoritative, so a blank would erase real stored attribution. |
  | `POST` | `<base>/public/v1/funnel-event` | The `Page View` funnel event. Sent with `keepalive: true` and an `X-GH-Event-Id: <uuid>` correlation header. Never retried. |

  `<slugOrId>` is URL-encoded before insertion. Product responses arrive with `<tier>List` and `<tier>ByQuantity` fields already populated server-side.
  ```

  Then replace line 676:

  ```md
  The SDK does not send credentials (cookies are not included), does not set a `User-Agent` beyond the browser default, and does not send any analytics or PII.
  ```

  with:

  ```md
  The three `GET` reads send no credentials. The session `POST` sends `credentials: 'include'` so the API can maintain its own session cookie; the funnel-event `POST` does not, and adds `X-GH-Event-Id`. No request carries PII — the payloads are URL attribution parameters, a session id, and a browser / OS / device string derived from the user agent. The SDK sets no `User-Agent` beyond the browser default.
  ```

- [ ] **Step 11: Correct the "read-only, no analytics" claim in Safety**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/README.md`, replace line 750:

  ```md
  The SDK is read-only by design. It sends no analytics, no PII, and never executes data as code.
  ```

  with:

  ```md
  The SDK never executes data as code and never sends PII. It is **not** read-only as of v4: it posts this visit's attribution to `/public/v1/session` and one `Page View` funnel event to `/public/v1/funnel-event`. [HTTP](#http) lists exactly what leaves the page; [Session, attribution, and events](#session-attribution-and-events) explains why. Everything below still holds — the rendering path is unchanged.
  ```

- [ ] **Step 12: Cut the documented CDN line from v3 to v4**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && \
    sed -i '' 's#/sdk/v3/gh\.js#/sdk/v4/gh.js#g' packages/sdk/README.md packages/sdk/SPEC.md && \
    sed -i '' 's#For context on v1\.x/v2\.x → v3#For context on v1.x/v2.x/v3.x → v4#' packages/sdk/README.md packages/types/README.md && \
    sed -i '' 's#That covers the active CDN URL (`/sdk/v4/gh.js`), the frozen v1 URL (`/sdk/v1/gh.js`), and local-dev paths.#That covers the active CDN URL (`/sdk/v4/gh.js`), the frozen `/sdk/v3/gh.js` and `/sdk/v1/gh.js` URLs, and local-dev paths.#' packages/sdk/README.md
  ```

  The first `sed` rewrites the three occurrences left in the README (quickstart, the fallback-locator prose, and both halves of the base-URL derivation sentence — the checkout recipe was already cut to v4 by Step 7) plus one in `SPEC.md`'s boot example. The second updates the version-context note in both package READMEs. The third fixes the sentence that names the frozen line by name, which the blanket substitution would otherwise leave claiming v1 is the only frozen URL. That sentence is the **one** deliberate `sdk/v3` mention left in the README — Step 31 asserts it survives.

- [ ] **Step 13: Insert the session-identity section into `SPEC.md`**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, insert the following **immediately before** the `## Checkout handoff` heading at line 71:

  ````md
  ## Session identity and inbound `?sessionid=`

  ### Resolution ladder

  The SDK resolves exactly one session id per page load, in this order:

  1. **`?sessionid=` on the current URL.** The key is matched **case-sensitively** — `?SessionId=` and `?SESSIONID=` are ignored. The value is trimmed and validated against `SESSION_ID_PATTERN`. On a pass it is adopted **even when the `hippo_session_id` cookie already holds a different value**, and written back to the cookie. On a fail the SDK logs a warning and falls through to step 2.
  2. **The `hippo_session_id` cookie.** Used verbatim; not rewritten.
  3. **A newly minted id** — `crypto.randomUUID()`, falling back to an RFC-4122 v4 assembled from `crypto.getRandomValues`. If neither is available the SDK throws rather than falling back to `Math.random()`.

  ```
  SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
  ```

  The charset is not incidental. An adopted value flows into a `document.cookie` write, into a query string on every outbound link, and into a server-side session key. `;`, `=`, `,`, and whitespace are excluded because consumers downstream write the value into `document.cookie` **unencoded**, where any of those characters would terminate the value and let the remainder be parsed as cookie attributes.

  ### Cookie contract

  | Attribute | Value |
  |---|---|
  | Name | `hippo_session_id` |
  | Value | The resolved session id |
  | `Max-Age` | `2592000` (30 days) |
  | `Path` | `/` |
  | `Domain` | `data-cookie-domain` when set; else the auto-detected registrable root (`.brand.com`); host-only when neither resolves |
  | `SameSite` | `Lax` |
  | `Secure` | Set when the page is `https:` |

  Root-domain scoping is deliberate: it is what makes a handoff between two hosts under one registrable domain (`sf.brand.com` → `www.brand.com`) work without depending on the URL. A blocked or failed cookie write is non-fatal — the id still resolves for this page load and still travels on outbound links.

  ### The SDK trusts the inbound URL

  **Adopting a session id supplied in a URL is session fixation, and it is intentional.** Anyone who can get a visitor to open a link of their choosing decides which session id that visitor's page load reports.

  The blast radius is **analytics only**. The commerce session this id keys holds attribution — UTM values, click ids, affiliate and offer ids. It is not an authentication credential, it authorizes nothing, it carries no payment or cart state, and it is never accepted in place of a login. The realistic abuse is polluting attribution reporting, not taking over an account.

  Three mitigations bound it, and all three are contract:

  1. **`SESSION_ID_PATTERN`.** The value cannot carry cookie-attribute delimiters, control characters, or more than 128 characters, so it cannot break out of the cookie, the query string, or the session key it lands in.
  2. **The adoption is logged in debug mode.** With `data-debug="true"` the SDK emits `[gh] session: adopting ?sessionid= handoff <id>` before the cookie write, and `[gh] session: ignoring malformed ?sessionid= handoff param` when validation rejects one. Either line names the mechanism in the console of the page that used it.
  3. **This section.** The behaviour is published rather than implicit, so an integrator sees it before shipping.

  The posture is scoped to the pilot. A durable rule — "a URL-supplied id wins at most once per id per browser" — needs persistent state the SDK has nowhere clean to keep, and is deferred rather than dismissed.

  The resolved id is readable via `window.gh.session.id()` and is carried on `gh:session-ready` together with an `adopted` flag that is `true` exactly when step 1 supplied it — see [Lifecycle events](#lifecycle-events).
  ````

- [ ] **Step 14: Retire the superseded Cluster F cookie table**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, replace the block at lines 109–114:

  ```md
  ### Cookies managed by the SDK (Cluster F)

  | Name | Lifetime | Domain | Owner |
  |---|---|---|---|
  | `sessionId` | 30 days | Auto-detected root domain or `data-cookie-domain` | SDK (writes on first visit) |
  | `connect.sid` | API-controlled | Set by API with `Domain=.brand.com` | API (SDK only reads) |
  ```

  with:

  ```md
  ### Cookies managed by the SDK

  The SDK writes exactly one cookie, `hippo_session_id`. Its full contract — name, attributes, scope, and the ladder that fills it — is in [Session identity and inbound `?sessionid=`](#session-identity-and-inbound-sessionid).

  The SDK does **not** read, write, or reason about `connect.sid`. That cookie is `httpOnly` and belongs to the API, so `document.cookie` can never observe it; any logic conditioned on its presence is dead code by construction.
  ```

- [ ] **Step 15: Add `data-gh-step` and `data-gh-funnel-id` to the SPEC's declarative attribute set**

  `SPEC.md` is the contract the README's new section links to for the details, so the two new attributes have to exist here too. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, replace line 53:

  ```md
  - `data-gh-checkout="<destination-slug>"` — marks the element as a checkout-handoff control. On `<a>` elements, the SDK populates `href` with the composed outbound checkout URL. On other elements (`<button>`, `<div>`, etc.), the SDK attaches a `click` handler that navigates the page to the composed URL. See [Checkout handoff](#checkout-handoff) for full details.
  ```

  with:

  ```md
  - `data-gh-checkout="<destination-slug>"` — marks the element as a checkout-handoff control. On `<a>` elements, the SDK populates `href` with the composed outbound checkout URL. On other elements (`<button>`, `<div>`, etc.), the SDK attaches a `click` handler that navigates the page to the composed URL. See [Checkout handoff](#checkout-handoff) for full details.
  - `data-gh-step="<step-slug>"` — names the funnel step reported on the `Page View` funnel event. Accepted on any element **and** on the SDK `<script>` tag; a page element wins over the script tag. Read from the live DOM at emit time, never snapshotted at boot, so changing it is how a single-page app reports a new step. See [Write calls: session and funnel events](#write-calls-session-and-funnel-events).
  - `data-gh-funnel-id="<salesforce-id>"` — supplies the funnel's Salesforce ID directly, for pages that bind no destination. Ignored when a bound destination already yields one. Accepted on any element and on the SDK `<script>` tag. See [Write calls: session and funnel events](#write-calls-session-and-funnel-events).
  ```

  Neither attribute participates in the [Evaluation order](#evaluation-order) list — they carry no binding scope and write nothing into the DOM.

- [ ] **Step 16: Rewrite the composed outbound URL contract for v4**

  This block is still the v3 contract: it names `session_id` and `sub_id1`, and it knows only two base sources. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, replace lines 75–84 (from the paragraph under `### \`data-gh-checkout="<destination-slug>"\`` through the `Pre-existing query keys…` paragraph):

  ```md
  Marks the element as a checkout-handoff control. On `<a>` elements, the SDK populates `href` with the composed outbound checkout URL. On other elements (`<button>`, `<div>`, etc.), the SDK attaches a `click` handler that navigates the page to the composed URL.

  The composed URL is `<base>?order_form_id=<id>&session_id=<sid>&...session-params`, where:

  - `<base>` is `destination.pricing.checkoutOverrideUrl` if set, else the `data-checkout-base` script-tag attribute.
  - `order_form_id` is `destination.pricing.orderFormId`.
  - `session_id` is the SDK's `sessionId` cookie value (empty until `gh:session-ready` fires).
  - `utm_*` and `sub_id1`–`sub_id5` come from the parsed landing URL (omitted if empty).

  Pre-existing query keys on the base URL are preserved; SDK-added keys do not clobber author-supplied ones. If no base URL is configured (no `data-checkout-base` AND no `checkoutOverrideUrl`), the SDK sets `href="#"` and logs a debug warning.
  ```

  with:

  ```md
  Marks the element as a checkout-handoff control. On `<a>` elements, the SDK populates `href` with the composed outbound checkout URL. On other elements (`<button>`, `<div>`, etc.), the SDK attaches a `click` handler that navigates the page to the composed URL.

  **Base resolution — three sources, first one present wins:**

  | Order | Source | When it applies |
  |---|---|---|
  | 1 | `destination.pricing.checkoutOverrideUrl` | Per-destination override on the DTO |
  | 2 | `destination.url` | The destination's own absolute URL. The normal case |
  | 3 | `data-checkout-base` on the script tag | Brand-level fallback for destinations Salesforce has no URL for |

  **Appended parameters**, in this order, each omitted when its value is empty:

  `order_form_id` (from `destination.pricing.orderFormId`), `sessionid` (the resolved session id — see [Session identity](#session-identity-and-inbound-sessionid)), `utm_source`, `utm_medium`, `utm_campaign`, `utm_campaign_id`, `utm_content`, `utm_term`, `utm_chat`, `utm_action`, `off_id`, `aff_id`, `subid1`, `subid2`, `subid3`, `subid4`, `subid5`, `landing_url`, `referral_url`, `sales_funnel`, the seven raw click-ids (`fbclid`, `gclid`, `ScCid`, `qclid`, `twclid`, `ndclid`, `wbraid`), then `origdsidOrig` and `origsplitTestingFunnelIdOrig` forwarded verbatim from the current URL.

  The key is `sessionid` — one word, lowercase, matching the inbound handoff key the SDK itself reads. Affiliate sub-ids are `subid1`–`subid5`, not `sub_id1`–`sub_id5`.

  Pre-existing query keys on the base URL are preserved; SDK-added keys do not clobber author-supplied ones. Values are never truncated. If none of the three base sources yields a URL, the SDK sets `href="#"` on `[data-gh-checkout]` elements and logs a debug warning; `gh.checkoutUrl()` rejects with a `config` `GhError` instead (see [Error contract](#error-contract)).
  ```

- [ ] **Step 17: Rewrite the SPEC's script-tag attributes subsection**

  In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, replace lines 86–89:

  ```md
  ### Script-tag attributes (Cluster F additions)

  - `data-checkout-base="https://checkout.brand.com"` — required if any page on this brand uses `[data-gh-checkout]` or `gh.checkoutUrl()` without per-destination overrides. Optional otherwise.
  - `data-cookie-domain=".brand.com"` — optional explicit override for the brand's root cookie domain. When absent, the SDK auto-detects via the safe-TLD allowlist: `com, net, org, io, app, dev, ai, co, us, store, shop`. Multi-part TLDs (`.co.uk`, `.com.au`) require this attribute.
  ```

  with:

  ```md
  ### Script-tag attributes

  - `data-checkout-base="https://checkout.brand.com"` — brand-level fallback base URL, source 3 of the ladder above. Required only if a page uses `[data-gh-checkout]` or `gh.checkoutUrl()` against destinations that carry neither a `checkoutOverrideUrl` nor a `url`. Optional otherwise.
  - `data-cookie-domain=".brand.com"` — optional explicit `Domain` for the `hippo_session_id` cookie. When absent, the SDK auto-detects the registrable root via the safe-TLD allowlist: `com, net, org, io, app, dev, ai, co, us, store, shop`. Multi-part TLDs (`.co.uk`, `.com.au`, `.co.jp`) require this attribute; without it the cookie falls back to host-only and the cross-subdomain handoff stops working.
  - `data-gh-step` / `data-gh-funnel-id` — also accepted on the script tag as page-wide defaults for funnel events. See [Write calls: session and funnel events](#write-calls-session-and-funnel-events).
  ```

- [ ] **Step 18: Make `checkoutUrl` async in the SPEC and document `gh.track`**

  The closure-capture warning describes v3 behaviour that v4 inverts: the identity is now stable and the function is async. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, replace lines 91–95:

  ```md
  ### `window.gh.checkoutUrl(slug: string): string`

  Returns the composed checkout URL for the destination identified by `slug`, without navigating. Throws if the destination is not yet cached or if no base URL is configured.

  **Important — closure-capture gotcha:** Always call `window.gh.checkoutUrl(slug)` directly on each use. Do NOT cache the function reference, e.g., `const fn = window.gh.checkoutUrl; fn('slug')`. The SDK swaps the underlying closure when the session resolves so subsequent calls pick up the real `session_id` — a cached reference would keep returning URLs with an empty `session_id` indefinitely.
  ```

  with:

  ````md
  ### `window.gh.checkoutUrl(slug: string): Promise<string>`

  Resolves with the composed checkout URL for the destination identified by `slug`, without navigating. It awaits session resolution and fetches the destination when it is not already cached, so it can never resolve with a URL whose `sessionid` or attribution is silently missing. Rejects with a `config` `GhError` when no base URL resolves, and with the usual data-layer `GhError` codes when the destination fetch fails.

  **The function identity is stable.** Capturing the reference — `const buy = window.gh.checkoutUrl`, a GTM variable, a React prop — is supported. The function reads live session state through a thunk rather than closing over a snapshot, so a captured reference behaves identically to a fresh property read for the life of the page. This reverses the v3 rule and is one of the reasons v4 is a major.

  **Awaiting inside a click handler breaks the user-gesture chain**, so `window.open(await window.gh.checkoutUrl(slug))` is popup-blocked in every major browser. Assign `window.location.href` instead, or resolve the URL before the click and keep the handler synchronous. The README carries the worked example.

  ### `window.gh.track(eventType: 'Page View'): Promise<void>`

  Emits a funnel event programmatically, for single-page apps whose route change does not alter the DOM in a way the `MutationObserver` catches. `'Page View'` is the only accepted event type in v4; any other value rejects with `bad_request`.

  It honours the same per-page-load dedupe guard as the automatic emit — keyed on the session id, the event type, and the step — so calling it without first changing `data-gh-step` is a deliberate no-op, not an error. Resolves (never rejects) when the event is dropped for a missing funnel ID. See [Write calls: session and funnel events](#write-calls-session-and-funnel-events).
  ````

- [ ] **Step 19: Correct the session accessors and the `gh:session-ready` detail shape**

  `params` is no longer nullable-on-skip and the detail no longer carries `hasConnectSid`. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, replace lines 97–107:

  ```md
  ### `window.gh.session.id(): string | undefined`

  Returns the current `sessionId` cookie value, or `undefined` if `gh:session-ready` hasn't fired yet.

  ### `window.gh.session.params(): ParsedParams | null`

  Returns the session parameters parsed from the landing URL and posted to `/session` during this visit, or `null` when the SDK skipped the POST (e.g., `connect.sid` cookie was already present).

  ### Event: `gh:session-ready`

  Fires on `window` after `ensureSession` resolves (success or graceful failure). `event.detail` is `{ sessionId: string, hasConnectSid: boolean, params: ParsedParams | null }`. Useful for page authors who fire analytics events that need the session ID.
  ```

  with:

  ```md
  ### `window.gh.session.id(): string | undefined`

  Returns the resolved session id — the value of the `hippo_session_id` cookie — or `undefined` before `gh:session-ready` fires.

  ### `window.gh.session.params(): ParsedParams | null`

  Returns the attribution parsed from the landing URL for this visit. `null` only before session resolution settles; after `gh:session-ready` it is always an object, empty when the landing URL carried no attribution at all. It is **not** gated on the session POST succeeding — parsing is client-side.

  ### Event: `gh:session-ready`

  Fires once on `window` after session resolution settles, on success **and** on swallowed failure. `event.detail` is `{ sessionId: string, adopted: boolean, params: ParsedParams }`:

  | Field | Type | Meaning |
  |---|---|---|
  | `sessionId` | `string` | The resolved id. Always populated — the id resolves client-side, so a failed session POST does not blank it |
  | `adopted` | `boolean` | `true` exactly when the id came from `?sessionid=` on this page load, i.e. step 1 of the [resolution ladder](#session-identity-and-inbound-sessionid) |
  | `params` | `ParsedParams` | The attribution parsed from the landing URL. Never `null` on this event |

  There is no `hasConnectSid` field. `connect.sid` is `httpOnly`, so the SDK could never observe it — see [Cookies managed by the SDK](#cookies-managed-by-the-sdk).
  ```

- [ ] **Step 20: Add the write-call section to the SPEC**

  The SDK now writes. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, insert the following between the closing line of the bookkeeping-markers section (line 126, `These markers are part of the contract — they will not change in a minor release.`) and the `## Formatters` heading at line 128:

  ````md
  ## Write calls: session and funnel events

  v4 makes two `POST`s. Both are fire-and-forget: a failure degrades attribution and never surfaces as a rejected promise to page code, and neither one blocks rendering or binding.

  ### `POST <base>/public/v1/session`

  Registers this visit's attribution against the Commerce API's session. Sent once per page load, after the session id resolves.

  | | |
  |---|---|
  | Body | `{ "affParameters": { …attribution, "sessionId": "<id>" } }` |
  | Credentials | `credentials: 'include'` — the API maintains its own session cookie on this call |
  | Empty values | **Omitted**, never sent as `""`. Every key present is treated as authoritative upstream, so a blank would erase stored attribution |
  | Failure | Swallowed. `gh:session-ready` still fires with a resolved `sessionId` |

  ### `POST <base>/public/v1/funnel-event` — `Page View`

  Exactly **one** `Page View` per page load, however many destinations the page binds. Six offers on a selector are six variants of one page view.

  | | |
  |---|---|
  | Headers | `X-GH-Event-Id: <uuid>` correlation header, in addition to the standard `X-GH-Key` / `X-GH-Brand` |
  | Transport | `keepalive: true`, so the event survives page unload |
  | Retries | **None**, including on `429`. A rate-limited event is a lost event, not a delayed one |
  | Credentials | Not sent. The body is self-sufficient for attribution |

  **Identity is read from the live DOM at emit time**, not snapshotted at boot:

  | Source | Supplies |
  |---|---|
  | `data-gh-destination` / `data-gh-checkout` | The funnel and destination Salesforce IDs, out of the `HippoShopDestinationDTO` the page already fetched (`funnelId` and `id`). First match in document order wins, and `data-gh-destination` beats `data-gh-checkout` |
  | `data-gh-step` | The funnel step slug. A page element wins over the SDK `<script>` tag |
  | `data-gh-funnel-id` | The funnel Salesforce ID directly, for pages that bind no destination. Ignored when a bound destination already supplies one |

  **No funnel ID, no event.** If neither a bound destination nor `data-gh-funnel-id` yields one, the event is dropped rather than sent with a blank ID — an event with a blank funnel ID is discarded upstream anyway. With `data-debug="true"` the drop is logged with its reason.

  **Timing.** The event fires once session resolution and the first bind pass have both settled, plus a short quiet window so late-injected attributes land in the same event rather than producing a second one.

  **Dedupe.** One guard per page load, keyed on session id + event type + step. It applies to the automatic emit and to [`gh.track`](#windowghtrackeventtype-page-view-promisevoid) alike, which is why changing `data-gh-step` is the precondition for a second event.
  ````

- [ ] **Step 21: Bring the Programmatic API and Lifecycle events lists in line**

  Both lists still describe the v3 signatures. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, replace lines 161–163:

  ```md
  - `window.gh.checkoutUrl(slug: string): string` — returns the composed checkout URL for the destination identified by `slug`, without navigating. Throws if the destination is not yet cached or if no base URL is configured. See [Checkout handoff](#checkout-handoff) for the closure-capture gotcha.
  - `window.gh.session.id(): string | undefined` — returns the current `sessionId` cookie value, or `undefined` if `gh:session-ready` hasn't fired yet.
  - `window.gh.session.params(): ParsedParams | null` — returns the session parameters parsed from the landing URL and posted to `/session` during this visit, or `null` when the SDK skipped the POST.
  ```

  with:

  ```md
  - `window.gh.checkoutUrl(slug: string): Promise<string>` — resolves with the composed checkout URL for the destination identified by `slug`, without navigating. Awaits session resolution and fetches the destination if needed. Rejects with a `config` `GhError` when no base URL resolves. The function identity is stable and safe to capture. See [Checkout handoff](#checkout-handoff).
  - `window.gh.track(eventType: 'Page View'): Promise<void>` — emits a funnel event programmatically, subject to the per-page-load dedupe guard. See [Write calls: session and funnel events](#write-calls-session-and-funnel-events).
  - `window.gh.session.id(): string | undefined` — returns the resolved session id (the `hippo_session_id` cookie value), or `undefined` before `gh:session-ready` fires.
  - `window.gh.session.params(): ParsedParams | null` — returns the attribution parsed from the landing URL; `null` only before session resolution settles.
  ```

  Then replace line 174:

  ```md
  - **`gh:session-ready`** — fired once after `ensureSession` resolves (success or graceful failure). Payload: `CustomEvent` with `detail: { sessionId: string, hasConnectSid: boolean, params: ParsedParams | null }`. Useful for page authors who fire analytics events that need the session ID.
  ```

  with:

  ```md
  - **`gh:session-ready`** — fired once per page lifetime after session resolution settles (success or swallowed failure). Payload: `CustomEvent` with `detail: { sessionId: string, adopted: boolean, params: ParsedParams }`. `adopted` is `true` exactly when the id arrived via `?sessionid=`. This is the only point at which `window.gh.session.id()` is guaranteed to be populated, so it is the hook for page-owned analytics.
  ```

- [ ] **Step 22: Correct the `config` error row and the deprecated-surface note**

  The `config` row still describes two base sources, and the deprecation section still speaks as v3. In `/Users/stevenhall/Code/hippo-shop/packages/sdk/SPEC.md`, replace line 197:

  ```md
  | `config` | Runtime configuration error — `gh.checkoutUrl()` or `data-gh-checkout` binding cannot compose a URL because no checkout base URL is configured (script tag has no `data-checkout-base` AND the destination DTO has no `checkoutOverrideUrl`). Thrown by `gh.checkoutUrl()`; `[data-gh-checkout]` elements fall back to `href="#"` instead of throwing. |
  ```

  with:

  ```md
  | `config` | Runtime configuration error — `gh.checkoutUrl()` or a `data-gh-checkout` binding cannot compose a URL because **none** of the three base sources resolved: the destination DTO has no `pricing.checkoutOverrideUrl`, no `url`, and the script tag has no `data-checkout-base`. `gh.checkoutUrl()` rejects with it; `[data-gh-checkout]` elements fall back to `href="#"` instead. |
  ```

  Then replace lines 218–222:

  ```md
  ## Deprecated surface

  None in v3.0.0.

  Historical note: pre-v3 SDK builds carried a client-side shim (`enrichProduct`) that built `*List` and `*ByQuantity` fields from legacy DTO arrays. v3 removed both the legacy DTO arrays and the shim — the SDK is now a thin pass-through for product responses.
  ```

  with:

  ```md
  ## Deprecated surface

  None in v4.0.0. Two v3 surfaces were **removed** rather than deprecated, which is what makes v4 a major:

  - `window.gh.checkoutUrl(slug): string` is now `Promise<string>`. A v3 caller that used the return value directly receives a `Promise` where it expected a string. The v3 closure-capture warning is also retired — the identity is stable now.
  - The `sessionId` cookie is replaced by `hippo_session_id`. Nothing reads the old name, so a visitor carrying only the v3 cookie is treated as new on their first v4 page load.

  Historical note: pre-v3 SDK builds carried a client-side shim (`enrichProduct`) that built `*List` and `*ByQuantity` fields from legacy DTO arrays. v3 removed both the legacy DTO arrays and the shim — the SDK is now a thin pass-through for product responses.
  ```

- [ ] **Step 23: Document destination identity and URL in the types README**

  In `/Users/stevenhall/Code/hippo-shop/packages/types/README.md`, replace the opening of the `HippoShopDestinationDTO` example (lines 83–88):

  ```json
  {
    "slug": "multi-vitamin-3pack-sub",
    "name": "3-Pack Subscription",
    "description": "3 bottles delivered every 90 days. Cancel anytime.",
    "funnelSlug": "multi-vitamin-funnel",
    "pricing": {
  ```

  with:

  ```json
  {
    "id": "a0D0m000002Dst1EAC",
    "slug": "multi-vitamin-3pack-sub",
    "name": "3-Pack Subscription",
    "description": "3 bottles delivered every 90 days. Cancel anytime.",
    "funnelId": "a0F0m000002Fnl1EAC",
    "funnelSlug": "multi-vitamin-funnel",
    "url": "https://www.example.com/multi-vitamin-3pack-sub",
    "pricing": {
  ```

  Then add this immediately after that example's closing fence (currently line 119), before the `### HippoShopProductDTO` heading:

  ```md
  Three of those fields exist because the SDK cannot derive them:

  | Field | Type | What it is |
  |-------|------|------------|
  | `id` | `string` | Salesforce ID of the destination. |
  | `funnelId` | `string` | Salesforce ID of the funnel this destination resolves to — the same funnel `funnelSlug` names. |
  | `url` | `string \| null` | Absolute landing URL for the destination. `null` when Salesforce has none; callers then fall back to their own configured checkout base. |

  Everything else in the public contract is slug-keyed. These are the deliberate exception: together with `HippoShopFunnelStepDTO.id` they carry the record identity a funnel-event payload needs (`funnelSTFId`, `mainFunnelId`, `destinationId`, `funnelSTPId`) out of a destination fetch a page is already making. All three are **required** on the DTO — `url` is nullable, but the key is always present.
  ```

- [ ] **Step 24: Document the funnel-step `id` in the types README**

  In `/Users/stevenhall/Code/hippo-shop/packages/types/README.md`, replace the `steps` array of the `HippoShopFunnelDTO` example (lines 70–76):

  ```json
    "steps": [
      { "stepNumber": 1, "slug": "vsl", "name": "Video Sales Letter", "kind": "landing" },
      { "stepNumber": 2, "slug": "checkout", "name": "Order Form", "kind": "order-form" },
      { "stepNumber": 3, "slug": "discount-bump", "name": "10% Off Bump", "kind": "bump" },
      { "stepNumber": 4, "slug": "upsell-3mo", "name": "3-Month Upsell", "kind": "upsell" },
      { "stepNumber": 5, "slug": "thank-you", "name": "Thank You", "kind": "thank-you" }
    ]
  ```

  with:

  ```json
    "steps": [
      { "id": "a0P0m000002Stp1EAC", "stepNumber": 1, "slug": "vsl", "name": "Video Sales Letter", "kind": "landing" },
      { "id": "a0P0m000002Stp2EAC", "stepNumber": 2, "slug": "checkout", "name": "Order Form", "kind": "order-form" },
      { "id": "a0P0m000002Stp3EAC", "stepNumber": 3, "slug": "discount-bump", "name": "10% Off Bump", "kind": "bump" },
      { "id": "a0P0m000002Stp4EAC", "stepNumber": 4, "slug": "upsell-3mo", "name": "3-Month Upsell", "kind": "upsell" },
      { "id": "a0P0m000002Stp5EAC", "stepNumber": 5, "slug": "thank-you", "name": "Thank You", "kind": "thank-you" }
    ]
  ```

  Then insert a sentence between that example's closing fence (line 78) and the next heading. Current text:

  ````md
  ```

  ### `HippoShopDestinationDTO`
  ````

  Replacement:

  ````md
  ```

  `HippoShopFunnelStepDTO.id` is the step's Salesforce ID — required, and the counterpart to `HippoShopDestinationDTO.funnelId`. A consumer matches a step by `slug` and reads `id` off it.

  ### `HippoShopDestinationDTO`
  ````

- [ ] **Step 25: Read the live Kong route and service config for the public-v1 stack**

  ```bash
  KONG_ADMIN=<uat-gateway-admin-url> \
  curl -s "$KONG_ADMIN/routes/hippo-shop-public-v1" \
    | jq '{paths, strip_path, path_handling, methods, preserve_host}'
  curl -s "$KONG_ADMIN/services/hippo-shop-public-v1" \
    | jq '{protocol, host, port, path}'
  ```

  Record the four values that determine the rewrite: route `paths`, route `strip_path`, route `path_handling`, and service `path`. Steps 26–28 assert the standard OSS mechanism — route `paths: ["/public/v1"]` with `strip_path: on` and a service `path` of `/hippo-shop/v1`, which joins to the observed upstream `/hippo-shop/v1/product/x` and is the only plugin-free way to produce it on Kong OSS 3.9.1.

  **If the Admin API returns something else** — a `pre-function` plugin calling `kong.service.request.set_path`, a different `path_handling`, or a service path of `/hippo-shop` paired with a route path of `/public` — then edit the table rows in Step 27 and the "How the rewrite is done" paragraph in Step 28 to the values you just recorded. Those two edits are **not optional**; only their content is negotiable. The one outcome that is not acceptable is leaving the tables describing a pass-through the gateway does not perform.

- [ ] **Step 26: Correct the Kong doc's header line and At-a-glance diagram**

  In `/Users/stevenhall/Code/hippo-shop/docs/architecture/kong-public-routing.md`, replace line 3:

  ```md
  How the public `/public/v1/*` route is wired in Kong — the service, the route, the six plugins, and the order they run in. Companion to [`cloudflare-deploy.md`](./cloudflare-deploy.md), which covers the SDK delivery path (active: `/sdk/v3/gh.js`; frozen: `/sdk/v1/gh.js`).
  ```

  with:

  ```md
  How the public `/public/v1/*` routes are wired in Kong — the service, the path rewrite onto the Commerce API's internal `/hippo-shop/v1/*` mount, the read route's six plugins and the order they run in, and the two Cluster G write routes. Companion to [`cloudflare-deploy.md`](./cloudflare-deploy.md), which covers the SDK delivery path (active: `/sdk/v4/gh.js`; frozen: `/sdk/v3/gh.js` and `/sdk/v1/gh.js`).
  ```

  Then replace the diagram at lines 7–18. Current content:

  ```
  Embedding page                Kong (api-{uat,prod}.goldenhippo.io)         Commerce API (private)
  ────────────────────────  ─────────────────────────────────────────────  ────────────────────────
  GET /public/v1/product/x  ─►  Route /public/v1 matches                  ─►  GET /public/v1/product/x
  X-GH-Key: gh_pk_…             1.  cors           preflight + headers        X-Brand: Gundry MD
  X-GH-Brand: Gundry MD         2.  key-auth       gh_pk_* → consumer         (consumer headers from
  Origin: https://…             3.  rate-limiting  per-consumer 60/min         Kong: X-Consumer-Id,
                                4.  request-trans. rename X-GH-Brand→X-Brand   X-Consumer-Username)
                                5.  proxy-cache    serve hit / store miss
                                6.  response-trans. strip leak-prone headers
                                (response phase: cors adds Access-Control-*)
  ```

  Replacement:

  ```
  Embedding page                Kong (api-{uat,prod}.goldenhippo.io)            Commerce API (private)
  ────────────────────────  ────────────────────────────────────────────────  ──────────────────────────
  GET /public/v1/product/x  ─►  Route /public/v1 matches                     ─►  GET /hippo-shop/v1/product/x
  X-GH-Key: gh_pk_…             0.  path rewrite   strip /public/v1,             X-Brand: Gundry MD
  X-GH-Brand: Gundry MD             prepend service path /hippo-shop/v1          (consumer headers from
  Origin: https://…             1.  cors           preflight + headers            Kong: X-Consumer-Id,
                                2.  key-auth       gh_pk_* → consumer             X-Consumer-Username)
                                3.  rate-limiting  per-consumer 60/min
                                4.  request-trans. rename X-GH-Brand→X-Brand
                                5.  proxy-cache    serve hit / store miss
                                6.  response-trans. strip leak-prone headers
                                (response phase: cors adds Access-Control-*)
  ```

  Step 0 is not a plugin — it is route/service path configuration, applied before any plugin runs. It is numbered here only so the hop is visible in the same picture as the plugins.

- [ ] **Step 27: Correct the Service and Route tables to describe the rewrite, not a pass-through**

  These two rows are the source of the doc's central false claim: they say the path reaches the upstream unchanged, which no `/public/v1` request has ever done. The corrections are unconditional — the only variable is the values, per Step 25.

  In `/Users/stevenhall/Code/hippo-shop/docs/architecture/kong-public-routing.md`, replace the Service table's `Path` row (line 62):

  ```md
  | Path | *empty* — paths flow through unchanged |
  ```

  with:

  ```md
  | Path | `/hippo-shop/v1` — prepended to the stripped request path. This is where the Commerce API actually mounts these handlers; see [Path rewrite](#path-rewrite--publicv1--hippo-shopv1) |
  ```

  Then replace the Route table's `Strip Path` row (line 75):

  ```md
  | Strip Path | **off** | Upstream needs the full `/public/v1/…` path — that's where its handlers are mounted |
  ```

  with:

  ```md
  | Strip Path | **on** | Kong removes the matched `/public/v1` prefix before proxying, and the service `path` above supplies `/hippo-shop/v1` in its place. `/public` is not a path any Express router in the Commerce API answers |
  ```

  And replace the Route table's `Path Handling` row (line 77):

  ```md
  | Path Handling | `v0` (default) | Service has no path; v0/v1 behave identically here |
  ```

  with:

  ```md
  | Path Handling | `v0` (default) | The service now has a path. With `strip_path` on, the stripped remainder always begins with `/`, so `v0` and `v1` join service path + remainder to the same upstream path. Leave it at the default and confirm against the value recorded in Step 25 |
  ```

- [ ] **Step 28: Document the path rewrite and its coupling to `PUBLIC_SDK_PATH_PREFIX`**

  In `/Users/stevenhall/Code/hippo-shop/docs/architecture/kong-public-routing.md`, insert the following between the end of the `## Route` table (line 77) and the `## Plugin priorities (the order things run in)` heading (line 79):

  ````md
  ## Path rewrite — `/public/v1/*` → `/hippo-shop/v1/*`

  The public path and the upstream path are **not the same**. Kong rewrites one into the other.

  | Hop | Path |
  |---|---|
  | Browser → Kong | `/public/v1/product/bio-complete-3` |
  | Kong → Commerce API | `/hippo-shop/v1/product/bio-complete-3` |

  **Why the upstream path is `/hippo-shop`.** `HippoShopController.basePath = 'hippo-shop'` (`src/controllers/hippo-shop/HippoShop.controller.ts:12`) and its routes are declared as `/v1/product/:productSlugOrId`, `/v1/funnel/:funnelSlugOrId`, `/v1/destination/:destinationSlugOrId`. The controller mounts at `/hippo-shop`; `/public` is not a path any Express router in the Commerce API answers. The public prefix exists only at the edge.

  **How the rewrite is done.** Route `strip_path: on` with a service `path` of `/hippo-shop/v1`. Kong strips the matched route path `/public/v1` from the incoming path, leaving `/product/bio-complete-3`, then prepends the service path, yielding `/hippo-shop/v1/product/bio-complete-3`. No plugin is involved, and nothing in the request body or headers is touched. The [Service](#service) and [Route](#route) tables above carry exactly these two values.

  > **This documents behaviour that shipped before it was written down.** The rewrite has been live in UAT and production since the first `/public/v1` route was published. Earlier revisions of this file described a straight pass-through, which never matched the running gateway — the SDK calls `/public/v1/*` and works, and the only handlers that exist are at `/hippo-shop/v1/*`.

  ### `PUBLIC_SDK_PATH_PREFIX` is coupled to the rewrite target

  The Commerce API chooses which error shape to emit by prefix-matching the **upstream** path:

  ```ts
  // src/middleware/errorHandler.middleware.ts:15
  const PUBLIC_SDK_PATH_PREFIX = '/hippo-shop/'
  ```

  A request whose path starts with that prefix gets the public wire shape, `HippoShopErrorDTO` — `{ code, message, retryAfterMs? }`. Everything else gets the internal `IError` shape — `{ status, name, message, fields }`.

  **If the rewrite target and that constant ever drift apart, nothing fails loudly.** Success responses are untouched, so a happy-path smoke test stays green. Only error responses change shape, and they change silently: they regress to the internal `IError`, which carries no `code` field, so the SDK's `body.code` lookup finds nothing and every error falls back to the status-derived code. A brand-authorization `403` stops being distinguishable from other `403`s, the deliberately-ambiguous `"Resource not found"` message is replaced by the raw internal message, and a body-supplied `retryAfterMs` is lost on `429`s. The SDK does not break; it just stops being able to tell errors apart.

  Keep this pair in step — changing either is a change to both:

  | Side | Value | Where |
  |---|---|---|
  | Kong rewrite target | `/hippo-shop/v1/…` | Service `path` + route `strip_path`, above |
  | Commerce prefix test | `/hippo-shop/` | `errorHandler.middleware.ts:15` |

  Step 8 of the smoke test below is the check that catches drift.
  ````

- [ ] **Step 29: Document the two Cluster G write routes**

  In `/Users/stevenhall/Code/hippo-shop/docs/architecture/kong-public-routing.md`, insert the following between the end of the `## 6. response-transformer` section (the paragraph ending `Don't list nested paths here and assume they're stripped.`, line 190) and the `## Verification — the consolidated smoke test` heading (line 192):

  ````md
  ## Write routes — `POST /public/v1/session` and `POST /public/v1/funnel-event`

  The route above is read-only. SDK v4 adds two `POST` surfaces. They are **separate Kong routes with their own plugin stacks**: do not widen the read route's `methods` to include `POST`, and do not attach `proxy-cache` to either of these.

  ### `POST /public/v1/session`

  Registers a visit's attribution against the Commerce API's session.

  | Field | Value | Why |
  |---|---|---|
  | Upstream | `POST /hippo-shop/v1/session` | Same rewrite as the read routes. The handler lives on `HippoShopController` (already `disableAuth = true` and brand-scoped) — **not** on the authenticated `SessionController` at the app root. Configuring this against `/session` would 404, and if it resolved it would expose an auth-protected controller |
  | Methods | `POST, OPTIONS` | |
  | `cors.credentials` | `true` | The API maintains its own session cookie on this call, so the SDK posts with `credentials: 'include'` |
  | `cors.origins` | Explicit list, including the Superfunnel subdomain (e.g. `https://sf.gundrymd.com`) | **Wildcards are illegal with `credentials: true`** — a browser rejects `Access-Control-Allow-Origin: *` on a credentialed request |
  | `cors.headers` | `X-GH-Key, X-GH-Brand, Accept, Content-Type` | Same as the read route |
  | `key-auth` | `key_names: X-GH-Key`, `hide_credentials: true`, `run_on_preflight: false` | Same contract as the read route |
  | `request-transformer` | `rename.headers: X-GH-Brand:X-Brand` | Same bridge as the read route |
  | `proxy-cache` | **not attached** | |

  **Confirm Kong strips inbound `X-Domain` on this route.** `gh-service-utils` sets the session cookie's domain from that request header with no allowlist, so an attacker-supplied `X-Domain` on a public POST is a cookie-scope injection.

  ### `POST /public/v1/funnel-event`

  Forwards a `Page View` funnel event to Altern. This route does not reach the Commerce API at all.

  | Field | Value | Why |
  |---|---|---|
  | Upstream | Altern, service path `/funnel/stats/save/` — **both** slashes | The trailing slash is part of the path |
  | `strip_path` | **on** | The public path contributes nothing upstream |
  | Methods | `POST, OPTIONS` | |
  | Timeouts | `5000` ms connect / write / read | Matches the funnel proxy's `UPSTREAM_TIMEOUT_MS` |
  | Injected headers | `X-Brand` and `Content-Type: application/json;charset=UTF-8` | **No space before `charset`** — the exact string is pinned by an upstream spec assertion. **No Authorization, no API key, no `X-Domain`** — a strictly smaller set than the sibling funnel proxy sends |
  | `cors.credentials` | `false` | A `Cookie` header cannot survive a cross-site request to a different registrable domain anyway — which is precisely why the event body has to be self-sufficient for attribution |
  | `cors.headers` | `X-GH-Key, X-GH-Brand, X-GH-Event-Id, Accept, Content-Type` | The SDK sends `X-GH-Event-Id: <uuid>` as a correlation header; omit it here and the preflight fails |
  | `proxy-cache` | **not attached** | |

  The SDK never retries this call, **including on `429`**. A rate-limited event is a lost event, not a delayed one.

  ### Rate limiting — size this before the pilot, not after

  This is the single item most likely to break the Superfunnel pilot. The documented route default is `minute: 60`, `limit_by: consumer`, and **one publishable key is shared by every page of a brand** — a single bucket for all of that brand's traffic.

  One offer-selector page load costs roughly **eight requests**: six destination `GET`s (six distinct slugs, so the SDK's request cache cannot dedupe them), one session `POST`, one funnel-event `POST`. Against a 60/min bucket that is about **seven page loads per minute for the entire brand.**

  `proxy-cache` does not relieve it. Rate limiting runs in the access phase, before proxy-cache, so cache hits still spend quota — see [Plugin priorities](#plugin-priorities-the-order-things-run-in), consequence 2.

  Required:

  - An elevated per-consumer tier well above the `minute: 300` example in [3. rate-limiting](#3-rate-limiting).
  - `limit_by: ip` on both write routes, so one visitor cannot exhaust a brand-wide bucket.
  - Remember the local-policy multi-dyno math: the effective limit is `dynos × configured`.

  Follow-up rather than pilot scope: six sequential destination `GET`s per page is an N+1 shape. A batch destination endpoint would cut a page load from eight requests to three. Flagged here because the tier is being sized against the unbatched number.
  ````

- [ ] **Step 30: Add the error-shape drift check to the smoke test**

  In `/Users/stevenhall/Code/hippo-shop/docs/architecture/kong-public-routing.md`, add this block inside the smoke-test fenced script, immediately after step 7's `done | sort | uniq -c` line:

  ```bash

  # 8) Unknown slug with a valid key → 404 in the PUBLIC error shape, not the internal one
  curl -s "${H_CORS[@]}" "${H_AUTH[@]}" "$BASE/public/v1/product/no-such-slug-xyz"
  ```

  Add this row to the "Expected outcomes" table, after the row for step 7:

  ```md
  | 8 | Body is exactly `{"code":"not_found","message":"Resource not found"}`. A body carrying `status` / `name` / `fields` means the rewrite target and `PUBLIC_SDK_PATH_PREFIX` have drifted — see [Path rewrite](#path-rewrite--publicv1--hippo-shopv1) |
  ```

  And add this row to the "Common failure modes" table, after the `Upstream sees X-GH-Brand instead of X-Brand` row:

  ```md
  | SDK reports `server` for every API error and never `not_found` / `forbidden`; `retryAfterMs` is always `null` | The rewrite target no longer starts with `/hippo-shop/`, so `errorHandler.middleware.ts:15` emits the internal `IError` shape and the SDK finds no `body.code` |
  ```

- [ ] **Step 31: Verify every claim landed, and that the built docs bundle carries it**

  **(a) The new v4 content is present in all four documents.** Each `grep -c` must print a non-zero count, and the two `grep -n` calls must each print their heading line:

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && \
    grep -c "Three events fire\|gh:session-ready\|hippo_session_id\|?sessionid=\|data-gh-step\|data-gh-funnel-id\|window.open\|data-checkout-base\|data-cookie-domain" packages/sdk/README.md && \
    grep -n "^## Session identity and inbound" packages/sdk/SPEC.md && \
    grep -n "^## Write calls: session and funnel events" packages/sdk/SPEC.md && \
    grep -c "SESSION_ID_PATTERN\|session fixation\|analytics only\|adopting ?sessionid= handoff" packages/sdk/SPEC.md && \
    grep -c "hippo_session_id\|subid1\|destination.url\|Promise<string>\|gh.track\|adopted" packages/sdk/SPEC.md && \
    grep -c "funnelId\|\"url\"\|a0P0m000002Stp1EAC" packages/types/README.md && \
    grep -c "hippo-shop/v1\|PUBLIC_SDK_PATH_PREFIX\|funnel-event\|/public/v1/session" docs/architecture/kong-public-routing.md
  ```

  **(b) No page is still told to load v3, but the historical mentions survive.** These are two different questions and the earlier draft of this step conflated them — Step 12 *deliberately* keeps a `sdk/v3` mention (the frozen-URL sentence), so a blanket `sdk/v3` ban can never pass. Check the live `src=` separately from the prose:

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && \
    grep -rn 'src="[^"]*sdk/v3' packages/sdk/README.md packages/sdk/SPEC.md; \
    grep -c 'sdk/v4/gh.js' packages/sdk/README.md packages/sdk/SPEC.md; \
    grep -c 'sdk/v3' packages/sdk/README.md packages/sdk/SPEC.md packages/types/README.md docs/architecture/kong-public-routing.md; \
    grep -n 'the frozen `/sdk/v3/gh.js` and `/sdk/v1/gh.js` URLs' packages/sdk/README.md; \
    grep -n 'frozen: `/sdk/v3/gh.js` and `/sdk/v1/gh.js`' docs/architecture/kong-public-routing.md
  ```

  Expected output, exactly:

  - The first `grep -rn` prints **nothing** and exits 1 — no `<script src=…>` anywhere still points at v3.
  - The second prints `packages/sdk/README.md:4` and `packages/sdk/SPEC.md:1` — the quickstart tag, the fallback-locator sentence, the checkout recipe tag, and the base-URL derivation sentence in the README; the boot example in the SPEC.
  - The third prints `packages/sdk/README.md:1`, `packages/sdk/SPEC.md:0`, `packages/types/README.md:0`, `docs/architecture/kong-public-routing.md:1` — exactly two surviving `sdk/v3` mentions repo-wide, both of them the frozen-URL prose.
  - The last two `grep -n` calls each print **one** line: the README's fallback-locator sentence (its line number has shifted from 137 by the insertions above it) and `3:` in the Kong doc. Zero hits from either means Step 12's third `sed` or Step 26 did not land and the frozen line was lost.

  **(c) No retired v3 claim survives.** This grep must print **nothing** and exit 1, which is why it is `;`-separated. `connect.sid` and `sessionId` are deliberately absent from the list — Step 14 keeps a `connect.sid` sentence on purpose, and `sessionId` remains as the `gh:session-ready` detail field and the session POST body key:

  ```bash
  cd /Users/stevenhall/Code/hippo-shop; \
    grep -rn 'Two events fire\|sends no analytics\|Cookies managed by the SDK (Cluster F)\|Script-tag attributes (Cluster F additions)\|hasConnectSid\|sub_id1\|session_id\|closure-capture\|sessionId` cookie value\|None in v3.0.0\|paths flow through unchanged\|Upstream needs the full' \
    packages/sdk/README.md packages/sdk/SPEC.md packages/types/README.md docs/architecture/kong-public-routing.md
  ```

  **(d) The published documentation bundle carries the README edits:**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && \
    pnpm --filter @goldenhippo/hippo-shop-sdk build && \
    grep -c "Session, attribution, and events\|hippo_session_id\|popup-blocked\|funnelId" packages/sdk/dist/llms-full.txt
  ```

  `build-llms` must log `wrote …/llms-full.txt` and the count must be non-zero — `dist/llms-full.txt` is the concatenation of both READMEs that ships to `/sdk/v4/llms-full.txt`, so a zero there means the README edits are not in the published documentation bundle.

- [ ] **Step 32: Commit**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && \
  git add packages/sdk/README.md packages/sdk/SPEC.md packages/types/README.md docs/architecture/kong-public-routing.md && \
  git commit -m "docs: document the v4 surface across SDK, types, and Kong routing

  README: the session/attribution/events section — the hippo_session_id cookie,
  the ?sessionid= inbound handoff, data-gh-step and data-gh-funnel-id,
  gh.track('Page View'), and the async gh.checkoutUrl including the window.open
  popup-blocker constraint and the window.location.href alternative (spec D8
  requires that be in the README specifically). data-checkout-base and
  data-cookie-domain are promoted into the script-tag config table,
  gh:session-ready joins the lifecycle events, and the 'read-only, no analytics'
  claim is corrected — v4 posts a session and a funnel event.

  SPEC: brought to the v4 contract, not just extended. New session-identity
  section covering the D1 ladder, SESSION_ID_PATTERN, and the fact that the SDK
  trusts and adopts a URL-supplied id — that note is one of D1's three named
  mitigations for accepting session fixation, so it is required, not editorial.
  The v3 body is rewritten to match: the outbound param set is sessionid and
  subid1-5 (not session_id / sub_id1) with base resolution through
  destination.url, checkoutUrl is async with a stable identity instead of the
  closure-capture gotcha, gh:session-ready carries { sessionId, adopted, params }
  with no hasConnectSid, gh.track and the two write calls are documented, and the
  Cluster F cookie table naming sessionId and connect.sid is retired. Without
  this the README's new text linked readers to a spec describing v3.

  types: destination id, funnelId and url, and the funnel-step id — the record
  identity a funnel event needs out of a fetch the page already makes.

  kong-public-routing: the /public/v1/* -> /hippo-shop/v1/* rewrite has been
  live since the first public route shipped and was never written down; the doc
  described a pass-through the gateway has never performed. The Service Path and
  Route Strip Path rows now say what Kong actually does instead of contradicting
  the prose beneath them. Adds the two write routes, and pins the coupling to
  PUBLIC_SDK_PATH_PREFIX (errorHandler.middleware.ts:15) — if the prefix drifts
  from the rewrite, success responses stay green while error responses silently
  regress to the internal IError shape and the SDK's body.code parsing finds
  nothing."
  ```

---

### Task 42: ROADMAP correction, and ship as one PR superseding #17

**Files:**
- Modify: `/Users/stevenhall/Code/hippo-shop/ROADMAP.md` — delete the Cluster F entry (lines 39–48 plus its trailing blank line 49) from `## Done`; add a Cluster G entry to `## Open items`
- Modify: `/Users/stevenhall/Code/hippo-shop/docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md` — lines 334 and 346, the `ROADMAP.md:98` citation
- Modify: `/Users/stevenhall/Code/hippo-shop/docs/superpowers/plans/2026-08-18-cluster-g-superfunnel-pilot.md` — line 19, the same citation (this commit also adds the plan file itself if no earlier task tracked it)
- Create: `/tmp/cluster-g-pr-body.md` — PR body, deliberately outside the repo, not committed
- Test: none. Prose and repo state; verified by `grep`, `git ls-tree`, and `gh pr view`, as in Task 27.

**Interfaces:**
- Consumes: every prior task's commits on `feat/cluster-g-superfunnel-pilot`; PR #17 (`OPEN`, draft, `feat/cluster-f-session-utm-checkout-handoff` → `main`)
- Produces: one PR `feat/cluster-g-superfunnel-pilot` → `main` on `GoldenHippoMedia/hippo-shop`; PR #17 `CLOSED` with a superseding comment; `ROADMAP.md` carrying zero Cluster F entries and one `Status: in-progress` Cluster G entry

**Decision — fold F into G rather than move it back to Open.** Two entries would imply two pickups. There is only one: `feat/cluster-g-superfunnel-pilot` is branched off F, so F's commits reach `main` inside this PR, corrected, and Task 32 already deleted F's two changesets. Every acceptance criterion an F backlog entry would carry (`subId1='fb'`, `session_id`, the `sessionId` cookie, the `connect.sid` gate) is a behaviour Cluster G replaces — restoring it to Open would restore a spec that is known wrong. Note the two divergent copies this collapses: `origin/main:ROADMAP.md:35` still lists Cluster F as `Status: idea` under Open items, while the branch copy (commits `369de0e`, `9bd587a`) claims `done`. Merging this PR resolves both to a single Cluster G entry.

- [ ] **Step 1: Pre-flight — `hippo-shop` tree is clean, on the right branch, with Tasks 1–41 committed**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git branch --show-current && git status --porcelain && git ls-files --error-unmatch packages/sdk/src/events.ts packages/sdk/src/session.ts packages/sdk/src/checkout.ts packages/sdk/src/url-params.ts packages/sdk/test/helpers/cookie-jar.ts .changeset/cluster-g-sdk-superfunnel-pilot.md .changeset/cluster-g-types-destination-identity.md > /dev/null && echo "tracked OK" && ls .changeset/cluster-f-* 2>/dev/null; echo "cluster-f changesets: $(ls .changeset/cluster-f-* 2>/dev/null | wc -l | tr -d ' ')"
  ```

  Expect `feat/cluster-g-superfunnel-pilot`, then **no output** from `git status --porcelain` (an unstaged file here means a prior task did not commit — stop and finish it), then `tracked OK`, then `cluster-f changesets: 0` (Task 32 removed them). If `git ls-files --error-unmatch` errors with `did not match any file(s) known to git`, the named task did not run.

- [ ] **Step 2: Pre-flight — the commerce worktree is clean and on its own branch**

  ```bash
  cd /Users/stevenhall/Code/HippoPackages/GH-Commerce-Service-cluster-g && git branch --show-current && git status --porcelain
  ```

  Expect `feat/cluster-g-hippo-shop-session-destination-url` and no further output. Tasks 33–39 ship as a **separate** PR against `prerelease` — nothing from that worktree belongs in the PR opened below — but they must be committed before this one opens, because the PR body sequences them.

- [ ] **Step 3: Run the full gate before anything is pushed**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && pnpm build && pnpm test && pnpm lint && pnpm typecheck && pnpm size
  ```

  All five targets green. `pnpm size` is `pnpm --filter @goldenhippo/hippo-shop-sdk size`. Do not open the PR on red.

- [ ] **Step 4: Verify the wrong ROADMAP claim, and that `main` really lacks the code**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && awk 'NR>=39 && NR<=42' ROADMAP.md; git fetch origin --quiet; git ls-tree --name-only origin/main packages/sdk/src/ | grep -E 'session|checkout|cookies|url-params'; gh pr view 17 --json state,url -q '.state + "  " + .url'
  ```

  Note the `;` separators — the middle command is expected to exit 1. Expect exactly:

  ```
  ### Cluster F — SDK session, UTM, and checkout handoff
  Status: done
  Added: 2026-05-17
  Shipped: 2026-05-19 (PR #17)
  OPEN  https://github.com/GoldenHippoMedia/hippo-shop/pull/17
  ```

  The `git ls-tree | grep` prints nothing: `origin/main:packages/sdk/src/` holds only `bindings.ts`, `cache.ts`, `client.ts`, `config.ts`, `errors.ts`, `format.ts`, `index.ts`, `log.ts`, `path.ts`, `runtime.ts`. `session.ts`, `checkout.ts`, `cookies.ts` and `url-params.ts` have never been on `main`. That plus `OPEN` is the whole case: `Status: done` / `Shipped:` is false on both counts.

- [ ] **Step 5: Delete the Cluster F entry from `## Done`**

  In `/Users/stevenhall/Code/hippo-shop/ROADMAP.md`, delete this entire block (lines 39–48) **and the blank line that follows it**, so that `## Done` is followed directly by the `### SDK v3.0.1` entry:

  ```md
  ### Cluster F — SDK session, UTM, and checkout handoff
  Status: done
  Added: 2026-05-17
  Shipped: 2026-05-19 (PR #17)

  Adds a session/UTM/checkout-handoff layer to the SDK. On landing, the SDK parses UTM and click-id query params (v1 click-id registry has fbclid → subId1='fb', subId5=<value>; the registry is extensible), POSTs them to `/public/v1/session` wrapped in `affParameters` (gated on absence of `connect.sid` cookie), and manages a 30-day `sessionId` cookie at the brand's auto-detected root domain. New `data-gh-checkout` attribute on `<a>` / `<button>` / arbitrary elements composes outbound URLs with `order_form_id`, `session_id`, and the captured params; `gh.checkoutUrl(slug)` is the programmatic equivalent. `gh:session-ready` event lets page authors hook into session resolution. Every failure mode is non-fatal — the page never breaks.

  Has hard API-side prerequisites (new `/public/v1/session` Kong route, root-domain `Set-Cookie` for `connect.sid`, CORS-with-credentials) called out in the spec as parallel work.

  Related: `docs/superpowers/specs/2026-05-19-cluster-f-session-utm-checkout-handoff-design.md`, `docs/superpowers/plans/2026-05-19-cluster-f-session-utm-checkout-handoff.md`, PR #17
  ```

  The F spec and plan files stay on disk — they are the record of what was tried. Only the backlog entry goes, because the file's own preamble makes this document "the single source of truth for 'what's next'", and a `done` entry for unshipped code is the one thing it cannot be allowed to say.

- [ ] **Step 6: Add the Cluster G entry to `## Open items`**

  In `/Users/stevenhall/Code/hippo-shop/ROADMAP.md`, immediately after the Cluster E v2 paragraph ending `Coming-soon callout on the lander already points at this.` and immediately before the `---` that opens `## Done`, insert a blank line and this block:

  ```md
  ### Cluster G — Superfunnel.ai pilot: session handoff, funnel events, destination links
  Status: in-progress
  Added: 2026-08-18

  Golden Hippo is piloting [Superfunnel.ai](https://superfunnel.ai), which hosts funnel pages on a subdomain of the brand's root domain (e.g. `sf.gundrymd.com`) and embeds the Hippo Shop SDK. Cluster G realigns the SDK's session and attribution layer with `hippo-builder-funnel`, the canonical implementation: `hippo_session_id` cookie at the registrable root domain, UUID v4 ids, a three-step resolution ladder (inbound `?sessionid=` → cookie → mint), and an unconditional session POST carrying `affParameters.sessionId`. Adds `Page View` funnel events — the 36-field payload, `keepalive` POST to `/public/v1/funnel-event`, deduped per page load, gated on a resolvable funnel id — plus `data-gh-step`, `data-gh-funnel-id`, and `gh.track('Page View')`. `data-gh-checkout` now resolves through the destination's absolute `url`, so binding an offer navigates the visitor to that destination with attribution attached, and `gh.checkoutUrl(slug)` becomes async. Both packages cut as v4: a clean break with no compatibility shims, since the 3.x line has no production consumers.

  Subsumes Cluster F (SDK session, UTM, and checkout handoff), which this file recorded as `done` on 2026-05-19. It was not done: PR #17 never merged, `main` has never carried `cookies.ts`, `url-params.ts`, `session.ts` or `checkout.ts`, and no npm version ever shipped them. F is folded into this entry rather than moved back to Open because nothing separable is left to pick up — `feat/cluster-g-superfunnel-pilot` is branched off F, F's commits reach `main` inside the single Cluster G PR, and every behaviour an F backlog item would have described is replaced here: the click-id mapping (`subId1='fb'` with the value in `subId5` — the slots reversed, and a literal no platform emits), the `session_id` / `sub_idN` outbound spelling, the `sessionId` cookie name and its 12-digit id, and the `connect.sid` gate that read an `httpOnly` cookie JS cannot see. PR #17 closes as superseded and F's two changesets are deleted.

  The `GH-Commerce-Service` half ships as its own PR from `feat/cluster-g-hippo-shop-session-destination-url` (off `prerelease`): a public `POST /hippo-shop/v1/session` route on the already-unauthenticated `HippoShopController`, destination identity pass-through (`id`, `funnelId`, step `id`) from a payload the serializer already fetched and discarded, and the destination's absolute URL via a brand-scoped SOQL query that degrades to `url: null` rather than failing the response.

  Release ordering is load-bearing. The `gh-hippo-shop-sdk-v4` Cloudflare Pages project and the Kong `/sdk/v4/*` route must exist *before* the SDK publish — the v3 cut failed on exactly this. `@goldenhippo/hippo-shop-types@4.0.0` must publish *before* the commerce pin bump, and in the commerce repo the pin bump (`^3.0.0` → `^4.0.0`) and the Zod schema change must be one commit or `tsc` fails. 3.x is npm-deprecated afterwards, following the 1.x/2.x precedent.

  Kong work is parallel and owned outside these repos: the `/public/v1/session` and `/public/v1/funnel-event` routes, and a rate-limit tier sized for the offer selector's ~8 requests per page load (six destination `GET`s, one session `POST`, one event `POST`) against a documented 60/min per-consumer default.

  Related: `docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md`, `docs/superpowers/plans/2026-08-18-cluster-g-superfunnel-pilot.md`, PR #17 (superseded)
  ```

  It stays `in-progress`, not `done`, until `@goldenhippo/hippo-shop-sdk@4.0.0` is actually on npm and serving from `/sdk/v4/gh.js`. Marking an entry `done` at PR-open time is precisely the error being corrected here.

- [ ] **Step 7: Re-anchor the `ROADMAP.md:98` citations, which the deletion moved**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && LINE=$(grep -n 'per-major CDN URL convention' ROADMAP.md | cut -d: -f1) && sed -i '' "s/ROADMAP\.md:98/ROADMAP.md:$LINE/g" docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md docs/superpowers/plans/2026-08-18-cluster-g-superfunnel-pilot.md && echo "re-anchored to $LINE"
  ```

  Expect `re-anchored to 103`. Three occurrences move: spec lines 334 and 346, plan line 19. All three cite the Cluster B paragraph as the evidence that a v3 CDN deploy failed for want of a Pages project — a citation that silently points at the wrong line is worse than none, and this is the release constraint the whole v4 cut hangs on.

- [ ] **Step 8: Verify the ROADMAP edits**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && grep -c 'Cluster F' ROADMAP.md; grep -n 'ROADMAP\.md:98' docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md docs/superpowers/plans/2026-08-18-cluster-g-superfunnel-pilot.md; grep -n '^### Cluster G\|^Status: in-progress\|^## Done' ROADMAP.md; sed -n '103p' ROADMAP.md | cut -c1-72
  ```

  Expect, in order: `0` (no Cluster F entry survives); **nothing** from the stale-citation grep (exit 1); then

  ```
  35:### Cluster G — Superfunnel.ai pilot: session handoff, funnel events, destination links
  36:Status: in-progress
  53:## Done
  ```

  and finally `Removed the four deprecated variant array fields from `HippoShopProduc` — confirming line 103 is the Cluster B paragraph the re-anchored citations now name.

- [ ] **Step 9: Commit the correction**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git add ROADMAP.md docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md docs/superpowers/plans/2026-08-18-cluster-g-superfunnel-pilot.md && git commit -m "docs: ROADMAP — Cluster F was never shipped; fold it into Cluster G

  The entry claimed 'Status: done / Shipped: 2026-05-19 (PR #17)'. PR #17 is
  still open and origin/main has never contained session.ts, checkout.ts,
  cookies.ts or url-params.ts. Folded into a new in-progress Cluster G entry
  rather than moved back to Open: G is branched off F and carries its commits
  to main in one PR, F's changesets are already deleted, and every behaviour a
  restored F entry would have specified is one G replaces.

  Re-anchored the three ROADMAP.md:98 citations in the Cluster G spec and plan
  to the line the deletion moved the Cluster B paragraph to."
  ```

  If the plan file is still untracked at this point, this commit adds it — required, because both the ROADMAP entry and the PR body reference its path. If an earlier task already committed it, `git add` is a no-op.

- [ ] **Step 10: Push the branch**

```bash
cd /Users/stevenhall/Code/hippo-shop && git push -u origin feat/cluster-g-superfunnel-pilot
```

  The branch has no remote yet — `origin` currently holds only `main`, `changeset-release/main`, and `feat/cluster-f-session-utm-checkout-handoff`.

- [ ] **Step 11: Write the PR body**

```bash
cat > /tmp/cluster-g-pr-body.md <<'MD'
## Summary

Cluster G realigns the Hippo Shop SDK with Golden Hippo's canonical session and attribution model (`hippo-builder-funnel`) so Superfunnel.ai-hosted pages on a brand subdomain hand off to checkout with attribution intact, and adds `Page View` funnel events and destination-URL navigation on top.

**This supersedes #17 (Cluster F), which closes unmerged.** Cluster F built the first cut of this layer without access to the canonical table and guessed several contracts wrong. `feat/cluster-g-superfunnel-pilot` is branched off `feat/cluster-f-session-utm-checkout-handoff`, so this single PR carries corrected-F plus G to `main`. Nothing of either has ever been on `main` and no npm version shipped it, so there is nothing to migrate — merging a known-wrong implementation first and correcting it in the next release would buy nothing. `ROADMAP.md` recorded F as `done (PR #17)`; that entry is corrected here and folded into a Cluster G entry.

## Breaking — both packages cut as v4

No compatibility shims, dual-writes, or deprecation aliases: the 3.x line has no production consumers, so wrong behaviour is replaced rather than deprecated.

**`@goldenhippo/hippo-shop-types@4.0.0`**

- `HippoShopDestinationDTO` gains required `id` and `funnelId`, and `url: string | null` (the absolute landing URL; `null` when Salesforce has none, in which case callers fall back to their own configured checkout base).
- `HippoShopFunnelStepDTO` gains required `id`.
- Producers must supply all four. Consumers gain the identity a funnel-event payload needs (`funnelSTFId`, `mainFunnelId`, `destinationId`, `funnelSTPId`) from a destination fetch they were already making — the upstream Salesforce record carried every one and the serializer discarded them.
- Corrects the `HippoShopDestinationDTO` docblock, which claimed "Pre-Purchase only" after being pasted from `funnel.ts`.

**`@goldenhippo/hippo-shop-sdk@4.0.0`**

- `window.gh.checkoutUrl(slug)` is **async** — it returns `Promise<string>`, awaits session resolution and warms a cold destination, so it can no longer hand back an unattributed URL. `window.open(await gh.checkoutUrl(x))` inside a click handler breaks the user-gesture chain and will be popup-blocked; assign `window.location.href` instead.
- Outbound links emit `sessionid` (was `session_id`) and `subid1`…`subid5` (was `sub_id1`…`sub_id5`), plus `landing_url`, `referral_url`, `sales_funnel`, the seven raw click-ids, and `origdsidOrig` / `origsplitTestingFunnelIdOrig` forwarded from the current URL. A `?session_id=` handoff was silently ignored downstream, which showed up as duplicate sessions and orphaned attribution.
- The session cookie is `hippo_session_id` (was `sessionId`) and its value is a UUID v4 (was a 12-character numeric string).
- `?sessionid=` on the landing URL is validated and adopted over any existing cookie value.
- The session POST is unconditional and carries `affParameters.sessionId`, so the SDK's identifier and the server's `hippoSessionId` are the same value.
- Click-id mapping is the canonical seven-row table (`fbclid`, `gclid`, `ScCid`, `qclid`, `twclid`, `ndclid`, `wbraid`) with correct slot semantics. 3.x wrote `subId1='fb'` and the click value into `subId5` — the two slots reversed, and a literal no platform ever emits. Values are no longer truncated at 255 characters.
- `connect.sid` is never read or reasoned about: it is `httpOnly`, so the gate that read it was dead code. `gh:session-ready` detail is `{ sessionId, adopted, params }` — `hasConnectSid` is gone and `params` is never `null`.
- Requires `@goldenhippo/hippo-shop-types@4.x`. A new major means a new CDN line: `/sdk/v4/gh.js`.

## New

- `Page View` funnel events: the 36-field payload posted to `/public/v1/funnel-event` with `keepalive: true`, gated on a resolvable funnel id, deduped in memory per page load, every error swallowed.
- `data-gh-step` and `data-gh-funnel-id` attributes, and `window.gh.track('Page View')` as the programmatic escape hatch.
- `data-gh-checkout` resolves through `destination.url`, so binding an offer navigates the visitor to that destination with attribution attached.

## Fixed — latent defects in the unreleased 3.x line

- `gh.checkoutUrl` is one stable function identity reading the session through a thunk. It used to be installed as a stub and then *reassigned*, so any captured reference (a GTM variable, a React prop, `const f = gh.checkoutUrl`) composed URLs with no session id and no UTMs for the life of the page, silently.
- The `gh:session-ready` rebind listener is registered before `ensureSession` runs, so a synchronously-resolved session still triggers a rebind.
- `data-gh-checkout` slugs are collected as destination resources, both `data-gh-checkout` and `data-gh-step` are in the MutationObserver's `attributeFilter`, and a completed destination load schedules a rebind — checkout links no longer strand at `href="#"`.
- `SPEC.md` named `/session` where the client posts `/public/v1/session`.

## Release ordering — do not reorder

1. The `gh-hippo-shop-sdk-v4` Cloudflare Pages project and the Kong `/sdk/v4/*` route **must exist before** this merges and publishes. `wrangler@4 pages deploy` does not create the project in non-interactive CI; the v3 cut failed on exactly this and needed the rollforward in #10.
2. Merge here → `@goldenhippo/hippo-shop-types@4.0.0` and `@goldenhippo/hippo-shop-sdk@4.0.0` publish; the SDK deploys to `/sdk/v4/gh.js`.
3. **Only then** the `GH-Commerce-Service` PR (`feat/cluster-g-hippo-shop-session-destination-url`, off `prerelease`) bumps its types pin. The types release **gates** that work, and within it the pin bump (`^3.0.0` → `^4.0.0`) and the Zod schema change must be the **same commit** — `HippoShop.spec.ts:503-519` asserts bidirectional `Equals<z.infer<typeof ZHippoShopDestinationDTO>, HippoShopDestinationDTO>`, so either change alone fails `tsc`.
4. npm-deprecate the 3.x versions of both packages, following the 1.x/2.x precedent.

Genuinely parallel, owned outside these repos: the Kong `/public/v1/session` and `/public/v1/funnel-event` routes, and a rate-limit tier sized for the offer selector — roughly eight requests per page load (six destination `GET`s, one session `POST`, one event `POST`) against a documented 60/min per-consumer default, which is about seven page loads per minute for an entire brand. `proxy-cache` does not relieve it: rate limiting runs in the access phase, before the cache.

## Test plan

- [x] `pnpm build && pnpm test && pnpm lint && pnpm typecheck && pnpm size` — all green
- [x] `pnpm changeset status --verbose` lists both packages at major `4.0.0`, nothing at minor or patch
- [ ] **Post-merge, once the Kong routes and the commerce PR are live** — end-to-end handoff: land on a `sf.<brand>.com` page with `?sessionid=<known>` plus UTM parameters; confirm the cookie is written at `.<brand>.com`, the POST body carries the id inside `affParameters`, clicking an offer navigates to the destination URL, and the same id arrives as `?sessionid=` and is adopted rather than re-minted.
- [ ] **Post-merge** — UAT reconciliation: emit a known number of `Page View` events for a fixed session id and count the rows that land in Salesforce. A `200` through the chain is not evidence: the proxy forwards the body verbatim and Salesforce triggers drop unrecognised input silently.

Spec: `docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md`
Plan: `docs/superpowers/plans/2026-08-18-cluster-g-superfunnel-pilot.md`
MD
```

  The quoted heredoc (`<<'MD'`) is required — the body is dense with backticks and `$`-free but shell-expandable sequences.

- [ ] **Step 12: Open the PR**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && gh pr create --repo GoldenHippoMedia/hippo-shop --base main --head feat/cluster-g-superfunnel-pilot --title "feat: Cluster G — Superfunnel.ai pilot (v4 SDK + types, supersedes #17)" --body-file /tmp/cluster-g-pr-body.md
  ```

  Prints the new PR URL. Not `--draft`: #17 sat in draft for three months and that is part of how the ROADMAP came to claim it shipped.

- [ ] **Step 13: Record the new PR number in the ROADMAP entry**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && PR=$(gh pr view --json number -q .number) && sed -i '' "s/PR #17 (superseded)/PR #17 (superseded), PR #$PR/" ROADMAP.md && grep -n 'PR #17 (superseded)' ROADMAP.md
  ```

  Expect one line, `49:Related: ...cluster-g-superfunnel-pilot.md`, `PR #17 (superseded), PR #18`. The number will be `18` unless something else opened first — the sed derives it, so no assumption is baked in. This mirrors `9bd587a chore: fill in PR number in ROADMAP Cluster F entry`; the number cannot exist before the PR does.

- [ ] **Step 14: Commit the fill-in**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git add ROADMAP.md && git commit -m "chore: fill in the Cluster G PR number in ROADMAP"
  ```

- [ ] **Step 15: Push the fill-in**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && git push
  ```

- [ ] **Step 16: Comment on #17 explaining the supersession**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && PR=$(gh pr view --json number -q .number) && gh pr comment 17 --repo GoldenHippoMedia/hippo-shop --body "Superseded by #$PR — closing unmerged.

  Cluster F built the session, UTM, and checkout-handoff layer without the canonical table from \`hippo-builder-funnel\`. This branch's own spec said so at the time: of the click-id registry, \"adding more ships as a one-entry edit *once the canonical table is provided*.\" The table has now been read directly, and several contracts here turn out to be wrong:

  - the click-id mapping wrote \`subId1='fb'\` with the click value in \`subId5\` — the two slots reversed, and a literal no platform emits;
  - outbound links used \`session_id\` / \`sub_idN\` where the funnel model expects \`sessionid\` / \`subidN\`, so a \`?session_id=\` handoff was silently ignored downstream (duplicate sessions, orphaned attribution);
  - the cookie was \`sessionId\` holding a 12-character numeric id, not \`hippo_session_id\` holding a UUID v4;
  - the session POST was gated on the absence of \`connect.sid\` — an \`httpOnly\` cookie JS cannot read, so the gate was dead code reasoning about a value it never saw.

  Merging a known-wrong implementation and correcting it in the next release buys nothing when the 3.x line has no consumers. \`feat/cluster-g-superfunnel-pilot\` is branched off \`feat/cluster-f-session-utm-checkout-handoff\`, so #$PR carries corrected-F plus G to \`main\` as a single PR, cut as v4 for both packages.

  Nothing is lost by closing: every commit on this branch is an ancestor of the Cluster G branch, and the branch itself stays put. \`ROADMAP.md\` had recorded this as \`Status: done / Shipped: 2026-05-19 (PR #17)\`; #$PR corrects that and folds the entry into Cluster G.

  Design: \`docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md\`"
  ```

  Comment first, close second — a bare closed PR with no reason is how this repo lost track of #17's real state in the first place.

- [ ] **Step 17: Close #17**

  ```bash
  gh pr close 17 --repo GoldenHippoMedia/hippo-shop
  ```

  No `--delete-branch`: `feat/cluster-f-session-utm-checkout-handoff` is the base of the Cluster G branch and is referenced from the closing comment.

- [ ] **Step 18: Verify the final state**

  ```bash
  cd /Users/stevenhall/Code/hippo-shop && gh pr view 17 --repo GoldenHippoMedia/hippo-shop --json state,url -q '.state + "  " + .url'; gh pr view --json number,state,baseRefName,headRefName,title -q '"#\(.number)  \(.state)  \(.headRefName) -> \(.baseRefName)  \(.title)"'; grep -c 'Status: done' ROADMAP.md; grep -c 'Cluster F' ROADMAP.md; git status --porcelain
  ```

  Expect:

  ```
  CLOSED  https://github.com/GoldenHippoMedia/hippo-shop/pull/17
  #18  OPEN  feat/cluster-g-superfunnel-pilot -> main  feat: Cluster G — Superfunnel.ai pilot (v4 SDK + types, supersedes #17)
  5
  0
  ```

  `6` is the surviving `Status: done` count — SDK v3.0.1, Cluster C, npm deprecate v1.x/v2.x, Cluster A, Cluster E v1, Cluster B is six… count the `## Done` entries in the file after Step 5 and expect exactly that number, with **no** Cluster F among them; `0` confirms the fold. `git status --porcelain` prints nothing.

---

## Verification

Run in `/Users/stevenhall/Code/hippo-shop`:

```bash
pnpm build && pnpm test && pnpm lint && pnpm typecheck && pnpm size
```

Run in the commerce worktree:

```bash
npm run build && npx tsc --noEmit && npm run lint && npm test
```

Two acceptance steps that unit tests cannot replace:

1. **UAT reconciliation.** Emit a known number of `Page View` events for a fixed session id and count the rows that actually land in Salesforce. There is no validation anywhere on that path — the proxy forwards the body verbatim and Salesforce triggers drop unrecognised input silently — so a `200` through the whole chain is **not** evidence the row landed.
2. **End-to-end handoff.** Land on a `sf.brand.com` page with `?sessionid=<known>` plus UTM parameters. Confirm: the cookie is written at `.brand.com`; the POST body carries the id inside `affParameters`; clicking an offer navigates to the destination URL; the same id arrives as `?sessionid=` and is adopted rather than re-minted.

## Known open input

**Task 39's SOQL object name.** The URL field is confirmed as `TouchCRBase__Full_Generic_URL__c`. The sObject is inferred to be `TouchCRBase__Destination__c` from the lookup field of that name on `Campaign` (`Campaign.service.ts:52`), but destinations reach the service through an Apex REST route rather than SOQL, so nothing in either repo confirms it. A wrong object name is a runtime `INVALID_TYPE` on every destination request — six per offer-selector page load. Confirm before running that task.
