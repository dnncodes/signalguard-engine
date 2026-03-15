/**
 * Technical Indicators Module v3.1
 * 
 * Pure functions for calculating trading indicators:
 * - EMA (Exponential Moving Average)
 * - RSI (Relative Strength Index) — Wilder smoothing
 * - MACD (Moving Average Convergence Divergence)
 * - ATR (Average True Range)
 * - EMA Slope (trend momentum)
 * - EMA Gap (percentage distance between two EMAs)
 * - Bollinger Bands (mean-reversion / breakout detection)
 * - Stochastic Oscillator (%K / %D momentum)
 */

// ─── EMA ─────────────────────────────────────────────────────

export function calculateEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = new Array(prices.length).fill(0);
  let sum = 0;
  for (let i = 0; i < period && i < prices.length; i++) sum += prices[i];
  ema[period - 1] = sum / period;
  for (let i = period; i < prices.length; i++) {
    ema[i] = prices[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

// ─── RSI ─────────────────────────────────────────────────────

export function calculateRSI(prices: number[], period = 14): number[] {
  const rsi: number[] = new Array(prices.length).fill(50);
  if (prices.length < period + 1) return rsi;

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rsi[i + 1] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

// ─── MACD ────────────────────────────────────────────────────

export function calculateMACD(prices: number[]): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = prices.map((_, i) => ema12[i] - ema26[i]);
  const signal = calculateEMA(macd.slice(26), 9);
  const paddedSignal = new Array(26).fill(0).concat(signal);
  const histogram = macd.map((v, i) => v - (paddedSignal[i] || 0));
  return { macd, signal: paddedSignal, histogram };
}

// ─── ATR (Average True Range) ────────────────────────────────

export function calculateATR(prices: number[], period = 14): number[] {
  const atr: number[] = new Array(prices.length).fill(0);
  if (prices.length < 2) return atr;

  const trueRanges: number[] = [0];
  for (let i = 1; i < prices.length; i++) {
    trueRanges.push(Math.abs(prices[i] - prices[i - 1]));
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
    if (ema[i - lookback] !== 0) {
      slope[i] = (ema[i] - ema[i - lookback]) / lookback;
    }
  }
  return slope;
}

// ─── EMA Gap (percentage distance between two EMAs) ──────────

export function calculateEMAGap(ema9: number[], ema21: number[], prices: number[]): number[] {
  return prices.map((price, i) => {
    if (price === 0 || ema21[i] === 0) return 0;
    return ((ema9[i] - ema21[i]) / price) * 100;
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
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    const sma = sum / period;

    // Standard deviation
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (prices[j] - sma) ** 2;
    const stdDev = Math.sqrt(sqSum / period);

    middle[i] = sma;
    upper[i] = sma + stdDevMultiplier * stdDev;
    lower[i] = sma - stdDevMultiplier * stdDev;

    const bandWidth = upper[i] - lower[i];
    percentB[i] = bandWidth > 0 ? (prices[i] - lower[i]) / bandWidth : 0.5;
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
      if (prices[j] > highest) highest = prices[j];
      if (prices[j] < lowest) lowest = prices[j];
    }
    const range = highest - lowest;
    k[i] = range > 0 ? ((prices[i] - lowest) / range) * 100 : 50;
  }

  // %D = SMA of %K
  for (let i = kPeriod - 1 + dPeriod - 1; i < len; i++) {
    let sum = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) sum += k[j];
    d[i] = sum / dPeriod;
  }

  return { k, d };
}
