import { buildObservation } from '../observation/buildObservation.js';
import type { DailyCandle, SecurityObservation, StockMarket3State } from '../types.js';

/**
 * The bot-facing market-data boundary (spec §45/§65) — a game-agnostic shape a future
 * `HistoricalMarketDataProvider`/`LiveMarketDataProvider` could implement without the rest of this
 * game's code (or a bot's own strategy logic) needing to change. This is an internal-engine
 * abstraction, not a second wire protocol: the actual bot-facing transport stays the existing
 * NDJSON `GameDefinition` contract (`getObservation`), which already *is* this repo's data
 * boundary. `SyntheticMarketDataProvider` below is what `game.ts` could route `getObservation`
 * through if/when a second implementation of this interface exists; today it's exercised directly
 * by tests to prove the seam behaves correctly, since nothing else in this game needs it yet.
 */
export interface MarketDataProvider {
  getUniverse(): { symbol: string; kind: SecurityObservation['kind']; sector: SecurityObservation['sector'] }[];
  getMarketSnapshot(participantId: string): SecurityObservation[];
  getHistoricalBars(symbol: string, roundsBack: number): DailyCandle[];
}

export function createSyntheticMarketDataProvider(state: StockMarket3State): MarketDataProvider {
  return {
    getUniverse() {
      return [...state.securities.values()]
        .filter((security) => security.active)
        .map((security) => ({ symbol: security.symbol, kind: security.kind, sector: security.sector }));
    },
    getMarketSnapshot(participantId: string) {
      return buildObservation(state, participantId).securities;
    },
    getHistoricalBars(symbol: string, roundsBack: number) {
      const security = state.securities.get(symbol);
      return security === undefined ? [] : security.priceHistory.slice(-roundsBack);
    },
  };
}
