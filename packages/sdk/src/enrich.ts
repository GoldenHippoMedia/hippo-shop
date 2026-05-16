import type { HippoShopProductDTO } from '@goldenhippo/hippo-shop-types';

const PURCHASE_TYPES = ['subscription', 'oneTime'] as const;
const TIERS = ['standard', 'myAccount'] as const;

/**
 * Attach the `<tier>List` and `<tier>ByQuantity` sibling fields to every
 * price level on a product. Pure mutation — the input object is the same
 * reference returned. The deprecated `<tier>` arrays are passed through
 * by reference (no clone) and become the value of `<tier>List`.
 *
 * Duplicate `quantity` values in an input array collapse to last-wins in
 * the record; the list preserves the original order including duplicates.
 */
export function enrichProduct(raw: HippoShopProductDTO): HippoShopProductDTO {
  const variants = (raw as unknown as { variants?: Record<string, unknown> }).variants;
  if (!variants) return raw;
  for (const purchase of PURCHASE_TYPES) {
    const branch = variants[purchase] as Record<string, unknown> | undefined;
    if (!branch) continue;
    for (const tier of TIERS) {
      const arr = branch[tier];
      // Tolerate a malformed branch — the SDK is a thin pass-through and we'd
      // rather degrade than blow up if the server omits a price level.
      const list = Array.isArray(arr) ? arr : [];
      branch[`${tier}List`] = list;
      branch[`${tier}ByQuantity`] = Object.fromEntries(
        list.map((v) => [String((v as { quantity: number }).quantity), v]),
      );
    }
  }
  return raw;
}
