/**
 * Price Pattern Detection Module
 * 
 * Detects candlestick-like patterns and price-indicator divergences
 * using tick data (no OHLC needed).
 * 
 * Patterns detected:
 * - Engulfing (bullish / bearish)
 * - Price-RSI divergence (bullish / bearish)
 */

// ─── Divergence Detection ────────────────────────────────────

export interface Divergence {
  type: "bullish" | "bearish";
  strength: number; // 0-100
  description: string;
}

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

export function detectDivergence(prices: number[], rsi: number[]): Divergence | null {
  if (prices.length < 30) return null;

  const recentPrices = prices.slice(-50);
  const recentRSI = rsi.slice(-50);

  const priceSwings = findSwingPoints(recentPrices, 3);
  const rsiSwings = findSwingPoints(recentRSI, 3);

  // Bullish divergence: price lower low, RSI higher low
  if (priceSwings.lows.length >= 2 && rsiSwings.lows.length >= 2) {
    const [prevPriceLow, currPriceLow] = priceSwings.lows.slice(-2);
    const [prevRSILow, currRSILow] = rsiSwings.lows.slice(-2);

    if (
      recentPrices[currPriceLow] < recentPrices[prevPriceLow] &&
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
      recentPrices[currPriceHigh] > recentPrices[prevPriceHigh] &&
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

// ─── Engulfing Pattern Detection (Tick-based) ────────────────
// Simulates candlestick engulfing using micro-candle windows

export interface EngulfingPattern {
  type: "bullish" | "bearish";
  strength: number; // 0-100
}

/**
 * Detects engulfing patterns by grouping ticks into micro-candles.
 * windowSize determines how many ticks form one "candle".
 */
export function detectEngulfing(prices: number[], windowSize = 10): EngulfingPattern | null {
  if (prices.length < windowSize * 3) return null;

  // Build the last 3 micro-candles
  const candles: { open: number; close: number; high: number; low: number }[] = [];
  const start = prices.length - windowSize * 3;

  for (let c = 0; c < 3; c++) {
    const offset = start + c * windowSize;
    const slice = prices.slice(offset, offset + windowSize);
    candles.push({
      open: slice[0],
      close: slice[slice.length - 1],
      high: Math.max(...slice),
      low: Math.min(...slice),
    });
  }

  const prev = candles[1];
  const curr = candles[2];

  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);

  if (prevBody === 0 || currBody === 0) return null;

  // Bullish engulfing: prev bearish, curr bullish, curr body engulfs prev body
  if (
    prev.close < prev.open && // prev is bearish
    curr.close > curr.open && // curr is bullish
    curr.open <= prev.close && // curr opens at/below prev close
    curr.close >= prev.open    // curr closes at/above prev open
  ) {
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
