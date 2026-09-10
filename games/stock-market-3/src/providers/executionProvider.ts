import { StockMarket3ActionSchema, type PublicOpenOrder, type StockMarket3Action, type StockMarket3State } from '../types.js';
import { buildObservation } from '../observation/buildObservation.js';

/**
 * The bot-facing execution boundary (spec §45/§65), paired with `MarketDataProvider`. This turn-
 * based engine has no standalone imperative "place an order right now" call outside of a round —
 * every order is decided against one observation snapshot and actually executes at the next
 * `GameDefinition.resolve()` boundary (spec §30). `validateOrders` here does the same structural
 * checking `game.ts`'s own `validateAction` does, exposed as its own named seam so a future
 * `HistoricalExecutionProvider`/`PaperTradingExecutionProvider` has a concrete shape to implement
 * (accept/reject a submission; real economic feasibility is still resolved at match time either
 * way, same as this game's own `exchange/matchingEngine.ts`).
 */
export interface ExecutionProvider {
  validateOrders(raw: unknown): { ok: true; action: StockMarket3Action } | { ok: false; reason: string };
  getOpenOrders(participantId: string): PublicOpenOrder[];
}

export function createSyntheticExecutionProvider(state: StockMarket3State): ExecutionProvider {
  return {
    validateOrders(raw: unknown) {
      const result = StockMarket3ActionSchema.safeParse(raw);
      return result.success
        ? { ok: true, action: result.data }
        : { ok: false, reason: result.error.issues.map((issue) => issue.message).join('; ') };
    },
    getOpenOrders(participantId: string) {
      return buildObservation(state, participantId).portfolio.openOrders;
    },
  };
}
