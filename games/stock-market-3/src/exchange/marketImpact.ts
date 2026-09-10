import type { Sector } from '../types.js';

const IMPACT_WEIGHT = 0.015;

/**
 * Small next-round cross-asset market impact (spec §35): a symbol's own realized order-flow
 * imbalance this round nudges its SAME-SECTOR peers' fundamental value next round — never the
 * symbol itself again (that's already fully reflected in its own realized price) and never a large
 * enough effect to make cornering one security a profitable way to move another (spec §35's
 * explicit "not trivial to manipulate" requirement). Index impact is deliberately not modeled here
 * separately — the index's own fundamental value already inherits every constituent's realized
 * return, flow-driven or not, via `market/syntheticIndex.ts`.
 */
export function computeSectorImpactNudges(args: {
  netDemandBySymbol: ReadonlyMap<string, number>;
  averageDailyVolume: number;
  sectorOfSymbol: ReadonlyMap<string, Sector | null>;
}): Record<string, number> {
  const { netDemandBySymbol, averageDailyVolume, sectorOfSymbol } = args;

  const flowImbalanceBySymbol = new Map<string, number>();
  for (const [symbol, netDemand] of netDemandBySymbol) {
    flowImbalanceBySymbol.set(symbol, Math.max(-1, Math.min(1, netDemand / Math.max(1, averageDailyVolume))));
  }

  const symbolsBySector = new Map<Sector, string[]>();
  for (const [symbol, sector] of sectorOfSymbol) {
    if (sector === null) {
      continue;
    }
    const list = symbolsBySector.get(sector) ?? [];
    list.push(symbol);
    symbolsBySector.set(sector, list);
  }

  const nudges: Record<string, number> = {};
  for (const [symbol, sector] of sectorOfSymbol) {
    if (sector === null) {
      nudges[symbol] = 0;
      continue;
    }
    const peers = (symbolsBySector.get(sector) ?? []).filter((peer) => peer !== symbol);
    if (peers.length === 0) {
      nudges[symbol] = 0;
      continue;
    }
    const peerAverage = peers.reduce((sum, peer) => sum + (flowImbalanceBySymbol.get(peer) ?? 0), 0) / peers.length;
    nudges[symbol] = IMPACT_WEIGHT * peerAverage;
  }
  return nudges;
}
