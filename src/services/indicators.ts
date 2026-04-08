/**
 * Technical Indicators Module v4.0 — "Hardened" Edition
 *
 * v4.0 CHANGES:
 * ─ Every division operation now has strict NaN/Infinity/zero guards
 * ─ All array access validated against bounds
 * ─ EMA seed handles edge case where period > prices.length
 * ─ RSI guards against zero-length gains/losses
 * ─ MACD alignment: slice(25) + 25-zero pad (confirmed correct)
 * ─ Stochastic guards flat-range markets (range === 0 → 50)
 * ─ Bollinger guards zero SMA and zero bandwidth
 * ─ LinearRegression guards zero denominator and zero ssTot
 *
 * Pure functions for calculating trading indicators:
 * - EMA (Exponential Moving Average)
 * - RSI (Relative Strength Index) — Wilder smoothing
 * - MACD (Moving Average Convergence Divergence) — v3.2 FIX: off-by-one alignment
 * - ATR (Average True Range)
 * - EMA Slope (trend momentum)
 * - EMA Gap (percentage distance between two EMAs)
 * - Bollinger Bands (mean-reversion / breakout detection)
 * - Stochastic Oscillator (%K / %D momentum)
 * - Standard Deviation (rolling)
 * - Linear Regression (slope + R² + deviation)
 * - Z-Score (standardized deviation)
 */

// ─── Safe math utility (shared) ─────────────────────────────

function safe(val: number, fallback = 0): number {
  return Number.isFinite(val) ? val : fallback;
}

// ─── EMA ─────────────────────────────────────────────────────

export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0 || period < 1) return [];
  // Clamp period to available data
  const effectivePeriod = Math.min(period, prices.length);
  const k = 2 / (effectivePeriod + 1);
  const ema: number[] = new Array(prices.length).fill(0);

  let sum = 0;
  for (let i = 0; i < effectivePeriod; i++) sum += safe(prices[i]);
  ema[effectivePeriod - 1] = effectivePeriod > 0 ? sum / effectivePeriod : 0;

  for (let i = effectivePeriod; i < prices.length; i++) {
    ema[i] = safe(prices[i]) * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

// ─── RSI ─────────────────────────────────────────────────────

export function calculateRSI(prices: number[], period = 14): number[] {
  const rsi: number[] = new Array(prices.length).fill(50);
  if (prices.length < period + 1 || period < 1) return rsi;

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const change = safe(prices[i]) - safe(prices[i - 1]);
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Guard: both zero = flat market → RSI 50
  rsi[period] = (avgGain === 0 && avgLoss === 0) ? 50
    : avgLoss === 0 ? 100
    : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rsi[i + 1] = (avgGain === 0 && avgLoss === 0) ? 50
      : avgLoss === 0 ? 100
      : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

// ─── MACD ────────────────────────────────────────────────────
// v3.2 FIX: Off-by-one alignment correction.
// EMA26 is first valid at index 25 (0-indexed), so we slice(25) not slice(26).
// Signal line padding uses 25 zeros to perfectly align with the MACD array.

export function calculateMACD(prices: number[]): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  if (prices.length < 26) {
    const empty = new Array(prices.length).fill(0);
    return { macd: empty, signal: empty, histogram: empty };
  }

  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = prices.map((_, i) => safe(ema12[i]) - safe(ema26[i]));

  // v3.2 FIX: EMA26 first valid at index 25 (0-indexed), so MACD is valid from index 25
  const validMacd = macd.slice(25);
  const signal = calculateEMA(validMacd, 9);

  // Pad with 25 zeros to re-align signal array with the full MACD array
  const paddedSignal = new Array(25).fill(0).concat(signal);

  const histogram = macd.map((v, i) => safe(v) - safe(paddedSignal[i]));
  return { macd, signal: paddedSignal, histogram };
}

// ─── ATR (Average True Range) ────────────────────────────────

export function calculateATR(prices: number[], period = 14): number[] {
  const atr: number[] = new Array(prices.length).fill(0);
  if (prices.length < 2 || period < 1) return atr;

  const trueRanges: number[] = [0];
  for (let i = 1; i < prices.length; i++) {
    trueRanges.push(Math.abs(safe(prices[i]) - safe(prices[i - 1])));
  }

  if (prices.length >= period + 1) {
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += trueRanges[i];
    atr[period] = sum / period;

    for (let i = period + 1; i < prices.length; i++) {
      atr[i] = (atr[i - 1] * (period - 1) + trueRanges[i]) / period;
    }
  }

  return atr;
}

// ─── EMA Slope (rate of change over lookback) ────────────────

export function calculateEMASlope(ema: number[], lookback = 5): number[] {
  const slope: number[] = new Array(ema.length).fill(0);
  for (let i = lookback; i < ema.length; i++) {
    const base = safe(ema[i - lookback]);
    if (base !== 0) {
      slope[i] = (safe(ema[i]) - base) / lookback;
    }
  }
  return slope;
}

// ─── EMA Gap (percentage distance between two EMAs) ──────────

export function calculateEMAGap(ema9: number[], ema21: number[], prices: number[]): number[] {
  return prices.map((price, i) => {
    const p = safe(price);
    const e21 = safe(ema21[i]);
    if (p === 0 || e21 === 0) return 0;
    return ((safe(ema9[i]) - e21) / p) * 100;
  });
}

// ─── Bollinger Bands ─────────────────────────────────────────
// Returns upper, middle (SMA), lower bands and %B position

export interface BollingerBands {
  upper: number[];
  middle: number[];
  lower: number[];
  percentB: number[];   // (price - lower) / (upper - lower), 0-1 = inside bands
  bandwidth: number[];  // (upper - lower) / middle, volatility measure
}

export function calculateBollingerBands(prices: number[], period = 20, stdDevMultiplier = 2): BollingerBands {
  const len = prices.length;
  const upper: number[] = new Array(len).fill(0);
  const middle: number[] = new Array(len).fill(0);
  const lower: number[] = new Array(len).fill(0);
  const percentB: number[] = new Array(len).fill(0.5);
  const bandwidth: number[] = new Array(len).fill(0);

  for (let i = period - 1; i < len; i++) {
    // SMA
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += safe(prices[j]);
    const sma = period > 0 ? sum / period : 0;

    // Standard deviation
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (safe(prices[j]) - sma) ** 2;
    const stdDev = period > 0 ? Math.sqrt(sqSum / period) : 0;

    middle[i] = sma;
    upper[i] = sma + stdDevMultiplier * stdDev;
    lower[i] = sma - stdDevMultiplier * stdDev;

    const bandWidth = upper[i] - lower[i];
    // Guard: zero bandwidth (flat market) → price is at midpoint
    percentB[i] = bandWidth > 0 ? (safe(prices[i]) - lower[i]) / bandWidth : 0.5;
    // Guard: zero SMA → bandwidth ratio undefined
    bandwidth[i] = sma > 0 ? bandWidth / sma : 0;
  }

  return { upper, middle, lower, percentB, bandwidth };
}

// ─── Stochastic Oscillator ───────────────────────────────────
// %K = (close - lowest low) / (highest high - lowest low) × 100
// %D = SMA of %K

export interface StochasticResult {
  k: number[];  // Fast %K
  d: number[];  // Slow %D (SMA of %K)
}

export function calculateStochastic(prices: number[], kPeriod = 14, dPeriod = 3): StochasticResult {
  const len = prices.length;
  const k: number[] = new Array(len).fill(50);
  const d: number[] = new Array(len).fill(50);

  for (let i = kPeriod - 1; i < len; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      const p = safe(prices[j]);
      if (p > highest) highest = p;
      if (p < lowest) lowest = p;
    }
    const range = highest - lowest;
    // Guard: zero range (flat market) → midpoint 50
    k[i] = range > 0 ? ((safe(prices[i]) - lowest) / range) * 100 : 50;
  }

  // %D = SMA of %K
  for (let i = kPeriod - 1 + dPeriod - 1; i < len; i++) {
    let sum = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) sum += k[j];
    d[i] = dPeriod > 0 ? sum / dPeriod : 50;
  }

  return { k, d };
}

// ─── Standard Deviation (rolling) ────────────────────────────

export function calculateStdDev(prices: number[], period = 20): number[] {
  const len = prices.length;
  const result: number[] = new Array(len).fill(0);

  for (let i = period - 1; i < len; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += safe(prices[j]);
    const mean = period > 0 ? sum / period : 0;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (safe(prices[j]) - mean) ** 2;
    result[i] = period > 0 ? Math.sqrt(sqSum / period) : 0;
  }

  return result;
}

// ─── Linear Regression (slope + R² + deviation) ─────────────
// Returns: slope (direction/momentum), r2 (fit quality), deviation (distance from regression line)

export interface LinearRegressionResult {
  slope: number[];      // Rate of change per bar
  r2: number[];         // Coefficient of determination (0-1, higher = stronger trend)
  deviation: number[];  // Current price distance from regression line (in price units)
  predicted: number[];  // Regression predicted value at each bar
}

export function calculateLinearRegression(prices: number[], period = 20): LinearRegressionResult {
  const len = prices.length;
  const slope: number[] = new Array(len).fill(0);
  const r2: number[] = new Array(len).fill(0);
  const deviation: number[] = new Array(len).fill(0);
  const predicted: number[] = new Array(len).fill(0);

  for (let i = period - 1; i < len; i++) {
    // Least squares regression over window
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    const n = period;

    for (let j = 0; j < n; j++) {
      const x = j;
      const y = safe(prices[i - period + 1 + j]);
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const denom = n * sumX2 - sumX * sumX;
    // Guard: zero denominator = degenerate case (single point or all same x)
    if (denom === 0) continue;

    const m = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - m * sumX) / n;

    slope[i] = safe(m);
    predicted[i] = safe(m * (n - 1) + b); // Value at the last bar of the window
    deviation[i] = safe(prices[i]) - predicted[i];

    // R² calculation
    const yMean = n > 0 ? sumY / n : 0;
    let ssTot = 0, ssRes = 0;
    for (let j = 0; j < n; j++) {
      const y = safe(prices[i - period + 1 + j]);
      const yHat = m * j + b;
      ssTot += (y - yMean) ** 2;
      ssRes += (y - yHat) ** 2;
    }
    // Guard: ssTot === 0 means all prices identical → perfect "fit" but no trend
    r2[i] = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;
  }

  return { slope, r2, deviation, predicted };
}

// ─── Z-Score (standardized deviation) ────────────────────────
// How many standard deviations the current price is from the mean

export function calculateZScore(prices: number[], period = 20): number[] {
  const len = prices.length;
  const result: number[] = new Array(len).fill(0);

  for (let i = period - 1; i < len; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += safe(prices[j]);
    const mean = period > 0 ? sum / period : 0;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (safe(prices[j]) - mean) ** 2;
    const stdDev = period > 0 ? Math.sqrt(sqSum / period) : 0;

    // Guard: zero stdDev (flat market) → z-score 0
    result[i] = stdDev > 0 ? (safe(prices[i]) - mean) / stdDev : 0;
  }

  return result;
}
