/**
 * Price Pattern Detection Module v2.0
 *
 * v2.0 FIX: Accepts proper 1-minute OHLC candle arrays instead of raw tick chunks.
 * This eliminates the "temporal distortion" caused by arbitrary tick-windowing.
 *
 * Patterns detected:
 * - Engulfing (bullish / bearish) — using real candlestick OHLC
 * - Price-RSI divergence (bullish / bearish) — using candle close prices
 */

// ─── Candle interface (shared with signalEngine) ─────────────

export interface PatternCandle {
  open: number;
  high: number;
  low: number;
  close: number;
}

// ─── Divergence Detection ────────────────────────────────────

export interface Divergence {
  type: "bullish" | "bearish";
  strength: number; // 0-100
  description: string;
}

/**
 * Find swing highs and swing lows in a data series.
 * A swing high/low must be higher/lower than all neighbors within `lookback` bars on both sides.
 */
function findSwingPoints(data: number[], lookback = 5): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = lookback; i < data.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (data[i] <= data[i - j] || data[i] <= data[i + j]) isHigh = false;
      if (data[i] >= data[i - j] || data[i] >= data[i + j]) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

/**
 * Detect price-RSI divergence using candle close prices.
 * v2.0: Accepts candle closes (time-based) instead of raw ticks.
 *
 * @param closes - Array of 1-minute candle close prices
 * @param rsi    - RSI array computed from the same candle closes
 */
export function detectDivergence(closes: number[], rsi: number[]): Divergence | null {
  if (closes.length < 30) return null;

  const recentCloses = closes.slice(-50);
  const recentRSI = rsi.slice(-50);

  const priceSwings = findSwingPoints(recentCloses, 3);
  const rsiSwings = findSwingPoints(recentRSI, 3);

  // Bullish divergence: price lower low, RSI higher low
  if (priceSwings.lows.length >= 2 && rsiSwings.lows.length >= 2) {
    const [prevPriceLow, currPriceLow] = priceSwings.lows.slice(-2);
    const [prevRSILow, currRSILow] = rsiSwings.lows.slice(-2);

    if (
      recentCloses[currPriceLow] < recentCloses[prevPriceLow] &&
      recentRSI[currRSILow] > recentRSI[prevRSILow]
    ) {
      const strength = Math.min(Math.abs(recentRSI[currRSILow] - recentRSI[prevRSILow]) * 2, 100);
      return {
        type: "bullish",
        strength,
        description: `Bullish divergence: Price lower low but RSI higher low (strength: ${strength.toFixed(0)})`,
      };
    }
  }

  // Bearish divergence: price higher high, RSI lower high
  if (priceSwings.highs.length >= 2 && rsiSwings.highs.length >= 2) {
    const [prevPriceHigh, currPriceHigh] = priceSwings.highs.slice(-2);
    const [prevRSIHigh, currRSIHigh] = rsiSwings.highs.slice(-2);

    if (
      recentCloses[currPriceHigh] > recentCloses[prevPriceHigh] &&
      recentRSI[currRSIHigh] < recentRSI[prevRSIHigh]
    ) {
      const strength = Math.min(Math.abs(recentRSI[prevRSIHigh] - recentRSI[currRSIHigh]) * 2, 100);
      return {
        type: "bearish",
        strength,
        description: `Bearish divergence: Price higher high but RSI lower high (strength: ${strength.toFixed(0)})`,
      };
    }
  }

  return null;
}

// ─── Engulfing Pattern Detection (v2.0 — OHLC Candle-based) ─

export interface EngulfingPattern {
  type: "bullish" | "bearish";
  strength: number; // 0-100
}

/**
 * Detect engulfing patterns using proper 1-minute OHLC candles.
 * v2.0 FIX: Removed arbitrary `windowSize` tick chunking.
 * Now operates on real candlestick data — the last 2 completed candles are evaluated.
 *
 * @param candles - Array of 1-minute OHLC candles
 */
export function detectEngulfing(candles: PatternCandle[]): EngulfingPattern | null {
  // Need at least 2 candles to detect engulfing
  if (candles.length < 2) return null;

  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];

  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);

  // Guard: zero-body candles (doji) cannot form engulfing
  if (prevBody === 0 || currBody === 0) return null;

  // Bullish engulfing: prev bearish, curr bullish, curr body engulfs prev body
  if (
    prev.close < prev.open && // prev is bearish
    curr.close > curr.open && // curr is bullish
    curr.open <= prev.close && // curr opens at/below prev close
    curr.close >= prev.open    // curr closes at/above prev open
  ) {
    // Strength: ratio of curr body to prev body, capped at 100
    // Rationale: 40x multiplier maps a 2.5:1 body ratio to max strength 100
    const strength = Math.min((currBody / prevBody) * 40, 100);
    return { type: "bullish", strength };
  }

  // Bearish engulfing: prev bullish, curr bearish, curr body engulfs prev body
  if (
    prev.close > prev.open && // prev is bullish
    curr.close < curr.open && // curr is bearish
    curr.open >= prev.close && // curr opens at/above prev close
    curr.close <= prev.open    // curr closes at/below prev open
  ) {
    const strength = Math.min((currBody / prevBody) * 40, 100);
    return { type: "bearish", strength };
  }

  return null;
}