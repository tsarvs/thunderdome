// Shared between `matchForwardRefresh.ts` and `matchForwardStatus.ts` — both need to read a
// persisted forward match's own `FORWARD_SHADOW` config fields without a real game/config parse.
import path from 'node:path';

export function defaultForwardMatchStoreDir(rootDir: string): string {
  return path.join(rootDir, '.thunderdome', 'forward-matches');
}

export interface MarketDatasetRef {
  id: string;
  version: string;
  storeDir?: string;
}

/** `record.config` is opaque (`unknown`) to `@thunderdome/forward-match-store` — this reads only
 * the two `FORWARD_SHADOW` fields these commands need, the same SM4-specific duck-typing
 * `matchForward.ts`'s own module comment already establishes as this file's convention. */
export function readForwardShadowFields(
  config: unknown,
): { marketDataUniverse: string[]; marketDataset: MarketDatasetRef } | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const c = config as Record<string, unknown>;
  const universe = c.marketDataUniverse;
  const dataset = c.marketDataset;
  if (!Array.isArray(universe) || !universe.every((t) => typeof t === 'string')) return undefined;
  if (typeof dataset !== 'object' || dataset === null) return undefined;
  const d = dataset as Record<string, unknown>;
  if (typeof d.id !== 'string' || typeof d.version !== 'string') return undefined;
  return {
    marketDataUniverse: universe,
    marketDataset: {
      id: d.id,
      version: d.version,
      ...(typeof d.storeDir === 'string' ? { storeDir: d.storeDir } : {}),
    },
  };
}
