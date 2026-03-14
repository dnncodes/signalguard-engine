/**
 * Technical Indicators Module
 * 
 * Pure functions for calculating trading indicators:
 * - EMA (Exponential Moving Average)
 * - RSI (Relative Strength Index)
 * - MACD (Moving Average Convergence Divergence)
 * - ATR (Average True Range)
 * - EMA Slope (trend momentum)
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

  // For tick data, true range = |current - previous|
  const trueRanges: number[] = [0];
  for (let i = 1; i < prices.length; i++) {
    trueRanges.push(Math.abs(prices[i] - prices[i - 1]));
  }

  // Initial ATR = simple average of first 'period' true ranges
  if (prices.length >= period + 1) {
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += trueRanges[i];
    atr[period] = sum / period;

    // Smoothed ATR
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
