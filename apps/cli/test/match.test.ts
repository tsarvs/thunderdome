import { afterEach, describe, expect, it, vi } from 'vitest';
import { printPortfolioSummaries, printSecurityPriceTable, printStockPriceRange } from '../src/commands/match.js';

describe('printStockPriceRange', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the range for a result carrying startingStockPrice/finalStockPrice (Stock Market)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printStockPriceRange({ startingStockPrice: 135.76, finalStockPrice: 140.21 });
    expect(log).toHaveBeenCalledWith('  (stock price: $135.76 → $140.21)');
  });

  it('prints the range for a result carrying startingPrice/finalPrice (Stock Market 2)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printStockPriceRange({ startingPrice: 100, finalPrice: 99.27 });
    expect(log).toHaveBeenCalledWith('  (stock price: $100.00 → $99.27)');
  });

  it('prefers startingStockPrice/finalStockPrice when a result somehow carries both pairs', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printStockPriceRange({
      startingStockPrice: 1,
      finalStockPrice: 2,
      startingPrice: 3,
      finalPrice: 4,
    });
    expect(log).toHaveBeenCalledWith('  (stock price: $1.00 → $2.00)');
  });

  it('is a no-op for a result with neither pair of fields', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printStockPriceRange({ winnerId: 'alice' });
    expect(log).not.toHaveBeenCalled();
  });

  it('is a no-op for non-object results', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printStockPriceRange(null);
    printStockPriceRange(undefined);
    printStockPriceRange('not an object');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('printSecurityPriceTable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints a before -> after line per security (Stock Market 3)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printSecurityPriceTable({
      securityPrices: [
        { symbol: 'ACME', startingPrice: 100, finalPrice: 140.21 },
        { symbol: 'BETA', startingPrice: 50, finalPrice: 12.5 },
      ],
    });
    expect(log).toHaveBeenCalledWith('  Security prices (before -> after):');
    expect(log).toHaveBeenCalledWith('    ACME: $100.00 -> $140.21 (+40.2%)');
    expect(log).toHaveBeenCalledWith('    BETA: $50.00 -> $12.50 (-75.0%)');
  });

  it('is a no-op for a result with no securityPrices field', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printSecurityPriceTable({ winnerId: 'alice' });
    expect(log).not.toHaveBeenCalled();
  });

  it('is a no-op for non-object results', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printSecurityPriceTable(null);
    printSecurityPriceTable('not an object');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('printPortfolioSummaries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints cash/equity and each open position per participant (Stock Market 3)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printPortfolioSummaries({
      portfolioSummaries: {
        alice: {
          cash: 5000,
          equity: 10500.5,
          bankrupt: false,
          positions: [{ symbol: 'ACME', shares: 100, averageEntryPrice: 90, marketValue: 14021, unrealizedPnl: 5021 }],
        },
        bob: { cash: 0, equity: 0, bankrupt: true, positions: [] },
      },
    });
    expect(log).toHaveBeenCalledWith('  Bot portfolios:');
    expect(log).toHaveBeenCalledWith('    alice: equity $10500.50, cash $5000.00');
    expect(log).toHaveBeenCalledWith('      ACME: 100 sh @ avg $90.00, value $14021.00 (+$5021.00 unrealized)');
    expect(log).toHaveBeenCalledWith('    bob: equity $0.00, cash $0.00 [BANKRUPT]');
    expect(log).toHaveBeenCalledWith('      (no open positions)');
  });

  it('is a no-op for a result with no portfolioSummaries field', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printPortfolioSummaries({ winnerId: 'alice' });
    expect(log).not.toHaveBeenCalled();
  });

  it('is a no-op for non-object results', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printPortfolioSummaries(null);
    printPortfolioSummaries('not an object');
    expect(log).not.toHaveBeenCalled();
  });
});
