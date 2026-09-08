import type { DailyCandle } from '../types.js';

/** Daily log returns from a candle series — the common input every check below starts from. */
export function logReturns(history: readonly DailyCandle[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const current = history[i];
    if (prev === undefined || current === undefined || prev.close <= 0 || current.close <= 0) {
      continue;
    }
    returns.push(Math.log(current.close / prev.close));
  }
  return returns;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function stdDev(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Pearson correlation over the overlapping (equal-length, index-aligned) portion of both series. */
export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) {
    return 0;
  }
  const trimmedA = a.slice(-n);
  const trimmedB = b.slice(-n);
  const meanA = mean(trimmedA);
  const meanB = mean(trimmedB);
  let numerator = 0;
  let sumSqA = 0;
  let sumSqB = 0;
  for (let i = 0; i < n; i++) {
    const da = (trimmedA[i] ?? 0) - meanA;
    const db = (trimmedB[i] ?? 0) - meanB;
    numerator += da * db;
    sumSqA += da * da;
    sumSqB += db * db;
  }
  const denominator = Math.sqrt(sumSqA * sumSqB);
  return denominator === 0 ? 0 : numerator / denominator;
}

/** A full symmetric correlation matrix across every symbol's return series — the statistic
 * spec §55/§56 asks a validation pass to inspect for pathological cases (everything at 1.0,
 * everything at 0.0, one factor visibly dominating every pair). */
export function correlationMatrix(returnsBySymbol: Readonly<Record<string, number[]>>): Record<string, Record<string, number>> {
  const symbols = Object.keys(returnsBySymbol);
  const matrix: Record<string, Record<string, number>> = {};
  for (const a of symbols) {
    const row: Record<string, number> = {};
    for (const b of symbols) {
      row[b] = a === b ? 1 : correlation(returnsBySymbol[a] ?? [], returnsBySymbol[b] ?? []);
    }
    matrix[a] = row;
  }
  return matrix;
}

const TRADING_DAYS_PER_YEAR = 252;

export function annualizedVolatility(returns: readonly number[]): number {
  return stdDev(returns) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}
