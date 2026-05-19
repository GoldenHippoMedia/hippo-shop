# Cluster F — SDK session, UTM, and checkout handoff: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session/UTM/checkout-handoff layer to the SDK so that funnel pages capture attribution on landing, persist it across pages via root-domain cookies + a POST to `/public/v1/session`, and apply it to outbound checkout URLs via a `data-gh-checkout` attribute and a `gh.checkoutUrl(slug)` programmatic API.

**Architecture:** Four new focused modules (`cookies.ts`, `url-params.ts`, `session.ts`, `checkout.ts`) plus minor wiring in `index.ts`, `runtime.ts`, `config.ts`, `client.ts`. One new optional field on `HippoShopPricingDTO`. All failure paths non-fatal; the page never breaks. Cookie domain is auto-detected with a conservative TLD allowlist, override via `data-cookie-domain`. Click-id mapping ships as a code-resident registry; v1 has one entry (`fbclid`).

**Tech Stack:** TypeScript strict, vitest + jsdom (existing SDK test pattern), `document.cookie` DOM API, global `fetch`, MutationObserver (existing hook). No new npm dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-19-cluster-f-session-utm-checkout-handoff-design.md`](../specs/2026-05-19-cluster-f-session-utm-checkout-handoff-design.md)

**Branch:** `feat/cluster-f-session-utm-checkout-handoff` (already created; spec committed as `2755dcf`).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/types/src/destination.ts` | Modify | Add `checkoutOverrideUrl: string \| null` to `HippoShopPricingDTO` |
| `.changeset/cluster-f-types-checkout-override.md` | Create | Minor changeset on `@goldenhippo/hippo-shop-types` |
| `packages/sdk/src/config.ts` | Modify | Parse `data-checkout-base` + `data-cookie-domain`; add to `GhConfig` |
| `packages/sdk/test/config.spec.ts` | Modify | New tests for the two new attrs |
| `packages/sdk/src/cookies.ts` | Create | `getCookieDomain` + `readCookie`/`writeCookie`/`deleteCookie` |
| `packages/sdk/test/cookies.spec.ts` | Create | Coverage for TLD allowlist, override, round-trips |
| `packages/sdk/src/url-params.ts` | Create | `ParsedParams` + `CLICK_ID_REGISTRY` + `parseLandingParams` |
| `packages/sdk/test/url-params.spec.ts` | Create | UTM, fbclid, precedence, truncation, control-char strip |
| `packages/sdk/src/client.ts` | Modify | Add `postJson` method with `credentials: 'include'` option |
| `packages/sdk/test/client.spec.ts` | Modify | New tests for the POST path |
| `packages/sdk/src/session.ts` | Create | `generateSessionId`, `ensureSession`, `getSessionState`, `gh:session-ready` |
| `packages/sdk/test/session.spec.ts` | Create | First-visit POST, skip when cookie present, error paths |
| `packages/sdk/src/checkout.ts` | Create | `composeCheckoutUrl` + `applyCheckoutBindings` + `checkoutUrl(slug)` |
| `packages/sdk/test/checkout.spec.ts` | Create | Composition logic + DOM binding behavior + programmatic API |
| `packages/sdk/src/index.ts` | Modify | Boot calls `ensureSession`; expose `gh.checkoutUrl` + `gh.session.*` |
| `packages/sdk/src/runtime.ts` | Modify | `bind()` calls `applyCheckoutBindings`; listens for `gh:session-ready` |
| `packages/sdk/test/index.spec.ts` | Modify | Verify session wired in boot; verify gh.* surface |
| `packages/sdk/test/runtime.spec.ts` | Modify | Verify bind pass writes checkout hrefs |
| `packages/sdk/SPEC.md` | Modify | Document new attributes, events, gh.* surface |
| `SPEC.md` | Modify | Mirror SDK SPEC updates at the root |
| `packages/types/SPEC.md` | Modify | Document the new DTO field |
| `packages/sdk/README.md` | Modify | Usage example for `data-gh-checkout` + script-tag attrs |
| `.changeset/cluster-f-sdk-session-handoff.md` | Create | Minor changeset on `@goldenhippo/hippo-shop-sdk` |
| `ROADMAP.md` | Modify | Move Cluster F from "Open items" to top of "Done" |

---

## Tasks

### Task 1: Types — add `checkoutOverrideUrl` to `HippoShopPricingDTO`

**Files:**
- Modify: `packages/types/src/destination.ts`
- Create: `.changeset/cluster-f-types-checkout-override.md`

- [ ] **Step 1: Add the new optional field to the DTO**

Open `packages/types/src/destination.ts`. Find the `HippoShopPricingDTO` interface. Add the new field at the end of the body, just before the closing brace:

```typescript
export interface HippoShopPricingDTO {
  familyOrBundleId: string;
  orderFormId: string;
  sku: string;
  packageQuantity: number;
  purchaseType: 'subscription' | 'one-time';
  frequency: HippoShopFrequencyDTO | null;
  price: HippoShopPriceDTO;
  rebillPrice: HippoShopPriceDTO | null;
  outOfStock: boolean;
  restrictedCountryCodes: string[];
  shipping: HippoShopShippingDTO;
  bumpOffers: HippoShopBumpOfferDTO[];
  /**
   * Optional override for the checkout base URL on handoff. When set,
   * overrides the brand-level `data-checkout-base`. `null` means use
   * the brand default. Added in Cluster F.
   */
  checkoutOverrideUrl: string | null;
}
```

Preserve every existing field. Only the new line and its JSDoc are added.

- [ ] **Step 2: Verify the types package typechecks**

Run from repo root:

```bash
pnpm nx typecheck types
```

Expected: clean. Last line includes `Successfully ran target typecheck for project types`.

- [ ] **Step 3: Verify SDK still typechecks (no consumer breakage)**

```bash
pnpm nx typecheck sdk
```

Expected: clean. The new field is required at the type level (no `?`), but every existing producer of `HippoShopPricingDTO` is in test fixtures and example HTML — TypeScript won't complain about JSON literals in HTML, and any test fixture creating the DTO will need updating. If typecheck FAILS here with errors like "Property 'checkoutOverrideUrl' is missing", proceed to step 4.

- [ ] **Step 4: Update any SDK test fixtures that construct `HippoShopPricingDTO`**

```bash
grep -rn "HippoShopPricingDTO\|purchaseType:\s*'subscription'\|purchaseType:\s*'one-time'" packages/sdk/test/ | head -20
```

For every test fixture that builds a `HippoShopPricingDTO` literal, add `checkoutOverrideUrl: null` near the end of the literal. Example pattern from existing tests (look for fixtures like `{ familyOrBundleId: '…', orderFormId: '…', sku: '…', … }` inside `packages/sdk/test/bindings.spec.ts` or `runtime.spec.ts`):

```typescript
// Before:
const pricing = {
  familyOrBundleId: 'fam1',
  orderFormId: 'of1',
  sku: 'sku1',
  // ...rest of existing fields...
  bumpOffers: [],
};

// After (one new line):
const pricing = {
  familyOrBundleId: 'fam1',
  orderFormId: 'of1',
  sku: 'sku1',
  // ...rest of existing fields...
  bumpOffers: [],
  checkoutOverrideUrl: null,
};
```

Re-run `pnpm nx typecheck sdk`. Expected: clean.

- [ ] **Step 5: Create the types changeset**

Create `.changeset/cluster-f-types-checkout-override.md` with this exact content:

```markdown
---
"@goldenhippo/hippo-shop-types": minor
---

Add optional `checkoutOverrideUrl: string | null` field to `HippoShopPricingDTO`.

When non-null, the SDK uses this URL as the base for the checkout handoff on
this destination, overriding the brand-level `data-checkout-base` script-tag
attribute. When `null`, the brand-level default is used. No producer impact —
APIs that don't supply the field can return `null`.

Part of Cluster F (SDK session, UTM, and checkout handoff).
```

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/destination.ts packages/sdk/test .changeset/cluster-f-types-checkout-override.md
git commit -m "feat(types): add checkoutOverrideUrl to HippoShopPricingDTO

Optional per-destination override of the checkout base URL on handoff.
When non-null, the SDK uses this URL instead of the brand-level
data-checkout-base attribute. When null, the brand default applies.

Producers (API) can return null when no override is in play; consumers
(SDK) treat null and absent equivalently via the spec's design contract.

Part of Cluster F (SDK session, UTM, and checkout handoff).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Config — parse `data-checkout-base` + `data-cookie-domain`

**Files:**
- Modify: `packages/sdk/src/config.ts`
- Modify: `packages/sdk/test/config.spec.ts`

- [ ] **Step 1: Write failing tests in `packages/sdk/test/config.spec.ts`**

Append these tests at the end of the existing `describe('parseScriptConfig', …)` block in `packages/sdk/test/config.spec.ts`:

```typescript
  it('parses data-checkout-base when present', () => {
    const s = makeScript({
      key: goodKey,
      brand: 'Gundry MD',
      'checkout-base': 'https://checkout.gundrymd.com',
      src: goodSrc,
    });
    expect(parseScriptConfig(s).checkoutBase).toBe('https://checkout.gundrymd.com');
  });

  it('returns null checkoutBase when data-checkout-base is absent', () => {
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', src: goodSrc });
    expect(parseScriptConfig(s).checkoutBase).toBeNull();
  });

  it('parses data-cookie-domain when present', () => {
    const s = makeScript({
      key: goodKey,
      brand: 'Gundry MD',
      'cookie-domain': '.gundrymd.com',
      src: goodSrc,
    });
    expect(parseScriptConfig(s).cookieDomain).toBe('.gundrymd.com');
  });

  it('returns null cookieDomain when data-cookie-domain is absent', () => {
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', src: goodSrc });
    expect(parseScriptConfig(s).cookieDomain).toBeNull();
  });
```

Note: The existing `makeScript` helper in `config.spec.ts` reads attrs from a plain object. Dataset keys with dashes (like `cookie-domain`) become camelCase via the DOM, but the existing helper sets them through `dataset[k] = v` — confirm this works for multi-segment names by reading the helper's implementation; if needed, update `makeScript` to handle hyphenated keys via `setAttribute('data-cookie-domain', v)` instead.

If the helper's behavior is unclear, replace its body with this exact implementation (preserves backward compat for single-word keys, handles hyphenated keys correctly):

```typescript
function makeScript(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'src') s.src = v;
    else s.setAttribute(`data-${k}`, v);
  }
  return s;
}
```

- [ ] **Step 2: Run tests; verify they fail**

Run:

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/config.spec.ts
```

Expected: 4 new tests fail with errors like `Cannot read properties of undefined (reading 'checkoutBase')` or `expected undefined to be null`. Existing tests still pass.

- [ ] **Step 3: Update `GhConfig` and `parseScriptConfig` in `packages/sdk/src/config.ts`**

Modify the `GhConfig` interface to add two new fields. Modify the bottom of `parseScriptConfig` to read them:

```typescript
export interface GhConfig {
  key: string;
  brand: string;
  debug: boolean;
  apiBaseUrl: string;
  /** Brand-level default for the checkout handoff base URL. `null` if not supplied. */
  checkoutBase: string | null;
  /** Explicit cookie domain (e.g., `.gundrymd.com`). `null` triggers auto-detect at cookie-write time. */
  cookieDomain: string | null;
}
```

And inside `parseScriptConfig`, change the existing `return` line at the bottom of the function:

```typescript
// Before:
return { key, brand: brand.trim(), debug, apiBaseUrl: parsed.origin };

// After:
const checkoutBase = (script.dataset['checkoutBase'] ?? '').trim() || null;
const cookieDomain = (script.dataset['cookieDomain'] ?? '').trim() || null;

return {
  key,
  brand: brand.trim(),
  debug,
  apiBaseUrl: parsed.origin,
  checkoutBase,
  cookieDomain,
};
```

The `.trim() || null` pattern means: empty string after trimming becomes `null`. So `<script>` with no attribute, or with `data-checkout-base=""`, or with `data-checkout-base="   "`, all give `null`.

- [ ] **Step 4: Re-run tests; verify all pass**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/config.spec.ts
```

Expected: all tests pass (4 new + existing). If any existing test now fails because it asserts the full `GhConfig` shape (e.g., `expect(c).toEqual({ key, brand, debug, apiBaseUrl })`), update those assertions to include `checkoutBase: null, cookieDomain: null`.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/config.ts packages/sdk/test/config.spec.ts
git commit -m "feat(sdk): parse data-checkout-base and data-cookie-domain config

Two new optional script-tag attributes added to GhConfig as
checkoutBase (string | null) and cookieDomain (string | null). Empty
or whitespace-only values normalize to null. Both default to null
when absent.

Consumed in subsequent commits: checkoutBase by checkout.ts for the
handoff URL composition fallback; cookieDomain by cookies.ts for
explicit override of the auto-detected root domain.

Part of Cluster F.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: cookies.ts — read/write/delete + domain auto-detect

**Files:**
- Create: `packages/sdk/src/cookies.ts`
- Create: `packages/sdk/test/cookies.spec.ts`

- [ ] **Step 1: Write failing tests in `packages/sdk/test/cookies.spec.ts`**

Create the file with this exact content:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCookieDomain,
  readCookie,
  writeCookie,
  deleteCookie,
  SAFE_TLDS,
} from '../src/cookies';
import type { GhConfig } from '../src/config';

function makeConfig(overrides: Partial<GhConfig> = {}): GhConfig {
  return {
    key: 'gh_pk_test_abc123',
    brand: 'Test',
    debug: false,
    apiBaseUrl: 'https://api-prod.goldenhippo.io',
    checkoutBase: null,
    cookieDomain: null,
    ...overrides,
  };
}

function setHostname(hostname: string): void {
  // jsdom's location is read-only by default; override via the prototype
  // descriptor so individual tests can stub a hostname.
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname, protocol: 'https:' },
    writable: true,
  });
}

describe('getCookieDomain', () => {
  it('returns explicit override verbatim when config.cookieDomain is set', () => {
    setHostname('info.example.com');
    expect(getCookieDomain(makeConfig({ cookieDomain: '.brand-override.com' }))).toBe('.brand-override.com');
  });

  it('auto-detects for .com hosts by stripping the leading subdomain', () => {
    setHostname('info.gundrymd.com');
    expect(getCookieDomain(makeConfig())).toBe('.gundrymd.com');
  });

  it.each(SAFE_TLDS)('auto-detects for .%s hosts', (tld) => {
    setHostname(`info.example.${tld}`);
    expect(getCookieDomain(makeConfig())).toBe(`.example.${tld}`);
  });

  it('returns null for multi-part TLDs like .co.uk', () => {
    setHostname('info.brand.co.uk');
    expect(getCookieDomain(makeConfig())).toBeNull();
  });

  it('returns null for single-label hosts like localhost', () => {
    setHostname('localhost');
    expect(getCookieDomain(makeConfig())).toBeNull();
  });

  it('returns null for IP addresses', () => {
    setHostname('192.168.1.1');
    expect(getCookieDomain(makeConfig())).toBeNull();
  });

  it('handles bare apex domain (e.g., gundrymd.com — no leading subdomain)', () => {
    setHostname('gundrymd.com');
    expect(getCookieDomain(makeConfig())).toBe('.gundrymd.com');
  });
});

describe('cookie read/write/delete', () => {
  beforeEach(() => {
    // Wipe all cookies between tests by writing each known one with Max-Age=0.
    document.cookie.split(';').forEach((c) => {
      const name = c.split('=')[0].trim();
      if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
    });
    setHostname('localhost');
  });

  it('round-trips a value via writeCookie + readCookie', () => {
    writeCookie('test_cookie', 'hello-world', { maxAgeSec: 60, domain: null });
    expect(readCookie('test_cookie')).toBe('hello-world');
  });

  it('returns undefined for a missing cookie', () => {
    expect(readCookie('nonexistent_cookie')).toBeUndefined();
  });

  it('URL-encodes values with special characters', () => {
    writeCookie('encoded', 'a=b; c', { maxAgeSec: 60, domain: null });
    expect(readCookie('encoded')).toBe('a=b; c');
  });

  it('deleteCookie removes a previously-written cookie', () => {
    writeCookie('to_delete', 'present', { maxAgeSec: 60, domain: null });
    expect(readCookie('to_delete')).toBe('present');
    deleteCookie('to_delete', null);
    expect(readCookie('to_delete')).toBeUndefined();
  });

  it('writeCookie refuses names with illegal characters', () => {
    expect(() => writeCookie('bad name', 'x', { maxAgeSec: 60, domain: null })).toThrow(/illegal/i);
    expect(() => writeCookie('bad=name', 'x', { maxAgeSec: 60, domain: null })).toThrow(/illegal/i);
    expect(() => writeCookie('bad;name', 'x', { maxAgeSec: 60, domain: null })).toThrow(/illegal/i);
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/cookies.spec.ts
```

Expected: all tests fail with `Failed to resolve import "../src/cookies"`.

- [ ] **Step 3: Create `packages/sdk/src/cookies.ts`**

Create the file with this exact content:

```typescript
/**
 * Cookie read/write/delete helpers + brand root-domain auto-detection.
 * The SDK uses this for the 30-day `sessionId` cookie and for inspecting
 * the API-set `connect.sid`. See Cluster F design spec for the cookie
 * model.
 */

import type { GhConfig } from './config';

/**
 * Single-segment TLDs the SDK auto-detects safely. Multi-part TLDs
 * (`.co.uk`, `.com.au`, `.co.jp`, etc.) require `data-cookie-domain`
 * to be set explicitly — auto-detect refuses to guess them and falls
 * back to host-only cookies.
 */
export const SAFE_TLDS = [
  'com',
  'net',
  'org',
  'io',
  'app',
  'dev',
  'ai',
  'co',
  'us',
  'store',
  'shop',
] as const;

const ILLEGAL_NAME_CHARS = /[=,;\s]/;

/**
 * Returns the `Domain` attribute to use when writing the SDK's cookies,
 * or `null` for host-only cookies.
 *
 * Resolution order:
 *  1. Explicit `data-cookie-domain` from config wins, verbatim.
 *  2. Else: if `window.location.hostname` ends in a SAFE_TLDS entry,
 *     return `.<registrable-domain>`.
 *  3. Else: return `null` (host-only).
 */
export function getCookieDomain(config: GhConfig): string | null {
  if (config.cookieDomain) return config.cookieDomain;

  const host = (typeof window !== 'undefined' ? window.location.hostname : '') || '';
  if (!host || !host.includes('.')) return null; // localhost, single-label
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null; // IPv4
  if (host.startsWith('[') && host.endsWith(']')) return null; // IPv6 brackets

  const labels = host.split('.');
  const tld = labels[labels.length - 1].toLowerCase();
  if (!SAFE_TLDS.includes(tld as typeof SAFE_TLDS[number])) return null;

  // Apex (e.g., `gundrymd.com`): 2 labels — return `.gundrymd.com`.
  // Subdomain (e.g., `info.gundrymd.com`): 3+ labels — strip one to
  // give `.gundrymd.com`.
  if (labels.length === 2) return `.${host}`;
  return '.' + labels.slice(1).join('.');
}

/** Read a single cookie by name. Returns the decoded value, or undefined. */
export function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const target = `${encodeURIComponent(name)}=`;
  const cookies = document.cookie.split(';');
  for (const c of cookies) {
    const trimmed = c.trim();
    if (trimmed.startsWith(target)) {
      try {
        return decodeURIComponent(trimmed.slice(target.length));
      } catch {
        return trimmed.slice(target.length);
      }
    }
  }
  return undefined;
}

export interface WriteCookieOptions {
  /** Max-Age in seconds. Required so the caller has to think about expiry. */
  maxAgeSec: number;
  /** `Domain=` attribute value. `null` => host-only. */
  domain: string | null;
  /** Default `'/'`. */
  path?: string;
  /** Default `'Lax'`. */
  sameSite?: 'Lax' | 'Strict' | 'None';
  /** Default true on `https:`, false otherwise. */
  secure?: boolean;
}

export function writeCookie(name: string, value: string, opts: WriteCookieOptions): void {
  if (typeof document === 'undefined') return;
  if (!name || ILLEGAL_NAME_CHARS.test(name)) {
    throw new Error(`cookies.writeCookie: illegal cookie name: ${JSON.stringify(name)}`);
  }
  const secure =
    opts.secure ?? (typeof window !== 'undefined' && window.location.protocol === 'https:');
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`,
    `Path=${opts.path ?? '/'}`,
    `SameSite=${opts.sameSite ?? 'Lax'}`,
  ];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (secure) parts.push('Secure');
  document.cookie = parts.join('; ');
}

export function deleteCookie(name: string, domain: string | null): void {
  writeCookie(name, '', { maxAgeSec: 0, domain });
}
```

- [ ] **Step 4: Re-run tests; verify all pass**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/cookies.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/cookies.ts packages/sdk/test/cookies.spec.ts
git commit -m "feat(sdk): add cookies.ts — read/write/delete + root-domain auto-detect

New module wraps document.cookie with three concerns:

- getCookieDomain(config) — resolves the brand's root domain via an
  explicit data-cookie-domain override or via auto-detect using a
  conservative single-segment TLD allowlist (com, net, org, io, app,
  dev, ai, co, us, store, shop). Multi-part TLDs (.co.uk etc.) and
  single-label hosts fall back to null (host-only).
- readCookie / writeCookie / deleteCookie — decoded round-trip with
  consistent attributes (Max-Age, Path=/, SameSite=Lax, Secure on
  https). Refuses cookie names containing illegal characters.

Pure DOM API. No new dependencies. Consumed in subsequent commits by
session.ts.

Part of Cluster F.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: url-params.ts — parse landing URL + click-id registry

**Files:**
- Create: `packages/sdk/src/url-params.ts`
- Create: `packages/sdk/test/url-params.spec.ts`

- [ ] **Step 1: Write failing tests in `packages/sdk/test/url-params.spec.ts`**

Create the file with this exact content:

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseLandingParams,
  CLICK_ID_REGISTRY,
  type ParsedParams,
} from '../src/url-params';

const BASE = 'https://info.gundrymd.com/some-funnel';

describe('parseLandingParams', () => {
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

  it('captures utm_* params as camelCased keys', () => {
    const out = parseLandingParams(
      `${BASE}?utm_source=fb&utm_medium=cpc&utm_campaign=summer`,
      '',
    );
    expect(out.utmSource).toBe('fb');
    expect(out.utmMedium).toBe('cpc');
    expect(out.utmCampaign).toBe('summer');
  });

  it('captures sub_id1–5 params', () => {
    const out = parseLandingParams(
      `${BASE}?sub_id1=a&sub_id2=b&sub_id3=c&sub_id4=d&sub_id5=e`,
      '',
    );
    expect(out.subId1).toBe('a');
    expect(out.subId2).toBe('b');
    expect(out.subId3).toBe('c');
    expect(out.subId4).toBe('d');
    expect(out.subId5).toBe('e');
  });

  it('applies the fbclid mapping when fbclid is present', () => {
    const out = parseLandingParams(`${BASE}?fbclid=IwAR1abc`, '');
    expect(out.subId1).toBe('fb');
    expect(out.subId5).toBe('IwAR1abc');
  });

  it('direct sub_id values take precedence over click-id-derived values', () => {
    const out = parseLandingParams(`${BASE}?fbclid=xyz&sub_id1=manual`, '');
    expect(out.subId1).toBe('manual'); // direct wins over click-id-derived
    expect(out.subId5).toBe('xyz');     // no direct sub_id5; click-id fills it
  });

  it('truncates values longer than 255 chars', () => {
    const longValue = 'a'.repeat(300);
    const out = parseLandingParams(`${BASE}?utm_source=${longValue}`, '');
    expect(out.utmSource!.length).toBe(255);
    expect(out.utmSource).toBe('a'.repeat(255));
  });

  it('strips ASCII control characters from values', () => {
    const out = parseLandingParams(`${BASE}?utm_source=a%00b%0Ac%07d`, '');
    expect(out.utmSource).toBe('abcd');
  });

  it('decodes URL-encoded values', () => {
    const out = parseLandingParams(`${BASE}?utm_campaign=summer%20sale`, '');
    expect(out.utmCampaign).toBe('summer sale');
  });

  it('returns empty params for a URL with no query string', () => {
    const out = parseLandingParams(BASE, '');
    expect(out.utmSource).toBeUndefined();
    expect(out.subId1).toBeUndefined();
    expect(out.landingUrl).toBe(BASE);
  });

  it('ignores unknown query parameters', () => {
    const out = parseLandingParams(`${BASE}?utm_source=fb&unrelated=foo`, '');
    expect(out.utmSource).toBe('fb');
    expect(Object.keys(out)).not.toContain('unrelated');
  });

  it('CLICK_ID_REGISTRY has the fbclid entry', () => {
    expect(typeof CLICK_ID_REGISTRY.fbclid).toBe('function');
    const params: ParsedParams = {};
    CLICK_ID_REGISTRY.fbclid('test-value', params);
    expect(params.subId1).toBe('fb');
    expect(params.subId5).toBe('test-value');
  });

  it('truncates click-id values too', () => {
    const longValue = 'b'.repeat(300);
    const out = parseLandingParams(`${BASE}?fbclid=${longValue}`, '');
    expect(out.subId5!.length).toBe(255);
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/url-params.spec.ts
```

Expected: all tests fail with `Failed to resolve import "../src/url-params"`.

- [ ] **Step 3: Create `packages/sdk/src/url-params.ts`**

Create the file with this exact content:

```typescript
/**
 * Landing-URL parser: captures UTM and sub_id query parameters, runs the
 * click-id mapping registry, and produces a `ParsedParams` shape that's
 * directly compatible with the POST /session `affParameters` request body.
 *
 * Direct query parameters (e.g., literal `?sub_id1=manual`) take precedence
 * over click-id-derived values. URL author intent wins over inference.
 *
 * See the Cluster F design spec for the click-id mapping pattern.
 */

const MAX_VALUE_CHARS = 255;
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g; // ASCII control chars

export interface ParsedParams {
  landingUrl?: string;
  referralUrl?: string;
  salesFunnel?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmCampaignId?: string;
  utmContent?: string;
  utmTerm?: string;
  utmChat?: string;
  utmAction?: string;
  offId?: string;
  affId?: string;
  subId1?: string;
  subId2?: string;
  subId3?: string;
  subId4?: string;
  subId5?: string;
}

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

const UTM_KEY_MAP: Record<string, keyof ParsedParams> = {
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_campaign_id: 'utmCampaignId',
  utm_content: 'utmContent',
  utm_term: 'utmTerm',
  utm_chat: 'utmChat',
  utm_action: 'utmAction',
};

const SUB_ID_KEY_MAP: Record<string, keyof ParsedParams> = {
  sub_id1: 'subId1',
  sub_id2: 'subId2',
  sub_id3: 'subId3',
  sub_id4: 'subId4',
  sub_id5: 'subId5',
};

const OTHER_KEY_MAP: Record<string, keyof ParsedParams> = {
  off_id: 'offId',
  aff_id: 'affId',
  sales_funnel: 'salesFunnel',
};

function clean(value: string): string {
  const stripped = value.replace(CONTROL_CHARS_RE, '');
  if (stripped.length <= MAX_VALUE_CHARS) return stripped;
  return stripped.slice(0, MAX_VALUE_CHARS);
}

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

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return out; // malformed href — still return what we have
  }

  // Pass 1: click-id mutators (so direct params can overwrite them in pass 2).
  for (const [paramName, mutator] of Object.entries(CLICK_ID_REGISTRY)) {
    const raw = url.searchParams.get(paramName);
    if (raw !== null) {
      mutator(clean(raw), out);
    }
  }

  // Pass 2: direct param keys. These win over click-id-derived values.
  for (const [key, value] of url.searchParams.entries()) {
    const lower = key.toLowerCase();
    const cleanValue = clean(value);
    if (!cleanValue) continue;
    if (lower in UTM_KEY_MAP) {
      out[UTM_KEY_MAP[lower]] = cleanValue;
    } else if (lower in SUB_ID_KEY_MAP) {
      out[SUB_ID_KEY_MAP[lower]] = cleanValue;
    } else if (lower in OTHER_KEY_MAP) {
      out[OTHER_KEY_MAP[lower]] = cleanValue;
    }
  }

  return out;
}
```

- [ ] **Step 4: Re-run tests; verify all pass**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/url-params.spec.ts
```

Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/url-params.ts packages/sdk/test/url-params.spec.ts
git commit -m "feat(sdk): add url-params.ts — landing URL parser + click-id registry

New module parses window.location.href into a ParsedParams shape
directly compatible with the POST /session affParameters request body.

- UTM keys (utm_source/medium/campaign/campaign_id/content/term/chat/
  action) mapped to camelCase fields.
- sub_id1–5 captured directly.
- Click-id registry: v1 ships one entry (fbclid → subId1='fb',
  subId5=<value>). Adding more (gclid, ttclid, etc.) is a one-line
  registry entry.
- Direct query params take precedence over click-id-derived values
  (URL author intent wins over inference).
- Values truncated to 255 chars (matches API maxLength) and control
  chars stripped.
- Empty/missing fields omitted from output (not sent as empty strings).

Pure function; no DOM/cookie deps. Consumed by session.ts.

Part of Cluster F.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: client.ts — add `postJson` helper

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/test/client.spec.ts`

- [ ] **Step 1: Write failing tests in `packages/sdk/test/client.spec.ts`**

Open `packages/sdk/test/client.spec.ts`. At the end of the file (after the existing `describe` blocks), append:

```typescript
describe('GhDataClient.postJson', () => {
  let client: GhDataClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new GhDataClient(
      {
        key: 'gh_pk_test_abc123',
        brand: 'Test',
        debug: false,
        apiBaseUrl: 'https://api-prod.goldenhippo.io',
        checkoutBase: null,
        cookieDomain: null,
      },
      { debug: () => {}, warn: () => {}, error: () => {} },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs JSON body with X-GH-Key and X-GH-Brand headers and credentials: include', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    await client.postJson('session', { affParameters: { utmSource: 'fb' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api-prod.goldenhippo.io/public/v1/session');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-GH-Key']).toBe('gh_pk_test_abc123');
    expect(init.headers['X-GH-Brand']).toBe('Test');
    expect(JSON.parse(init.body)).toEqual({ affParameters: { utmSource: 'fb' } });
  });

  it('returns parsed JSON response on 2xx', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"sessionId":"abc"}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const result = await client.postJson<{ sessionId: string }>('session', {});
    expect(result).toEqual({ sessionId: 'abc' });
  });

  it('returns null on 2xx with empty body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 204 }));
    const result = await client.postJson('session', {});
    expect(result).toBeNull();
  });

  it('throws GhError on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"code":"forbidden","message":"nope"}', { status: 403 }),
    );
    await expect(client.postJson('session', {})).rejects.toMatchObject({
      code: 'forbidden',
      message: 'nope',
    });
  });

  it('throws GhError on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.postJson('session', {})).rejects.toMatchObject({
      code: 'network',
    });
  });
});
```

If the file doesn't already import `afterEach`, `beforeEach`, `vi`, or `GhDataClient`, ensure they're present at the top — most existing client tests already import them; check the existing imports first.

- [ ] **Step 2: Run tests; verify they fail**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/client.spec.ts
```

Expected: the 5 new tests fail with `TypeError: client.postJson is not a function` or similar. Existing tests still pass.

- [ ] **Step 3: Add `postJson` to `GhDataClient` in `packages/sdk/src/client.ts`**

Refactor: extract the inner `fetchJson` to be a shared lower-level helper that takes method + body, and add a thin `postJson` wrapper. Modify `packages/sdk/src/client.ts` like this — replace the existing `fetchJson` method and add `postJson` just below the existing `clearCache`:

```typescript
  /**
   * POST a JSON body to a `/public/v1/<resource>` route. Used by Cluster F's
   * session endpoint. Includes credentials so the API's `Set-Cookie` for
   * `connect.sid` is stored and forwarded on subsequent calls.
   */
  postJson<T = unknown>(resource: string, body: unknown): Promise<T | null> {
    const url = `${this.config.apiBaseUrl}/public/v1/${resource}`;
    this.logger.debug('POST', url);
    return this.fetchJson<T | null>(url, {
      method: 'POST',
      body,
      credentials: 'include',
    });
  }

  private async fetchJson<T>(
    url: string,
    opts: { method?: string; body?: unknown; credentials?: RequestCredentials } = {},
  ): Promise<T> {
    const method = opts.method ?? 'GET';
    const init: RequestInit = {
      method,
      headers: {
        'X-GH-Key': this.config.key,
        'X-GH-Brand': this.config.brand,
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    if (opts.credentials) init.credentials = opts.credentials;

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new GhError('network', errorMessage(err), { cause: err });
    }

    if (!res.ok) {
      const body = await safeJson<HippoShopErrorDTO>(res);
      const code: GhErrorCode = body?.code ?? mapStatus(res.status);
      const retryAfterMs =
        body?.retryAfterMs ?? parseRetryAfter(res.headers.get('Retry-After'));
      throw new GhError(code, body?.message ?? (res.statusText || 'request failed'), {
        retryAfterMs,
      });
    }

    // 204 / empty body short-circuit
    if (res.status === 204 || res.headers.get('Content-Length') === '0') {
      return null as T;
    }

    const text = await res.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new GhError('server', 'response was not valid JSON', { cause: err });
    }
  }
```

Update the existing `private request` method's call to `fetchJson` if needed — it currently calls `this.fetchJson<T>(url)` with no second arg, which matches the new signature (default GET, no body). No change required.

- [ ] **Step 4: Re-run tests; verify all pass**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/client.spec.ts
```

Expected: all tests pass (5 new + existing).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/test/client.spec.ts
git commit -m "feat(sdk): add GhDataClient.postJson for session endpoint

Generalizes fetchJson to accept method + body + credentials options;
adds postJson(resource, body) that POSTs JSON to the existing
/public/v1/<resource> route with credentials: 'include'. Will be used
by session.ts to POST /public/v1/session (proxied by the API gateway
to the commerce service's session endpoint).

Existing GET path unchanged — uses the same fetchJson under new
defaults. 204 / empty-body responses now return null instead of
throwing on JSON.parse, which is the natural shape for session POSTs.

Part of Cluster F.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: session.ts — generateSessionId + ensureSession + event

**Files:**
- Create: `packages/sdk/src/session.ts`
- Create: `packages/sdk/test/session.spec.ts`

- [ ] **Step 1: Write failing tests in `packages/sdk/test/session.spec.ts`**

Create the file with this exact content:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureSession, generateSessionId, getSessionState, _resetForTests } from '../src/session';
import { readCookie, writeCookie, deleteCookie } from '../src/cookies';
import { GhDataClient } from '../src/client';
import type { GhConfig } from '../src/config';
import { createLogger } from '../src/log';

function makeConfig(overrides: Partial<GhConfig> = {}): GhConfig {
  return {
    key: 'gh_pk_test_abc123',
    brand: 'Test',
    debug: false,
    apiBaseUrl: 'https://api-prod.goldenhippo.io',
    checkoutBase: null,
    cookieDomain: null,
    ...overrides,
  };
}

function setHostname(hostname: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname, protocol: 'https:', href: `https://${hostname}/` },
    writable: true,
  });
}

beforeEach(() => {
  // Wipe cookies between tests.
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
  setHostname('localhost');
  _resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generateSessionId', () => {
  it('returns a 12-character string for current epoch milliseconds', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^\d{12}$/);
    expect(id.length).toBe(12);
  });

  it('produces the expected output for a fixed (Date.now, Math.random) pair', () => {
    // Lock Date.now() to a known value (epoch ms ~1.7e12) and Math.random() to 0.5.
    // ceil(1747449600000 * 0.5) = 873724800000 — 12 digits exactly.
    vi.spyOn(Date, 'now').mockReturnValue(1747449600000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(generateSessionId()).toBe('873724800000');
  });

  it('pads with YYYYMMDD when the random number is shorter than 12 digits', () => {
    // If now * random produces something like 1, ceil → 1, toString → '1' (length 1).
    // The pad branch appends year+month+day. Hard to assert exact value since the
    // current date varies; assert length and that the head is the (very small) number.
    vi.spyOn(Date, 'now').mockReturnValue(100); // tiny so result is short
    vi.spyOn(Math, 'random').mockReturnValue(0.001); // ceil(100 * 0.001) = 1
    const id = generateSessionId();
    expect(id.length).toBe(12);
    expect(id.startsWith('1')).toBe(true);
  });
});

describe('ensureSession', () => {
  let client: GhDataClient;
  let postSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const logger = createLogger(false);
    client = new GhDataClient(makeConfig(), logger);
    postSpy = vi.fn().mockResolvedValue({});
    client.postJson = postSpy as never;
    setHostname('info.gundrymd.com'); // safe TLD, root .gundrymd.com
  });

  it('on first visit: parses URL params, generates sessionId, POSTs /session', async () => {
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        href: 'https://info.gundrymd.com/funnel?utm_source=fb&fbclid=abc',
        hostname: 'info.gundrymd.com',
        protocol: 'https:',
      },
      writable: true,
    });
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toMatch(/^\d{12}$/);
    expect(state.params).toMatchObject({
      utmSource: 'fb',
      subId1: 'fb',
      subId5: 'abc',
    });
    expect(postSpy).toHaveBeenCalledWith('session', {
      affParameters: expect.objectContaining({
        utmSource: 'fb',
        subId1: 'fb',
        subId5: 'abc',
      }),
    });
    expect(state.hasConnectSid).toBe(true);
    // sessionId cookie was written
    expect(readCookie('sessionId')).toBe(state.sessionId);
  });

  it('skips POST when connect.sid cookie is already present', async () => {
    writeCookie('connect.sid', 's%3Afakevalue', { maxAgeSec: 3600, domain: null });
    const state = await ensureSession(makeConfig(), client);
    expect(postSpy).not.toHaveBeenCalled();
    expect(state.hasConnectSid).toBe(true);
    expect(state.params).toBeNull();
  });

  it('reuses an existing sessionId cookie', async () => {
    writeCookie('sessionId', '999999999999', { maxAgeSec: 3600, domain: null });
    writeCookie('connect.sid', 's%3Aexisting', { maxAgeSec: 3600, domain: null });
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('999999999999');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('on POST network failure: logs, still produces a SessionState with hasConnectSid=false', async () => {
    postSpy.mockRejectedValueOnce(new Error('network blew up'));
    const state = await ensureSession(makeConfig(), client);
    expect(state.hasConnectSid).toBe(false);
    expect(state.sessionId).toMatch(/^\d{12}$/);
    expect(state.params).not.toBeNull(); // params still captured locally
  });

  it('fires gh:session-ready on window after resolving', async () => {
    const handler = vi.fn();
    window.addEventListener('gh:session-ready', handler);
    await ensureSession(makeConfig(), client);
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toMatchObject({
      sessionId: expect.stringMatching(/^\d{12}$/),
      hasConnectSid: true,
    });
  });
});

describe('getSessionState', () => {
  it('returns null before ensureSession resolves', () => {
    expect(getSessionState()).toBeNull();
  });

  it('returns the resolved state after ensureSession completes', async () => {
    const logger = createLogger(false);
    const client = new GhDataClient(makeConfig(), logger);
    client.postJson = vi.fn().mockResolvedValue({}) as never;
    await ensureSession(makeConfig(), client);
    expect(getSessionState()).not.toBeNull();
    expect(getSessionState()?.sessionId).toMatch(/^\d{12}$/);
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/session.spec.ts
```

Expected: all tests fail with `Failed to resolve import "../src/session"`.

- [ ] **Step 3: Create `packages/sdk/src/session.ts`**

Create the file with this exact content:

```typescript
/**
 * Cluster F: session lifecycle. Reads existing `connect.sid` and `sessionId`
 * cookies, generates the `sessionId` when missing using the gh-utils
 * algorithm (ported verbatim for backward compatibility with funnel
 * events). POSTs once per visit to /public/v1/session when no `connect.sid`
 * is present. Fires `gh:session-ready` on `window` after resolving.
 *
 * Every reachable failure path is non-fatal: a network error or blocked
 * cookie surfaces as a SessionState with `hasConnectSid: false` or local-
 * only attribution; the page never breaks.
 *
 * See the Cluster F design spec for the data model.
 */

import type { GhConfig } from './config';
import type { GhDataClient } from './client';
import { getCookieDomain, readCookie, writeCookie } from './cookies';
import { parseLandingParams, type ParsedParams } from './url-params';

export const SESSION_COOKIE_NAME = 'sessionId';
export const CONNECT_SID_COOKIE_NAME = 'connect.sid';
const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const SESSION_ID_LENGTH = 12;
const SESSION_READY_EVENT = 'gh:session-ready';

export interface SessionState {
  sessionId: string;
  hasConnectSid: boolean;
  params: ParsedParams | null;
}

let cachedState: SessionState | null = null;

/** Returns the resolved session state, or null if `ensureSession` hasn't resolved yet. */
export function getSessionState(): SessionState | null {
  return cachedState;
}

/**
 * Port of `generateSessionId` from
 * https://github.com/GoldenHippoMedia/gh-utils/blob/master/src/utils/session/session.ts
 *
 * Produces a 12-character numeric string. NOT cryptographically random —
 * preserved for backward compatibility with funnel-events parsers that may
 * depend on the format.
 */
export function generateSessionId(): string {
  let id = Math.ceil(Date.now() * Math.random()).toString();
  if (id.length < SESSION_ID_LENGTH) {
    const now = new Date();
    const year = now.getFullYear();
    const month = new Intl.DateTimeFormat(undefined, { month: '2-digit' }).format(now);
    const day = new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(now);
    id += `${year}${month}${day}`;
  }
  return id.slice(0, SESSION_ID_LENGTH);
}

/**
 * Top-level orchestrator. Runs once per visit. Idempotent on re-call.
 * Fires `gh:session-ready` on the window when it resolves (success or
 * graceful failure).
 */
export async function ensureSession(
  config: GhConfig,
  client: GhDataClient,
): Promise<SessionState> {
  if (cachedState) return cachedState;

  const domain = getCookieDomain(config);
  const existingConnectSid = readCookie(CONNECT_SID_COOKIE_NAME);
  const hasConnectSid = !!existingConnectSid;

  // Ensure sessionId cookie exists at the resolved domain.
  let sessionId = readCookie(SESSION_COOKIE_NAME);
  if (!sessionId) {
    sessionId = generateSessionId();
    try {
      writeCookie(SESSION_COOKIE_NAME, sessionId, { maxAgeSec: SESSION_TTL_SEC, domain });
    } catch {
      // Cookie write blocked; sessionId still kept in memory for this visit.
    }
  }

  // If connect.sid already present, skip the POST entirely.
  if (hasConnectSid) {
    const state: SessionState = { sessionId, hasConnectSid: true, params: null };
    cachedState = state;
    fireReady(state);
    return state;
  }

  // First-visit path: parse landing URL, POST /session.
  const href = typeof window !== 'undefined' ? window.location.href : '';
  const referrer = typeof document !== 'undefined' ? document.referrer : '';
  const params = parseLandingParams(href, referrer);

  let postOk = false;
  try {
    await client.postJson('session', { affParameters: params });
    postOk = true;
  } catch {
    // Network or non-2xx; degrade gracefully. We can't inspect Set-Cookie
    // from JS, so postOk is our only signal that the API was reached.
  }

  const state: SessionState = { sessionId, hasConnectSid: postOk, params };
  cachedState = state;
  fireReady(state);
  return state;
}

function fireReady(state: SessionState): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_READY_EVENT, { detail: { ...state } }));
  } catch {
    // CustomEvent unsupported in some test envs; ignore.
  }
}

/** Test-only: clears the module-level cache between specs. Not exported via index.ts. */
export function _resetForTests(): void {
  cachedState = null;
}
```

- [ ] **Step 4: Re-run tests; verify all pass**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/session.spec.ts
```

Expected: all tests pass. If the `generateSessionId` byte-for-byte test fails because of `Intl.DateTimeFormat` behavior on Node's ICU vs the browser's ICU, the test should still pass for the locked `Date.now`/`Math.random` pair where length >= 12 (no padding path triggered). The padding-path test only asserts length and prefix, so it's robust.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/session.ts packages/sdk/test/session.spec.ts
git commit -m "feat(sdk): add session.ts — sessionId cookie + ensureSession + event

Cluster F session lifecycle:

- generateSessionId() is the verbatim port of gh-utils
  src/utils/session/session.ts. Produces a 12-character numeric ID,
  not crypto-random but matching the existing Angular pre-purchase
  funnel's format so downstream funnel-events parsers continue to work.
- ensureSession(config, client): reads connect.sid; if present, skips
  the POST entirely. Otherwise parses landing URL, POSTs to
  /public/v1/session with affParameters wrapping the params, captures
  state on success or degrades gracefully on failure.
- sessionId cookie is read or generated (30-day, root-domain via
  cookies.getCookieDomain). Reused across page loads.
- Dispatches gh:session-ready on window after resolving with detail
  { sessionId, hasConnectSid, params }.
- All failure paths are non-fatal: network error, blocked cookies,
  malformed URL — none break the page.

Module-level cachedState ensures ensureSession is effectively
idempotent. _resetForTests() is a test-only escape hatch (not
re-exported from index.ts).

Part of Cluster F.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: checkout.ts — composeCheckoutUrl (composition only)

**Files:**
- Create: `packages/sdk/src/checkout.ts`
- Create: `packages/sdk/test/checkout.spec.ts`

- [ ] **Step 1: Write failing tests in `packages/sdk/test/checkout.spec.ts`**

Create the file with this exact content:

```typescript
import { describe, it, expect } from 'vitest';
import { composeCheckoutUrl } from '../src/checkout';
import { GhError } from '../src/errors';
import type { HippoShopDestinationDTO } from '@goldenhippo/hippo-shop-types';
import type { GhConfig } from '../src/config';
import type { SessionState } from '../src/session';

function makeConfig(overrides: Partial<GhConfig> = {}): GhConfig {
  return {
    key: 'gh_pk_test_abc123',
    brand: 'Test',
    debug: false,
    apiBaseUrl: 'https://api-prod.goldenhippo.io',
    checkoutBase: 'https://checkout.gundrymd.com',
    cookieDomain: null,
    ...overrides,
  };
}

function makeDestination(
  overrides: Partial<HippoShopDestinationDTO['pricing']> = {},
): HippoShopDestinationDTO {
  return {
    slug: 'bio3-3p-sub',
    name: 'Bio Complete 3 — 3-pack subscription',
    description: null,
    funnelSlug: 'fnl',
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
      ...overrides,
    },
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: '174710238129',
    hasConnectSid: true,
    params: null,
    ...overrides,
  };
}

describe('composeCheckoutUrl', () => {
  it('uses the brand-level checkoutBase when no DTO override', () => {
    const url = composeCheckoutUrl(makeDestination(), makeConfig(), makeSession());
    expect(url).toMatch(/^https:\/\/checkout\.gundrymd\.com\//);
  });

  it('uses the DTO override when present, ignoring the brand default', () => {
    const dest = makeDestination({ checkoutOverrideUrl: 'https://special.example.com/buy' });
    const url = composeCheckoutUrl(dest, makeConfig(), makeSession());
    expect(url).toMatch(/^https:\/\/special\.example\.com\/buy/);
    expect(url).not.toContain('checkout.gundrymd.com');
  });

  it('throws GhError when no brand base AND no DTO override', () => {
    const config = makeConfig({ checkoutBase: null });
    const dest = makeDestination({ checkoutOverrideUrl: null });
    expect(() => composeCheckoutUrl(dest, config, makeSession())).toThrow(GhError);
  });

  it('always appends order_form_id and session_id', () => {
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), makeSession()));
    expect(url.searchParams.get('order_form_id')).toBe('OF_123');
    expect(url.searchParams.get('session_id')).toBe('174710238129');
  });

  it('appends UTM and sub_id params when present in session.params', () => {
    const session = makeSession({
      params: {
        landingUrl: 'https://info.gundrymd.com/x',
        utmSource: 'fb',
        utmCampaign: 'summer',
        subId1: 'fb',
        subId5: 'abc',
      },
    });
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
    expect(url.searchParams.get('utm_source')).toBe('fb');
    expect(url.searchParams.get('utm_campaign')).toBe('summer');
    expect(url.searchParams.get('sub_id1')).toBe('fb');
    expect(url.searchParams.get('sub_id5')).toBe('abc');
  });

  it('omits keys whose session.params values are empty/undefined', () => {
    const session = makeSession({ params: { utmSource: 'fb' } });
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
    expect(url.searchParams.has('utm_source')).toBe(true);
    expect(url.searchParams.has('utm_medium')).toBe(false);
    expect(url.searchParams.has('sub_id1')).toBe(false);
  });

  it('preserves pre-existing query string on the base URL', () => {
    const config = makeConfig({ checkoutBase: 'https://checkout.gundrymd.com/?fbp=existing' });
    const url = new URL(composeCheckoutUrl(makeDestination(), config, makeSession()));
    expect(url.searchParams.get('fbp')).toBe('existing');
    expect(url.searchParams.get('order_form_id')).toBe('OF_123');
  });

  it('author-supplied keys on the base win over SDK additions', () => {
    const config = makeConfig({
      checkoutBase: 'https://checkout.gundrymd.com/?session_id=author-wins',
    });
    const url = new URL(composeCheckoutUrl(makeDestination(), config, makeSession()));
    expect(url.searchParams.get('session_id')).toBe('author-wins');
  });

  it('emits empty string for session_id when sessionId is empty', () => {
    const url = new URL(
      composeCheckoutUrl(makeDestination(), makeConfig(), makeSession({ sessionId: '' })),
    );
    // empty sessionId is omitted — we don't pollute the URL with empty values
    expect(url.searchParams.has('session_id')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/checkout.spec.ts
```

Expected: all tests fail with `Failed to resolve import "../src/checkout"`.

- [ ] **Step 3: Create `packages/sdk/src/checkout.ts` with composition only**

Create the file with this exact content (DOM-binding code lands in Task 8):

```typescript
/**
 * Cluster F: outbound checkout URL composition + (in Task 8)
 * `data-gh-checkout` attribute behavior and the `gh.checkoutUrl(slug)`
 * programmatic API.
 *
 * `composeCheckoutUrl` is a pure function: given a destination DTO, the
 * SDK config, and the current session state, it returns the outbound
 * URL. Falls back through brand-level `data-checkout-base` if the DTO
 * has no override; throws if neither is configured.
 */

import type { HippoShopDestinationDTO } from '@goldenhippo/hippo-shop-types';
import type { GhConfig } from './config';
import type { SessionState } from './session';
import { GhError } from './errors';

/**
 * Keys in `ParsedParams` → query-param names on the outbound checkout URL.
 * Order matters for deterministic output (tests rely on this).
 */
const PARAM_KEY_MAP: Array<[keyof NonNullable<SessionState['params']>, string]> = [
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
  ['subId1', 'sub_id1'],
  ['subId2', 'sub_id2'],
  ['subId3', 'sub_id3'],
  ['subId4', 'sub_id4'],
  ['subId5', 'sub_id5'],
];

/**
 * Compose the outbound checkout URL for a destination.
 *
 * @throws GhError('config') if neither `destination.pricing.checkoutOverrideUrl`
 *  nor `config.checkoutBase` is set.
 */
export function composeCheckoutUrl(
  destination: HippoShopDestinationDTO,
  config: GhConfig,
  session: SessionState,
): string {
  const baseStr = destination.pricing.checkoutOverrideUrl ?? config.checkoutBase;
  if (!baseStr) {
    throw new GhError(
      'config',
      `No checkout base URL configured for destination "${destination.slug}". ` +
        `Set the script-tag data-checkout-base or destination.pricing.checkoutOverrideUrl.`,
    );
  }

  let url: URL;
  try {
    url = new URL(baseStr);
  } catch (err) {
    throw new GhError('config', `Invalid checkout base URL: ${baseStr}`, { cause: err });
  }

  setIfAbsent(url, 'order_form_id', destination.pricing.orderFormId);
  setIfAbsent(url, 'session_id', session.sessionId);

  if (session.params) {
    for (const [key, paramName] of PARAM_KEY_MAP) {
      const value = session.params[key];
      if (value) setIfAbsent(url, paramName, value);
    }
  }

  return url.toString();
}

/** Set `name=value` on the URL's search params only if not already set. Empty values are skipped. */
function setIfAbsent(url: URL, name: string, value: string | undefined | null): void {
  if (!value) return;
  if (url.searchParams.has(name)) return;
  url.searchParams.set(name, value);
}
```

Note: this introduces a new `GhError` code, `'config'`. Check `packages/sdk/src/errors.ts` to confirm `'config'` is already a valid `GhErrorCode`. If not, add it:

```typescript
// In packages/sdk/src/errors.ts:
export type GhErrorCode =
  | 'network'
  | 'server'
  | 'not_found'
  | 'forbidden'
  | 'rate_limited'
  | 'bad_request'
  | 'config'; // ← add this
```

- [ ] **Step 4: Re-run tests; verify all pass**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/checkout.spec.ts
```

Expected: all 9 tests pass. If a test fails because `GhError` doesn't accept `'config'`, the errors.ts edit above is required.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/checkout.ts packages/sdk/test/checkout.spec.ts packages/sdk/src/errors.ts
git commit -m "feat(sdk): add checkout.ts composeCheckoutUrl

Pure function that builds the outbound checkout URL for a destination.

- Base URL resolves from destination.pricing.checkoutOverrideUrl (if
  non-null) else config.checkoutBase. Throws GhError('config') when
  neither is set.
- Always appends order_form_id (from destination.pricing) and
  session_id (from SessionState.sessionId) when non-empty.
- Walks the session.params map and appends utm_*/sub_id*/off_id/aff_id
  query params for any non-empty value.
- Pre-existing query keys on the base URL are preserved; SDK keys
  don't clobber author-supplied values (setIfAbsent semantics).

DOM bindings + window.gh surface land in the next commit.

Adds 'config' to GhErrorCode for the missing-base-URL case.

Part of Cluster F.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: checkout.ts — DOM bindings + `gh.checkoutUrl(slug)`

**Files:**
- Modify: `packages/sdk/src/checkout.ts`
- Modify: `packages/sdk/test/checkout.spec.ts`

- [ ] **Step 1: Write failing tests appended to `packages/sdk/test/checkout.spec.ts`**

Append at the end of the existing file:

```typescript
import { applyCheckoutBindings, type CheckoutBindingsOptions } from '../src/checkout';

describe('applyCheckoutBindings', () => {
  function setupDom(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body;
  }

  function makeOptions(overrides: Partial<CheckoutBindingsOptions> = {}): CheckoutBindingsOptions {
    return {
      config: makeConfig(),
      session: makeSession(),
      getDestination: () => makeDestination(),
      ensureDestination: () => Promise.resolve(),
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
      ...overrides,
    };
  }

  it('writes href on <a data-gh-checkout> when destination is available', () => {
    setupDom('<a data-gh-checkout="bio3-3p-sub" href="#">Buy</a>');
    applyCheckoutBindings(document, makeOptions());
    const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
    expect(a.getAttribute('href')).toMatch(/^https:\/\/checkout\.gundrymd\.com\/\?/);
    expect(a.getAttribute('href')).toContain('order_form_id=OF_123');
    expect(a.getAttribute('href')).toContain('session_id=174710238129');
  });

  it('sets href to "#" and triggers ensureDestination when destination not yet loaded', () => {
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

  it('attaches a click handler on non-<a> elements (e.g., <button>)', () => {
    setupDom('<button data-gh-checkout="bio3-3p-sub">Buy</button>');
    applyCheckoutBindings(document, makeOptions());
    const button = document.querySelector<HTMLButtonElement>('button[data-gh-checkout]')!;
    // We can't easily test the navigate behavior in jsdom, but we can check the
    // listener is attached by checking that the element gained a marker dataset.
    expect(button.dataset['ghCheckoutBound']).toBe('1');
  });

  it('updates href on re-bind when session_id changes', () => {
    setupDom('<a data-gh-checkout="bio3-3p-sub" href="#">Buy</a>');
    const session1 = makeSession({ sessionId: '111111111111' });
    applyCheckoutBindings(document, makeOptions({ session: session1 }));
    const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
    expect(a.getAttribute('href')).toContain('session_id=111111111111');

    const session2 = makeSession({ sessionId: '222222222222' });
    applyCheckoutBindings(document, makeOptions({ session: session2 }));
    expect(a.getAttribute('href')).toContain('session_id=222222222222');
  });

  it('logs a warning and sets href="#" when no base URL is configured', () => {
    setupDom('<a data-gh-checkout="bio3-3p-sub" href="">Buy</a>');
    const warn = vi.fn();
    const config = makeConfig({ checkoutBase: null });
    applyCheckoutBindings(
      document,
      makeOptions({
        config,
        getDestination: () => makeDestination({ checkoutOverrideUrl: null }),
        logger: { debug: () => {}, warn, error: () => {} },
      }),
    );
    const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
    expect(a.getAttribute('href')).toBe('#');
    expect(warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests; verify the new ones fail**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/checkout.spec.ts
```

Expected: 5 new tests fail with `applyCheckoutBindings is not exported` or similar. Existing `composeCheckoutUrl` tests still pass.

- [ ] **Step 3: Append `applyCheckoutBindings` to `packages/sdk/src/checkout.ts`**

Add these new exports at the end of `packages/sdk/src/checkout.ts`:

```typescript
import type { HippoShopDestinationDTO } from '@goldenhippo/hippo-shop-types';
import type { Logger } from './log';

const CHECKOUT_ATTR = 'data-gh-checkout';
const BOUND_FLAG = 'ghCheckoutBound';

export interface CheckoutBindingsOptions {
  config: GhConfig;
  session: SessionState;
  /** Resolve a destination slug to its cached DTO, or null if not yet loaded. */
  getDestination: (slug: string) => HippoShopDestinationDTO | null;
  /** Trigger a fetch for a destination if not yet loaded. Returns when loaded. */
  ensureDestination: (slug: string) => Promise<void>;
  logger: Logger;
}

/**
 * Walk a root for `[data-gh-checkout]` elements and apply the appropriate
 * binding for each:
 *
 * - `<a>` → set `href` to the composed checkout URL (native browser navigation).
 * - non-`<a>` → attach a click handler that navigates the page on click.
 *
 * If the destination is not yet loaded, the href is set to `"#"` and
 * `ensureDestination` is invoked to load it. The caller is responsible
 * for re-running `applyCheckoutBindings` once the destination resolves
 * (typically via the existing MutationObserver re-bind in `runtime.ts`).
 *
 * Idempotent: re-running on the same DOM updates href values and is safe
 * for click handlers (the BOUND_FLAG dataset attribute prevents double-binding).
 */
export function applyCheckoutBindings(
  root: ParentNode,
  opts: CheckoutBindingsOptions,
): void {
  const elements = root.querySelectorAll<HTMLElement>(`[${CHECKOUT_ATTR}]`);
  for (const el of Array.from(elements)) {
    const slug = el.getAttribute(CHECKOUT_ATTR);
    if (!slug) continue;
    bindOne(el, slug, opts);
  }
}

function bindOne(el: HTMLElement, slug: string, opts: CheckoutBindingsOptions): void {
  const destination = opts.getDestination(slug);
  if (!destination) {
    // Stub href until destination loads; trigger the load.
    if (el instanceof HTMLAnchorElement) el.setAttribute('href', '#');
    opts.ensureDestination(slug).catch((err) => opts.logger.warn(`checkout: failed to load destination "${slug}"`, err));
    return;
  }

  let url: string;
  try {
    url = composeCheckoutUrl(destination, opts.config, opts.session);
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
    // Already bound; update a stored URL via dataset for the handler to read.
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

/**
 * Programmatic equivalent of `<a data-gh-checkout="slug">`. Returns the
 * composed checkout URL for `slug` synchronously. Throws if the destination
 * is not yet cached or if no base URL is configured.
 *
 * Page authors who need to retrieve a checkout URL outside of the
 * declarative attribute (e.g., SPA route push, analytics-instrumented
 * click) call `gh.checkoutUrl(slug)`. The wire-up to `window.gh` happens
 * in `index.ts` (Task 9).
 */
export function makeCheckoutUrlFn(
  opts: Omit<CheckoutBindingsOptions, 'logger'>,
): (slug: string) => string {
  return function checkoutUrl(slug: string): string {
    const destination = opts.getDestination(slug);
    if (!destination) {
      // Trigger a load for the next call; throw to make the missing-cache
      // case visible to the caller.
      opts.ensureDestination(slug);
      throw new GhError(
        'not_found',
        `gh.checkoutUrl("${slug}"): destination not yet loaded — try again after gh:bindings-ready`,
      );
    }
    return composeCheckoutUrl(destination, opts.config, opts.session);
  };
}
```

- [ ] **Step 4: Re-run tests; verify all pass**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/checkout.spec.ts
```

Expected: all tests pass (9 composition tests + 5 binding tests = 14 total).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/checkout.ts packages/sdk/test/checkout.spec.ts
git commit -m "feat(sdk): checkout.ts — data-gh-checkout bindings + programmatic API

Extends checkout.ts with the DOM-level surface:

- applyCheckoutBindings(root, opts) walks [data-gh-checkout] elements.
  For <a>, writes the composed checkout URL into href (native browser
  navigation, middle-click preserved). For non-<a> (button, div),
  attaches a click handler that navigates via window.location.href.
- Idempotent re-bind: <a> hrefs get updated on each call; non-<a>
  click handlers are attached once (BOUND_FLAG dataset prevents
  double-binding) and read the latest URL from a dataset attribute.
- Stub href = '#' when the destination isn't yet cached; calls
  ensureDestination to trigger a load, with runtime re-binding once
  the resource resolves.
- makeCheckoutUrlFn(opts) returns a closure to be exposed at
  window.gh.checkoutUrl(slug). Throws if the destination isn't cached
  yet (vs the declarative path's graceful '#' fallback).

Boot wire-up + runtime hook land in the next commit (Task 9).

Part of Cluster F.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Wire boot + runtime + expose `gh.*` surface

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/runtime.ts`
- Modify: `packages/sdk/test/index.spec.ts`
- Modify: `packages/sdk/test/runtime.spec.ts`

- [ ] **Step 1: Write failing tests in `packages/sdk/test/index.spec.ts`**

Append at the end of `packages/sdk/test/index.spec.ts`:

```typescript
describe('cluster F wiring on boot', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    delete (window as { gh?: unknown }).gh;
    vi.restoreAllMocks();
  });

  it('attaches window.gh.session and window.gh.checkoutUrl when booted', () => {
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      'checkout-base': 'https://checkout.gundrymd.com',
      src: 'https://api-prod.goldenhippo.io/sdk/v3/gh.js',
    });
    boot();
    expect(typeof window.gh!.session!.id).toBe('function');
    expect(typeof window.gh!.session!.params).toBe('function');
    expect(typeof window.gh!.checkoutUrl).toBe('function');
  });

  it('gh.session.id() returns undefined before ensureSession resolves', () => {
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      'checkout-base': 'https://checkout.gundrymd.com',
      src: 'https://api-prod.goldenhippo.io/sdk/v3/gh.js',
    });
    boot();
    // Synchronous immediately after boot — session resolution is async.
    expect(window.gh!.session!.id()).toBeUndefined();
  });
});
```

Note: depending on how `installScript` is currently implemented in `test/index.spec.ts`, you may need the same hyphenated-key fix mentioned in Task 2. Confirm the helper handles `'checkout-base'` correctly; if not, update it to use `setAttribute(\`data-${k}\`, v)` instead of `dataset[k] = v`.

- [ ] **Step 2: Write a failing test in `packages/sdk/test/runtime.spec.ts`**

Append at the end of `packages/sdk/test/runtime.spec.ts`:

```typescript
describe('cluster F: data-gh-checkout binding', () => {
  it('writes href on [data-gh-checkout] anchors after bind', async () => {
    // Use the existing runtime test scaffolding pattern. The exact test
    // setup depends on what helpers exist in runtime.spec.ts; the
    // assertion to verify is:
    //
    //   1. Bootstrap the runtime with a config that has checkoutBase set
    //      and a mocked GhDataClient that returns a destination DTO.
    //   2. Add `<a data-gh-checkout="some-slug">` to the document.
    //   3. Call runtime.bind() (or trigger DOMContentLoaded path).
    //   4. Assert the anchor's href is set to the composed URL.
    //
    // Copy the pattern from an existing destination-binding test in this
    // file. If no such test exists yet, add the minimal scaffolding.
    expect(true).toBe(true); // placeholder — replace with real assertion
  });
});
```

**This step is a stub.** Look at the existing tests in `runtime.spec.ts` and write a real test that verifies the bind pass writes checkout hrefs. If the test scaffolding is too tangled to easily mock a destination, write the test against `applyCheckoutBindings` directly with a stubbed runtime hook and treat the runtime integration as covered by `applyCheckoutBindings` tests + `index.spec.ts` integration tests.

- [ ] **Step 3: Run tests; verify they fail**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test -- test/index.spec.ts test/runtime.spec.ts
```

Expected: the new index.spec.ts tests fail because `window.gh.session` is undefined. (The placeholder runtime test passes trivially; replace with a real assertion when scaffolding is in place.)

- [ ] **Step 4: Modify `packages/sdk/src/index.ts`**

Update the `GhWindow` interface and the `boot` function:

```typescript
// Add imports at the top:
import { ensureSession, getSessionState } from './session';
import { makeCheckoutUrlFn } from './checkout';

// Update GhWindow interface:
export interface GhWindow {
  data: GhDataApi;
  bind: GhRuntime['bind'];
  refresh: GhRuntime['refresh'];
  format: FormatRegistry;
  debug?: boolean;
  checkoutUrl?: (slug: string) => string;
  session?: {
    id: () => string | undefined;
    params: () => ReturnType<typeof getSessionState> extends infer R
      ? R extends { params: infer P } | null ? P | null : null
      : null;
  };
  __sessionPromise?: Promise<unknown>;
}

// Inside boot(), after the existing root.data / root.bind / root.refresh / root.format
// assignments (around line 75) and BEFORE `runtime.installAutoBind()`, add:

  root.session = {
    id: () => getSessionState()?.sessionId,
    params: () => getSessionState()?.params ?? null,
  };
  root.checkoutUrl = makeCheckoutUrlFn({
    config,
    session: { sessionId: '', hasConnectSid: false, params: null }, // pre-resolve stub
    getDestination: (slug) => runtime.getCachedDestination(slug),
    ensureDestination: (slug) => runtime.ensureDestination(slug),
  });

  root.__sessionPromise = ensureSession(config, client).then((state) => {
    // Refresh checkoutUrl closure with the resolved session so subsequent calls
    // pick up the real sessionId + params.
    root.checkoutUrl = makeCheckoutUrlFn({
      config,
      session: state,
      getDestination: (slug) => runtime.getCachedDestination(slug),
      ensureDestination: (slug) => runtime.ensureDestination(slug),
    });
    return state;
  }).catch(() => undefined); // ensureSession itself handles errors; this is final defense
```

**Add the helper methods to `GhRuntime`** by modifying `packages/sdk/src/runtime.ts`. Find the `loadOne` method and add two new public methods after it:

```typescript
  /** Cluster F: synchronous lookup of a cached destination, or null. */
  getCachedDestination(slug: string): HippoShopDestinationDTO | null {
    return (this.resources.get(`destination:${slug}`) as HippoShopDestinationDTO | undefined) ?? null;
  }

  /** Cluster F: trigger a destination load (idempotent via in-flight dedup). */
  ensureDestination(slug: string): Promise<void> {
    return this.loadOne('destination', slug);
  }
```

Add the import at the top of `runtime.ts`:

```typescript
import type { HippoShopDestinationDTO } from '@goldenhippo/hippo-shop-types';
```

- [ ] **Step 5: Wire the checkout-bindings pass + gh:session-ready listener into `runtime.bind()`**

In `packages/sdk/src/runtime.ts`, in the `bind()` method, after the final `applyBindings(target, …)` call (just before the `if (!this.bindingsReadyFired)` block), add the checkout-bindings pass:

```typescript
    applyBindings(target, {
      formatters: this.formatters,
      resources: this.resources,
      resourceStates: this.resourceStates,
    });

    // Cluster F: also bind [data-gh-checkout] elements.
    const session = getSessionState() ?? { sessionId: '', hasConnectSid: false, params: null };
    applyCheckoutBindings(target, {
      config: this.opts.config,
      session,
      getDestination: (slug) => this.getCachedDestination(slug),
      ensureDestination: (slug) => this.ensureDestination(slug),
      logger: this.opts.logger,
    });
```

Add the corresponding imports at the top of `runtime.ts`:

```typescript
import { applyCheckoutBindings } from './checkout';
import { getSessionState } from './session';
```

**Add `config` to `RuntimeOptions`** so `applyCheckoutBindings` can receive it. Find the `RuntimeOptions` interface in `runtime.ts` and add `config: GhConfig`:

```typescript
export interface RuntimeOptions {
  doc: Document;
  win: Window;
  logger: Logger;
  client: GhDataClient;
  config: GhConfig; // ← add this
}
```

Add `import type { GhConfig } from './config';` to the top.

In `index.ts`, the construction site for `GhRuntime` (around line 65) needs the new field:

```typescript
const runtime = new GhRuntime({ doc, win, logger, client, config }); // ← add config
```

**Install the `gh:session-ready` listener inside `installAutoBind`** so the runtime re-runs `bind()` once the session resolves and the checkout hrefs pick up the real `session_id`. Modify the `installAutoBind` method:

```typescript
  installAutoBind(): void {
    const run = (): void => {
      void this.bind(this.doc)
        .catch(err => this.opts.logger.error('initial bind failed', err))
        .finally(() => this.attachObserver());
    };
    if (this.doc.readyState === 'loading') {
      this.doc.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      setTimeout(run, 0);
    }

    // Cluster F: re-bind once the session resolves so checkout hrefs pick up
    // the real session_id. Fire-and-forget; bind() handles its own errors.
    this.opts.win.addEventListener(
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

- [ ] **Step 6: Run all SDK tests; verify they pass**

```bash
pnpm nx test sdk
```

Expected: all SDK tests pass — the new ones plus all existing. If any existing test fails because `GhRuntime` constructor now requires `config`, update the test fixtures to pass it. The fix is mechanical: every place that constructs `new GhRuntime({…})` in tests needs `config: { …minimal valid GhConfig… }` added.

- [ ] **Step 7: Run lint + typecheck + build across the whole repo to catch wire-up issues**

```bash
pnpm nx run-many -t lint typecheck test build
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/index.ts packages/sdk/src/runtime.ts packages/sdk/test/index.spec.ts packages/sdk/test/runtime.spec.ts
git commit -m "feat(sdk): wire Cluster F into boot + runtime

- boot() in index.ts now calls ensureSession after attaching the data
  API, stores the promise on window.gh.__sessionPromise for debug,
  exposes gh.session.{id,params} and gh.checkoutUrl(slug).
- gh.checkoutUrl uses a pre-resolve stub closure (empty sessionId)
  initially, then ensureSession's .then() swaps the closure for one
  using the resolved session state. Most page authors call this from
  click handlers after gh:bindings-ready, so the stub window is
  effectively zero in practice.
- runtime.bind() now also runs applyCheckoutBindings against the same
  root after the existing applyBindings pass. Picks up [data-gh-
  checkout] elements; writes href on <a> or attaches a click handler
  on others.
- installAutoBind() installs a one-shot gh:session-ready listener
  that re-runs bind() once the session resolves, so checkout hrefs
  rebound with the real sessionId.
- GhRuntime gains two helper methods (getCachedDestination,
  ensureDestination) so checkout.ts can resolve destinations without
  reaching into runtime internals.
- RuntimeOptions gains a config field so applyCheckoutBindings sees
  the resolved SdkConfig.

Part of Cluster F.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: SPEC.md + README.md updates

**Files:**
- Modify: `packages/sdk/SPEC.md`
- Modify: `SPEC.md` (root)
- Modify: `packages/types/SPEC.md`
- Modify: `packages/sdk/README.md`

- [ ] **Step 1: Update `packages/sdk/SPEC.md` with the new attribute reference**

Read the existing `packages/sdk/SPEC.md` and locate the section describing data attributes. Append a new entry for `data-gh-checkout` to that section, and add new sections for the new `gh.*` surface and the `gh:session-ready` event.

Concretely, add this block to the attribute reference (preserve surrounding tables/lists exactly):

```markdown
### `data-gh-checkout="<destination-slug>"`

Marks the element as a checkout-handoff control. On `<a>` elements, the SDK populates `href` with the composed outbound checkout URL. On other elements (`<button>`, `<div>`, etc.), the SDK attaches a `click` handler that navigates the page to the composed URL.

The composed URL is `<base>?order_form_id=<id>&session_id=<sid>&...session-params`, where:

- `<base>` is `destination.pricing.checkoutOverrideUrl` if set, else the `data-checkout-base` script-tag attribute.
- `order_form_id` is `destination.pricing.orderFormId`.
- `session_id` is the SDK's `sessionId` cookie value (empty until `gh:session-ready` fires).
- `utm_*` and `sub_id1`–`sub_id5` come from the parsed landing URL (omitted if empty).

Pre-existing query keys on the base URL are preserved; SDK-added keys do not clobber author-supplied ones. If no base URL is configured (no `data-checkout-base` AND no `checkoutOverrideUrl`), the SDK sets `href="#"` and logs a debug warning.

### Script-tag attributes (additions)

- `data-checkout-base="https://checkout.brand.com"` — required if any page on this brand uses `[data-gh-checkout]` or `gh.checkoutUrl()` without per-destination overrides. Optional otherwise.
- `data-cookie-domain=".brand.com"` — optional explicit override for the brand's root cookie domain. When absent, the SDK auto-detects via the safe-TLD allowlist: `com, net, org, io, app, dev, ai, co, us, store, shop`. Multi-part TLDs (`.co.uk`, `.com.au`) require this attribute.

### `window.gh.checkoutUrl(slug: string): string`

Returns the composed checkout URL for the destination identified by `slug`, without navigating. Throws if the destination is not yet cached or if no base URL is configured.

### `window.gh.session.id(): string | undefined`

Returns the current `sessionId` cookie value, or `undefined` if `gh:session-ready` hasn't fired yet.

### `window.gh.session.params(): ParsedParams | null`

Returns the session parameters parsed from the landing URL and posted to `/session` during this visit, or `null` when the SDK skipped the POST (e.g., `connect.sid` cookie was already present).

### Event: `gh:session-ready`

Fires on `window` after `ensureSession` resolves (success or graceful failure). `event.detail` is `{ sessionId: string, hasConnectSid: boolean, params: ParsedParams | null }`. Useful for page authors who fire analytics events that need the session ID.

### Cookies managed by the SDK

| Name | Lifetime | Domain | Owner |
|---|---|---|---|
| `sessionId` | 30 days | Auto-detected root domain or `data-cookie-domain` | SDK (writes on first visit) |
| `connect.sid` | API-controlled | Set by API with `Domain=.brand.com` | API (SDK only reads) |
```

- [ ] **Step 2: Mirror the relevant SDK SPEC updates into the root `SPEC.md`**

The root `SPEC.md` is a near-duplicate of `packages/sdk/SPEC.md` for standalone-readability purposes (per the existing convention). Open both files, copy the same additions from Step 1 into the root `SPEC.md` at the corresponding sections.

- [ ] **Step 3: Update `packages/types/SPEC.md` with the new DTO field**

Find the section describing `HippoShopPricingDTO` and add a row for the new field:

```markdown
- `checkoutOverrideUrl: string | null` — optional override for the checkout base URL on handoff. When non-null, the SDK uses this URL instead of the brand-level `data-checkout-base`. When `null`, the brand default applies. Added in v3.x (Cluster F).
```

- [ ] **Step 4: Update `packages/sdk/README.md` with a usage example**

Find a logical place in the SDK README's "Quick start" or "Examples" section and add this snippet:

````markdown
### Checkout handoff

Capture attribution on landing and apply it to outbound checkout URLs:

```html
<script src="https://api-prod.goldenhippo.io/sdk/v3/gh.js"
        data-key="gh_pk_internal_gundry_abc123"
        data-brand="Gundry MD"
        data-checkout-base="https://checkout.gundrymd.com"></script>

<a data-gh-checkout="bio3-3p-sub">Buy now</a>
```

On click, the link navigates to `https://checkout.gundrymd.com/?order_form_id=…&session_id=…&utm_source=…&sub_id1=…` with attribution captured from the landing URL preserved.

The SDK also exposes a programmatic API:

```js
const url = window.gh.checkoutUrl('bio3-3p-sub'); // composed checkout URL
const sid = window.gh.session.id();               // 12-char session ID
```

See the [Cluster F design spec](../../docs/superpowers/specs/2026-05-19-cluster-f-session-utm-checkout-handoff-design.md) for the full data flow and configuration options.
````

- [ ] **Step 5: Verify all docs lint clean**

```bash
pnpm nx run-many -t lint
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/SPEC.md SPEC.md packages/types/SPEC.md packages/sdk/README.md
git commit -m "docs: Cluster F — document new attributes, gh.* surface, DTO field

- SDK SPEC and root SPEC gain entries for data-gh-checkout,
  data-checkout-base, data-cookie-domain, gh.checkoutUrl(),
  gh.session.id()/params(), gh:session-ready event, and the
  sessionId / connect.sid cookie table.
- Types SPEC gains the checkoutOverrideUrl row on HippoShopPricingDTO.
- SDK README gains a Checkout handoff quick-start example.

Part of Cluster F.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: SDK changeset + ROADMAP + final verify + push + PR

**Files:**
- Create: `.changeset/cluster-f-sdk-session-handoff.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Create the SDK changeset**

Create `.changeset/cluster-f-sdk-session-handoff.md` with this exact content:

```markdown
---
"@goldenhippo/hippo-shop-sdk": minor
---

Cluster F: SDK session, UTM, and checkout handoff.

The SDK now captures attribution on landing — parses UTM and click-id query
params (v1 ships fbclid → subId1='fb', subId5=<value>; the registry is
extensible), persists them via a POST to `/public/v1/session` (wrapped in
`affParameters`), and manages a 30-day `sessionId` cookie at the brand's
root domain. On checkout handoff, the SDK composes outbound URLs with
`order_form_id`, `session_id`, and the captured params.

New public surface:

- Script-tag attributes: `data-checkout-base`, `data-cookie-domain`.
- DOM attribute: `data-gh-checkout="<destination-slug>"` on `<a>` /
  `<button>` / arbitrary elements.
- `window.gh.checkoutUrl(slug)` — synchronous composed-URL getter.
- `window.gh.session.id()` / `window.gh.session.params()` — accessors.
- `gh:session-ready` event on `window` with `{ sessionId, hasConnectSid, params }`.

Every failure path is non-fatal: network errors, blocked cookies, missing
config — all log and degrade gracefully. Attribution may degrade for the
visit; the page never breaks.

Has hard API-side prerequisites (new `/public/v1/session` Kong route,
root-domain `Set-Cookie` for `connect.sid`, CORS-with-credentials) that
must land in parallel. The SDK ships safe even before the API side is in
place — the POST fails gracefully and the rest of the SDK continues to
work.

See `docs/superpowers/specs/2026-05-19-cluster-f-session-utm-checkout-handoff-design.md` for the full design.
```

- [ ] **Step 2: Move Cluster F entry in ROADMAP.md**

Open `ROADMAP.md`. Find the existing entry under "Open items":

```markdown
### Cluster F — SDK session, UTM, and checkout handoff
Status: idea
Added: 2026-05-17

Have the SDK manage a session cookie when one is not present and parse UTM parameters, including the Golden Hippo-specific click-id mapping (e.g. `fbclid` → `sub_id1=fb` and `sub_id5=fbcli`). On a `checkoutUrl` handoff — possibly supplied by destination details — auto-apply the correct UTM parameters. This would unlock a single per-brand checkout app at `checkout.brand_domain.com` consuming pages from anywhere. Large architectural commitment; probably warrants a spike before a full spec.
```

Delete it from "Open items". Add this new entry at the TOP of the "Done" section (above the current topmost done entry, matching the established newest-first order):

```markdown
### Cluster F — SDK session, UTM, and checkout handoff
Status: done
Added: 2026-05-17
Shipped: 2026-05-19 (PR #__)

Adds a session/UTM/checkout-handoff layer to the SDK. On landing, the SDK parses UTM and click-id query params (v1 click-id registry has fbclid → subId1='fb', subId5=<value>; the registry is extensible), POSTs them to `/public/v1/session` wrapped in `affParameters` (gated on absence of `connect.sid` cookie), and manages a 30-day `sessionId` cookie at the brand's auto-detected root domain. New `data-gh-checkout` attribute on `<a>` / `<button>` / arbitrary elements composes outbound URLs with `order_form_id`, `session_id`, and the captured params; `gh.checkoutUrl(slug)` is the programmatic equivalent. `gh:session-ready` event lets page authors hook into session resolution. Every failure mode is non-fatal — the page never breaks.

Has hard API-side prerequisites (new `/public/v1/session` Kong route, root-domain `Set-Cookie` for `connect.sid`, CORS-with-credentials) called out in the spec as parallel work.

Related: `docs/superpowers/specs/2026-05-19-cluster-f-session-utm-checkout-handoff-design.md`, `docs/superpowers/plans/2026-05-19-cluster-f-session-utm-checkout-handoff.md`, PR #__
```

Leave `PR #__` as a literal placeholder for now — Step 6 of this task fills in the actual PR number.

- [ ] **Step 3: Run full Nx verification suite**

```bash
pnpm nx run-many -t lint typecheck test build
```

Expected: all targets green across all 5 projects.

- [ ] **Step 4: Final dry-run smoke test of the SDK build**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk size
```

Expected: bundle size report. Should be under the existing budget; expected delta is +6–8KB minified pre-gzip.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git add .changeset/cluster-f-sdk-session-handoff.md ROADMAP.md
git commit -m "chore: ROADMAP — Cluster F done + SDK changeset

Move the Cluster F entry from 'Open items' to 'Done', referencing the
spec, plan, and (to-be-filled) PR number. Add the SDK minor changeset.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin feat/cluster-f-session-utm-checkout-handoff
```

Then open the PR with this command (the body is a heredoc; preserve all escaping):

```bash
gh pr create --title "feat(sdk): Cluster F — session, UTM, and checkout handoff" --body "$(cat <<'EOF'
## Summary

Adds a session/UTM/checkout-handoff layer to the SDK so static-HTML funnel pages capture attribution on landing, persist it via root-domain cookies + a POST to \`/public/v1/session\` (wrapped in \`affParameters\`), and apply it to outbound checkout URLs via a new \`data-gh-checkout\` attribute and \`gh.checkoutUrl(slug)\` programmatic API.

### What changes

- **Four new modules** in \`packages/sdk/src/\`: \`cookies.ts\`, \`url-params.ts\`, \`session.ts\`, \`checkout.ts\`. Matches the SDK's existing small-file pattern; each module is independently testable.
- **One new optional DTO field** on \`HippoShopPricingDTO\`: \`checkoutOverrideUrl: string | null\` (minor bump on \`@goldenhippo/hippo-shop-types\`).
- **Two new script-tag attributes**: \`data-checkout-base\`, \`data-cookie-domain\`.
- **One new DOM attribute**: \`data-gh-checkout="<destination-slug>"\` on \`<a>\` / \`<button>\` / arbitrary elements.
- **New \`window.gh.*\` surface**: \`checkoutUrl(slug)\`, \`session.id()\`, \`session.params()\`.
- **New lifecycle event**: \`gh:session-ready\` on window.
- **Click-id registry v1**: \`fbclid → subId1='fb', subId5=<value>\`. Adding more (gclid, ttclid, etc.) is a one-line registry edit.
- **Cookie domain auto-detect** with a conservative single-segment TLD allowlist (\`com, net, org, io, app, dev, ai, co, us, store, shop\`); multi-part TLDs require \`data-cookie-domain\`.
- **Session-ID generation** ported byte-for-byte from \`gh-utils/src/utils/session/session.ts\` for backward compatibility with funnel events.

### Failure handling

Every reachable failure is non-fatal: network errors, blocked cookies, missing config, malformed inputs — all log and degrade gracefully. Attribution may degrade for the visit; the user experience never does. See spec § Error handling for the full matrix.

### API-side prerequisites (parallel work)

This PR ships safe even before the API side is in place — the POST fails gracefully and the rest of the SDK continues to work. Operationally:

1. Expose \`POST /public/v1/session\` as a Kong route proxying to the commerce service's \`/session\` (translating \`X-GH-Key\` → BasicAuth).
2. Set \`Domain=.brand.com\` on the \`connect.sid\` \`Set-Cookie\` response so the cookie survives the \`info.brand.com → checkout.brand.com\` handoff.
3. CORS configuration: \`Access-Control-Allow-Credentials: true\` + per-origin \`Access-Control-Allow-Origin\` (not wildcard).
4. Update the OpenAPI spec at \`api-prod.goldenhippo.io/commerce/docs\` to show the \`{ affParameters: {…} }\` request body shape.

### Spec and plan

- Spec: [\`docs/superpowers/specs/2026-05-19-cluster-f-session-utm-checkout-handoff-design.md\`](https://github.com/GoldenHippoMedia/hippo-shop/blob/main/docs/superpowers/specs/2026-05-19-cluster-f-session-utm-checkout-handoff-design.md)
- Plan: [\`docs/superpowers/plans/2026-05-19-cluster-f-session-utm-checkout-handoff.md\`](https://github.com/GoldenHippoMedia/hippo-shop/blob/main/docs/superpowers/plans/2026-05-19-cluster-f-session-utm-checkout-handoff.md)

## Test Plan

- [x] \`pnpm nx run-many -t lint typecheck test build\` — all targets green
- [x] All new modules have dedicated spec files; ~50 new tests pass
- [x] \`pnpm nx test sdk\` runs 150+ tests total with no failures
- [x] \`pnpm --filter @goldenhippo/hippo-shop-sdk size\` is within budget
- [ ] **Post-merge (after API side ships):** real-brand smoke test:
  - Land on \`https://info.<brand>.com/<funnel>?fbclid=test123\`
  - Verify \`sessionId\` cookie set at \`.brand.com\`
  - Verify \`connect.sid\` cookie set at \`.brand.com\`
  - Verify \`gh:session-ready\` event fires
  - Verify \`[data-gh-checkout]\` href contains \`session_id=…&sub_id1=fb&sub_id5=test123\`
  - Navigate to checkout; confirm both cookies survive

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL/number from the output.

- [ ] **Step 6: Fill in the PR number in ROADMAP placeholders**

```bash
PR_NUM=N  # replace N with the actual number from gh pr create output
sed -i.bak "s/PR #__/PR #${PR_NUM}/g" ROADMAP.md && rm ROADMAP.md.bak
grep -n "PR #" ROADMAP.md | head -5  # sanity check
git add ROADMAP.md
git commit -m "chore: fill in PR number in ROADMAP Cluster F entry

Replace the PR #__ placeholders in the Cluster F done entry with the
real PR number from gh pr create.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Self-Review (already performed)

**Spec coverage:**

- ✅ Decisions § Scope (session API + handoff + click-id in code) — Tasks 3, 4, 6, 7, 8 implement; Task 1 adds the DTO field; Task 2 + Task 9 wire config and boot.
- ✅ Click-id v1 (fbclid → subId1='fb', subId5=value) — Task 4 (`CLICK_ID_REGISTRY`).
- ✅ Checkout URL source (brand base + DTO override) — Task 1 (DTO field) + Task 7 (composeCheckoutUrl resolution order).
- ✅ Handoff API (data-gh-checkout + gh.checkoutUrl) — Task 8 (DOM bindings) + Task 9 (window.gh wire-up).
- ✅ Cookie domain auto-detect with TLD allowlist + override — Task 3 (cookies.ts).
- ✅ Session cookie name `sessionId`, gh-utils algorithm, 30-day root-domain — Task 6 (session.ts).
- ✅ POST timing (once per visit if no connect.sid) — Task 6 (ensureSession).
- ✅ Code structure (4 split modules) — Tasks 3, 4, 6, 7+8.
- ✅ Auth scheme (public-route gateway, `X-GH-Key`) — Task 5 (postJson uses existing headers; Kong work is API-side, called out in the spec and the PR body).
- ✅ POST body shape `{ affParameters: { … } }` — Task 6 (ensureSession), Task 5 tests.
- ✅ Error handling matrix — Tasks 3–8 (each module handles its own failure paths); Task 6 wraps the POST in try/catch.
- ✅ Testing strategy (vitest + jsdom, four new spec files) — Tasks 3, 4, 6, 7+8.
- ✅ Public surface changes table — Task 1 (DTO), Task 2 (config), Task 8 (DOM attr + window.gh), Task 6 (event), Task 10 (docs).
- ✅ File plan — every file in the spec's file plan appears in this plan's File Structure section and is touched by at least one task.
- ✅ API-side requirements — called out in spec; surfaced in PR body (Task 11).
- ✅ ROADMAP mutation — Task 11 step 2.

**Placeholder scan:**

- The only `__` is in the ROADMAP entry's `PR #__`, which is intentional and explicitly replaced in Task 11 Step 6.
- Task 9 Step 2 contains a placeholder `expect(true).toBe(true)` runtime test — explicitly called out as needing replacement once the implementer has the test scaffolding context. This is a known limitation of writing the plan without seeing the existing `runtime.spec.ts` test patterns up close; the implementer can either replace it with a real assertion or rely on `applyCheckoutBindings` tests (Task 8) + boot-wiring tests (Task 9 index.spec.ts) for coverage.

**Type consistency:**

- `ParsedParams` (Task 4) ↔ `SessionState.params` (Task 6) ↔ `composeCheckoutUrl(session: SessionState)` (Task 7) — names and shapes match across tasks.
- `getCookieDomain(config: GhConfig)` (Task 3) ↔ `config.cookieDomain` field (Task 2) — consistent.
- `applyCheckoutBindings(root, opts)` (Task 8) ↔ runtime.bind() caller (Task 9) — `CheckoutBindingsOptions` shape lines up.
- `getCachedDestination` / `ensureDestination` methods added in Task 9 to `GhRuntime` ↔ used by `index.ts` and `applyCheckoutBindings` callers — names match.
- `gh:session-ready` event name appears consistently in Task 6 (dispatch), Task 9 (listener), and Task 10 (docs).

**Known limitation:**

The Task 9 runtime-binding test (Step 2) is a stub the implementer must replace. The existing `runtime.spec.ts` test scaffolding wasn't fully traced when writing this plan; the implementer should look at how existing tests construct a runtime + mock client + DOM and adapt one to verify the `data-gh-checkout` href rewrite. As a fallback, the `applyCheckoutBindings` tests in Task 8 + the `index.spec.ts` integration tests in Task 9 Step 1 provide functional coverage even if this specific test stays a stub.
