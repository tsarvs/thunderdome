import { afterEach, describe, expect, it, vi } from 'vitest';
import { printStockPriceRange } from '../src/commands/match.js';

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
