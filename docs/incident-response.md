# Incident response runbook

Hippo Shop sits between Kong and the commerce API. Most incidents resolve at the gateway in seconds; bundle issues take a Cloudflare redeploy. This document covers the four scenarios we have actually run drills for.

## 1. Purge the edge cache

Kong `proxy-cache` is TTL-based (funnel 60s, destination 60s, product 120s). If a price change needs immediate propagation:

```bash
# Single key
curl -X DELETE \
  -H "Kong-Admin-Token: $KONG_ADMIN_TOKEN" \
  https://kong-admin.internal/proxy-cache/<cache-key>

# Whole service
curl -X DELETE \
  -H "Kong-Admin-Token: $KONG_ADMIN_TOKEN" \
  https://kong-admin.internal/services/hippo-shop-public-v1/proxy-cache
```

Wait 10 seconds, hit the route from an allowed origin, confirm new payload.

## 2. Revoke a partner key

Effective globally within seconds. The partner's pages will start returning 401 from Kong.

1. Kong Admin UI → Consumers → `partner-<slug>` → Credentials → Key Auth.
2. Delete the credential.
3. Notify partner-relations to communicate with the partner.
4. Tag the consumer with `revoked:<YYYY-MM-DD>:<reason-slug>` for audit.

To restore: add a new credential with a fresh key; the old key is *not* reactivated.

## 3. Roll back the SDK bundle

1. Find the previous Cloudflare Pages deployment in the dashboard.
2. Hit **Rollback to this deployment**.
3. If Kong's `/sdk/v1/*` upstream targets a hash-pinned URL, update it back to the prior hash:
   - Kong Admin UI → Services → `hippo-shop-sdk-delivery` → upstream URL.
4. Bust the edge cache for `/sdk/v1/gh.js` if you've changed the moving channel.

The moving channel `Cache-Control` is `public, max-age=300, stale-while-revalidate=86400`. Worst-case partner refresh is ~5 minutes for fresh, ~24 hours for stale-OK. Hash-pinned URLs are immutable — they will continue serving the prior version until partner pages stop referencing the prior hash.

## 4. "A partner is being abusive"

1. Read recent traffic from the Kong dashboard for the partner's consumer.
2. If it's plausibly accidental (a runaway loop), email partner-relations with the consumer ID and traffic curve. Lower the rate-limit tier from standard to a quarter of standard temporarily.
3. If it's clearly malicious or there's an active investigation, **revoke the key (section 2)** first, then communicate.
4. Document the incident — partner ID, what happened, what we did, who decided what.

## 5. "Bundle 404s for some region"

1. Check [Cloudflare status](https://www.cloudflarestatus.com/).
2. If Cloudflare is healthy, check Kong's `/sdk/v1/*` route logs for upstream errors.
3. Fallback path for partners: have them switch their `<script src="">` to the hash-pinned URL from `manifest.json` — those are immutable and can be served from a different edge if needed.
4. If the issue persists beyond ~5 minutes, escalate to platform on-call.

## Drills

The cache-purge drill (section 1) is exercised quarterly. The runbook above is updated whenever a drill reveals a step that's wrong or missing.
