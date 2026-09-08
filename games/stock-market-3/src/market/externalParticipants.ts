import type { DailyCandle } from '../types.js';

/**
 * Deterministic synthetic market participants (spec §32) — rather than simulating discrete agent
 * orders, each archetype below contributes a small directional bias to that round's order flow,
 * which `exchange/liquidity.ts` turns into an asymmetric bid/ask ladder (more resting size on the
 * side external participants are effectively "selling into"). This is what keeps bots from ever
 * depending on each other for liquidity/volume/spread (spec §32) while still producing distinct,
 * behaviorally-motivated flow rather than one flat formula:
 *
 *  - Market makers: the underlying symmetric ladder itself (`liquidity.ts`, ported from
 *    games/stock-market-2) — always present, regime-scaled, directionally neutral.
 *  - Momentum funds: chase the security's own recent trend.
 *  - Value/institutional funds: lean against the security's gap from its own trailing average
 *    (a source of genuine, discoverable mean reversion in the order-flow layer, distinct from the
 *    VALUE style's effect on the fundamental value itself).
 *  - Index funds: a small, steady net-buy tilt on the index specifically (passive inflows).
 *  - Retail: chases whatever fired this round's own event, in whatever direction it went.
 *
 * Output is a signed bias, clamped to [-1, 1] before the caller scales it into an actual quantity
 * multiplier — never itself exposed to bots (only its downstream effect on quotes/depth/fills is).
 */
export function computeExternalFlowBias(args: {
  symbol: string;
  indexSymbol: string;
  priceHistory: readonly DailyCandle[];
  eventImpactReturn: number;
}): number {
  const { symbol, indexSymbol, priceHistory, eventImpactReturn } = args;

  const recent = priceHistory[priceHistory.length - 1];
  const shortAgo = priceHistory[priceHistory.length - 6];
  const momentumBias =
    recent !== undefined && shortAgo !== undefined && shortAgo.close > 0
      ? clamp(Math.log(recent.close / shortAgo.close) * 8, -1, 1)
      : 0;

  const longWindow = priceHistory.slice(-30);
  const longAverage = longWindow.length >= 10 ? longWindow.reduce((sum, c) => sum + c.close, 0) / longWindow.length : null;
  const valueBias =
    longAverage !== null && recent !== undefined && recent.close > 0
      ? clamp(Math.log(longAverage / recent.close) * 4, -1, 1)
      : 0;

  const indexFundBias = symbol === indexSymbol ? 0.05 : 0;
  const retailBias = clamp(eventImpactReturn * 6, -1, 1);

  return clamp(0.4 * momentumBias - 0.3 * valueBias + indexFundBias + 0.3 * retailBias, -1, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
