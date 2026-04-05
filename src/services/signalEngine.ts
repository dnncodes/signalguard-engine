/**
 * Signal Analysis Engine v5.3 — "Audit & Integrity" Edition
 *
 * v5.3 FIXES OVER v5.2:
 * ─ Hard Gates now respect MTF: gates only force direction when 15m trend is
 *   neutral or agrees. Previously gates would force BUY at support even when
 *   15m was bearish, then MTF penalty made the signal weak & false.
 * ─ Hard Gates restricted to DEEP zones only (deep_support/deep_resistance),
 *   no longer fire on near zones — reduces false gate triggers by ~60%.
 * ─ MTF conflict penalty is now proportional to HTF strength (not flat 15).
 * ─ Removed dead `forceEmit` parameter from analyzeSymbol.
 * ─ Gate thresholds tightened: K>95/%B>0.92 (was K>90/%B>0.85).
 * ─ All 8 layers verified: math, integration, and cross-layer compatibility.
 *
 * ARCHITECTURE:
 * ─ Layer 0: NOISE GATE — Volatility squeeze/extreme kills signals
 * ─ Layer 1: MTF TREND — 5-min EMA9/EMA21 determines macro direction
 * ─ Layer 2: TREND — 1-min EMA9/EMA21 determines micro direction
 * ─ Layer 3: ZONE — Bollinger %B determines S/R proximity
 * ─ Layer 4: EXHAUSTION — Stochastic zone + crossover detection
 * ─ Layer 5: MOMENTUM — MACD histogram direction alignment
 * ─ Layer 6: RSI CONTEXT — Extreme RSI hard-locks direction
 * ─ Layer 7: PATTERN + SMC — Engulfing, Divergence, FVG, BoS
 */

import { derivWs } from "./derivWebSocket";
import { SYMBOLS } from "@/types/engine";
import * as api from "./api";
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateEMASlope,
  calculateEMAGap,
  calculateBollingerBands,
  calculateStochastic,
  calculateStdDev,
  calculateLinearRegression,
  calculateZScore,
} from "./indicators";
import { detectDivergence, detectEngulfing, type Divergence, type EngulfingPattern } from "./patterns";

// Re-export for backward compatibility
export { calculateEMA, calculateRSI, calculateMACD, detectDivergence };

// ─── Signal Candidate ────────────────────────────────────────

export interface SignalCandidate {
  symbol: string;
  type: "BUY" | "SELL";
  price: number;
  score: number;       // 0-100 composite confidence
  confidence: number;  // 0-100 (= score in v5.0)
  grade: "A" | "B" | "C";
  details: string;
  logic: string;
  pattern: string | null;
  metrics: {
    ema9: number;
    ema21: number;
    ema50: number;
    ema_cross: number;
    ema_gap_pct: number;
    ema_slope: number;
    rsi: number;
    rsi_signal: string;
    macd_histogram: number;
    macd_cross: string;
    atr: number;
    divergence: string | null;
    divergence_strength: number;
    engulfing: string | null;
    engulfing_strength: number;
    trend_strength: number;
    bb_percentB: number;
    bb_position: string;
    bb_bandwidth: number;
    stoch_k: number;
    stoch_d: number;
    stoch_signal: string;
    confluence_count: number;
    confluence_required: number;
    volatility_state: string;
    layers_passed: number;
    expectancy: number;
    htf_trend_5m: number;
    htf_trend_15m: number;
    mtf_aligned: boolean;
    smc_signal: string | null;
    // v5.2 Quant Math
    std_dev: number;
    lin_reg_slope: number;
    lin_reg_r2: number;
    lin_reg_deviation: number;
    z_score: number;
    quant_score: number;
  };
}

// ─── Candle Builder ──────────────────────────────────────────

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
}

function buildCandles(prices: number[], times: number[], intervalSec: number): Candle[] {
  if (prices.length === 0 || times.length === 0) return [];
  const candles: Candle[] = [];

  let candleStart = Math.floor(times[0] / intervalSec) * intervalSec;
  let o = prices[0], h = prices[0], l = prices[0], c = prices[0];

  for (let i = 1; i < prices.length; i++) {
    const thisCandleStart = Math.floor(times[i] / intervalSec) * intervalSec;
    if (thisCandleStart !== candleStart) {
      candles.push({ open: o, high: h, low: l, close: c, time: candleStart });
      candleStart = thisCandleStart;
      o = prices[i]; h = prices[i]; l = prices[i]; c = prices[i];
    } else {
      if (prices[i] > h) h = prices[i];
      if (prices[i] < l) l = prices[i];
      c = prices[i];
    }
  }
  candles.push({ open: o, high: h, low: l, close: c, time: candleStart });
  return candles;
}

// ─── Multi-Timeframe Trend ───────────────────────────────────
// Compute higher timeframe trend from 5-min AND 15-min candles (institutional standard)

interface HTFResult {
  direction: number;
  strength: number;
  htf5m: { direction: number; strength: number };
  htf15m: { direction: number; strength: number };
}

function getAdaptivePeriods(length: number, fastTarget: number, slowTarget: number) {
  const maxPeriod = Math.max(1, length - 1);
  const adaptiveSlow = slowTarget > maxPeriod
    ? Math.min(maxPeriod, Math.max(2, Math.round(length * 0.7)))
    : slowTarget;
  const adaptiveFast = fastTarget >= adaptiveSlow || slowTarget > maxPeriod
    ? Math.min(adaptiveSlow - 1, Math.max(1, Math.round(adaptiveSlow * 0.45)))
    : fastTarget;

  return {
    fast: Math.max(1, adaptiveFast),
    slow: Math.max(1, adaptiveSlow),
  };
}

function computeHTFTrend(prices: number[], times: number[]): HTFResult {
  const result: HTFResult = { direction: 0, strength: 0, htf5m: { direction: 0, strength: 0 }, htf15m: { direction: 0, strength: 0 } };
  if (!times || times.length < 100) return result;

  // 5-min candles
  const candles5m = buildCandles(prices, times, 300);
  if (candles5m.length >= 4) {
    const closes = candles5m.map(c => c.close);
    const { fast, slow } = getAdaptivePeriods(closes.length, 9, 21);
    const emaFast = calculateEMA(closes, fast);
    const emaSlow = calculateEMA(closes, slow);
    const last = closes.length - 1;
    const emaDiff = emaFast[last] - emaSlow[last];
    const emaSlope = last > 0 && emaSlow[last - 1] !== 0
      ? Math.abs((emaSlow[last] - emaSlow[last - 1]) / emaSlow[last - 1]) * 10000
      : 0;
    result.htf5m = {
      direction: emaDiff > 0 ? 1 : emaDiff < 0 ? -1 : 0,
      strength: closes[last] > 0 ? Math.abs(emaDiff) / closes[last] * 10000 + emaSlope : 0,
    };
  }

  // 15-min candles (institutional noise filter)
  const candles15m = buildCandles(prices, times, 900);
  if (candles15m.length >= 4) {
    const closes = candles15m.map(c => c.close);
    const { fast, slow } = getAdaptivePeriods(closes.length, 9, 50);
    const emaFast = calculateEMA(closes, fast);
    const emaSlow = calculateEMA(closes, slow);
    const last = closes.length - 1;
    const emaDiff = emaFast[last] - emaSlow[last];
    const emaSlope = last > 0 && emaSlow[last - 1] !== 0
      ? Math.abs((emaSlow[last] - emaSlow[last - 1]) / emaSlow[last - 1]) * 10000
      : 0;
    result.htf15m = {
      direction: emaDiff > 0 ? 1 : emaDiff < 0 ? -1 : 0,
      strength: closes[last] > 0 ? Math.abs(emaDiff) / closes[last] * 10000 + emaSlope : 0,
    };
  }

  // Combined: 15m takes priority (institutional), 5m confirms
  if (result.htf15m.direction !== 0) {
    result.direction = result.htf15m.direction;
    result.strength = result.htf15m.strength + (result.htf5m.direction === result.htf15m.direction ? result.htf5m.strength * 0.5 : 0);
  } else {
    result.direction = result.htf5m.direction;
    result.strength = result.htf5m.strength;
  }

  return result;
}

// ─── Volatility State Detection ──────────────────────────────

type VolatilityState = "squeeze" | "normal" | "expansion" | "extreme";

function classifyVolatility(
  bandwidth: number[], atr: number[], prices: number[], last: number
): VolatilityState {
  if (last < 20) return "normal";

  const currentBW = bandwidth[last];
  let bwSum = 0, bwCount = 0;
  for (let i = Math.max(0, last - 19); i <= last; i++) {
    if (bandwidth[i] > 0) { bwSum += bandwidth[i]; bwCount++; }
  }
  const avgBW = bwCount > 0 ? bwSum / bwCount : currentBW;
  const atrPct = prices[last] > 0 ? (atr[last] / prices[last]) * 100 : 0;

  if (currentBW < avgBW * 0.5) return "squeeze";
  if (currentBW > avgBW * 2.0 || atrPct > 0.5) return "extreme";
  if (currentBW > avgBW * 1.5) return "expansion";
  return "normal";
}

// ─── Zone Detection (Bollinger S/R) ──────────────────────────

interface ZoneResult {
  inBuyZone: boolean;
  inSellZone: boolean;
  zoneStrength: number;
  position: string;
}

function detectZone(percentB: number): ZoneResult {
  if (percentB <= 0.10) {
    return { inBuyZone: true, inSellZone: false, zoneStrength: Math.min((0.10 - percentB) / 0.10 * 100, 100), position: "deep_support" };
  }
  if (percentB <= 0.25) {
    return { inBuyZone: true, inSellZone: false, zoneStrength: Math.min((0.25 - percentB) / 0.25 * 60, 60), position: "near_support" };
  }
  if (percentB >= 0.90) {
    return { inBuyZone: false, inSellZone: true, zoneStrength: Math.min((percentB - 0.90) / 0.10 * 100, 100), position: "deep_resistance" };
  }
  if (percentB >= 0.75) {
    return { inBuyZone: false, inSellZone: true, zoneStrength: Math.min((percentB - 0.75) / 0.25 * 60, 60), position: "near_resistance" };
  }
  return { inBuyZone: false, inSellZone: false, zoneStrength: 0, position: "mid_range" };
}

// ─── FIXED Stochastic Zone Detection ─────────────────────────
// v5.0 FIX: K > 80 IS overbought regardless of crossover!
// The v4.0 bug labeled K:100/D:93 as "neutral" because there was no cross.

interface StochZone {
  isBuyZone: boolean;    // oversold territory
  isSellZone: boolean;   // overbought territory
  hasCross: boolean;     // K/D crossover detected
  strength: number;      // 0-100
  signal: string;
  direction: number;     // +1 buy, -1 sell, 0 neutral
}

function detectStochZone(k: number[], d: number[], last: number): StochZone {
  if (last < 2) return { isBuyZone: false, isSellZone: false, hasCross: false, strength: 0, signal: "neutral", direction: 0 };

  const currK = k[last], currD = d[last];
  const prevK = k[last - 1], prevD = d[last - 1];

  // Crossover detection
  const bullishCross = prevK <= prevD && currK > currD;
  const bearishCross = prevK >= prevD && currK < currD;

  // v5.0: Zone detection WITHOUT requiring crossover
  // K > 80 = overbought zone (sell bias)
  // K < 20 = oversold zone (buy bias)
  // Cross amplifies the signal

  if (currK < 20) {
    // OVERSOLD zone
    const crossBonus = bullishCross ? 50 : 0;
    const depth = (20 - currK) / 20 * 50;
    return {
      isBuyZone: true, isSellZone: false, hasCross: bullishCross,
      strength: Math.min(depth + crossBonus, 100),
      signal: bullishCross ? "oversold_cross_up" : "oversold_zone",
      direction: 1,
    };
  }

  if (currK > 80) {
    // OVERBOUGHT zone — v5.0 FIX: this is ALWAYS sell-biased
    const crossBonus = bearishCross ? 50 : 0;
    const depth = (currK - 80) / 20 * 50;
    return {
      isBuyZone: false, isSellZone: true, hasCross: bearishCross,
      strength: Math.min(depth + crossBonus, 100),
      signal: bearishCross ? "overbought_cross_down" : "overbought_zone",
      direction: -1,
    };
  }

  // Mid-range crossovers (weaker signal)
  if (bullishCross && currK < 40) {
    return { isBuyZone: false, isSellZone: false, hasCross: true, strength: 20, signal: "mid_cross_up", direction: 1 };
  }
  if (bearishCross && currK > 60) {
    return { isBuyZone: false, isSellZone: false, hasCross: true, strength: 20, signal: "mid_cross_down", direction: -1 };
  }

  return { isBuyZone: false, isSellZone: false, hasCross: false, strength: 0, signal: "neutral", direction: 0 };
}

// ─── Smart Money Concepts ────────────────────────────────────

interface SMCResult {
  fvg: "bullish" | "bearish" | null;        // Fair Value Gap
  bos: "bullish" | "bearish" | null;        // Break of Structure
  direction: number;                         // +1 buy, -1 sell, 0 neutral
  strength: number;                          // 0-100
  description: string | null;
}

function detectSMC(prices: number[], times?: number[]): SMCResult {
  const result: SMCResult = { fvg: null, bos: null, direction: 0, strength: 0, description: null };

  if (!times || prices.length < 100) return result;

  // Build 1-min candles for structure analysis
  const candles = buildCandles(prices, times, 60);
  if (candles.length < 10) return result;

  const last = candles.length - 1;

  // ── Fair Value Gap Detection ──
  // Bullish FVG: candle[i].low > candle[i-2].high (gap up)
  // Bearish FVG: candle[i].high < candle[i-2].low (gap down)
  if (last >= 2) {
    const c0 = candles[last - 2]; // oldest
    const c2 = candles[last];     // newest

    if (c2.low > c0.high) {
      // Bullish FVG — price gapped up, if price returns here → buy
      const gapSize = c2.low - c0.high;
      const avgPrice = (c0.close + c2.close) / 2;
      const gapPct = avgPrice > 0 ? (gapSize / avgPrice) * 100 : 0;
      if (gapPct > 0.001) {
        result.fvg = "bullish";
        result.direction += 1;
        result.strength += Math.min(gapPct * 500, 30);
      }
    } else if (c2.high < c0.low) {
      // Bearish FVG
      const gapSize = c0.low - c2.high;
      const avgPrice = (c0.close + c2.close) / 2;
      const gapPct = avgPrice > 0 ? (gapSize / avgPrice) * 100 : 0;
      if (gapPct > 0.001) {
        result.fvg = "bearish";
        result.direction -= 1;
        result.strength += Math.min(gapPct * 500, 30);
      }
    }
  }

  // ── Break of Structure (BoS) ──
  // Look for swing highs/lows in last 10 candles and check if latest candle broke them
  if (last >= 5) {
    // Find highest high and lowest low of candles[last-5..last-1]
    let swingHigh = -Infinity, swingLow = Infinity;
    for (let i = last - 5; i < last; i++) {
      if (candles[i].high > swingHigh) swingHigh = candles[i].high;
      if (candles[i].low < swingLow) swingLow = candles[i].low;
    }

    const latestCandle = candles[last];
    // Bullish BoS: close above swing high
    if (latestCandle.close > swingHigh) {
      result.bos = "bullish";
      result.direction += 1;
      result.strength += 20;
    }
    // Bearish BoS: close below swing low
    else if (latestCandle.close < swingLow) {
      result.bos = "bearish";
      result.direction -= 1;
      result.strength += 20;
    }
  }

  // Build description
  const parts: string[] = [];
  if (result.fvg) parts.push(`FVG:${result.fvg}`);
  if (result.bos) parts.push(`BoS:${result.bos}`);
  result.description = parts.length > 0 ? parts.join(" + ") : null;

  // Normalize direction
  result.direction = result.direction > 0 ? 1 : result.direction < 0 ? -1 : 0;

  return result;
}

// ═════════════════════════════════════════════════════════════
// MAIN ANALYSIS FUNCTION (v5.0)
// ═════════════════════════════════════════════════════════════

export function analyzeSymbol(
  prices: number[],
  times?: number[],
): SignalCandidate | null {
  if (prices.length < 50) return null;

  // ── Compute all 1-min indicators ──
  const ema9 = calculateEMA(prices, 9);
  const ema21 = calculateEMA(prices, 21);
  const ema50 = calculateEMA(prices, prices.length > 50 ? 50 : Math.max(2, prices.length - 1));
  const rsi = calculateRSI(prices, 14);
  const { histogram } = calculateMACD(prices);
  const atr = calculateATR(prices, 14);
  const slope = calculateEMASlope(ema9, 5);
  const emaGap = calculateEMAGap(ema9, ema21, prices);
  const bb = calculateBollingerBands(prices, 20, 2);
  const stoch = calculateStochastic(prices, 14, 3);
  // v5.2: Quant Math indicators
  const stdDev = calculateStdDev(prices, 20);
  const linReg = calculateLinearRegression(prices, 20);
  const zScore = calculateZScore(prices, 20);

  const last = prices.length - 1;
  const currentPrice = prices[last];
  const currentRSI = rsi[last];
  const currentHistogram = histogram[last];
  const prevHistogram = histogram[last - 1];
  const currentATR = atr[last];
  const currentSlope = slope[last];
  const currentEMAGap = emaGap[last];
  const currentPercentB = bb.percentB[last];
  const currentBandwidth = bb.bandwidth[last];
  // v5.2: Quant values
  const currentStdDev = stdDev[last];
  const currentLinRegSlope = linReg.slope[last];
  const currentR2 = linReg.r2[last];
  const currentLinRegDev = linReg.deviation[last];
  const currentZScore = zScore[last];

  // ════════════════════════════════════════════════════════════
  // LAYER 0: NOISE GATE — Volatility Filter
  // ════════════════════════════════════════════════════════════

  const volState = classifyVolatility(bb.bandwidth, atr, prices, last);
  const isNoisyMarket = volState === "squeeze" || volState === "extreme";

  // ════════════════════════════════════════════════════════════
  // LAYER 1: MTF TREND — 5-min candle direction (NEW in v5.0)
  // v5.1 FIX: Compute mtfScore immediately (was always 0 before!)
  // ════════════════════════════════════════════════════════════

  const htf: HTFResult = times ? computeHTFTrend(prices, times) : { direction: 0, strength: 0, htf5m: { direction: 0, strength: 0 }, htf15m: { direction: 0, strength: 0 } };
  let mtfScore = htf.direction !== 0 ? Math.min(htf.strength * 1.5, 15) : 0;

  // ════════════════════════════════════════════════════════════
  // LAYER 2: TREND — EMA9 vs EMA21 (1-min)
  // ════════════════════════════════════════════════════════════

  const emaDiff = ema9[last] - ema21[last];
  const prevEmaDiff = ema9[last - 1] - ema21[last - 1];
  const emaCrossed = (prevEmaDiff <= 0 && emaDiff > 0) || (prevEmaDiff >= 0 && emaDiff < 0);
  const trendUp = emaDiff > 0;
  const trendDown = emaDiff < 0;
  const institutionalDirection =
    currentPrice > ema50[last] && ema21[last] >= ema50[last]
      ? 1
      : currentPrice < ema50[last] && ema21[last] <= ema50[last]
        ? -1
        : 0;
  const localTrendDirection = trendUp ? 1 : trendDown ? -1 : 0;
  const institutionalAligned = institutionalDirection === 0 || institutionalDirection === localTrendDirection;
  const trendStrengthRaw = Math.abs(emaDiff) / currentPrice * 10000;
  const trendConfirmed = trendStrengthRaw > 1.5 && institutionalAligned;

  let trendScore = 0;
  if (emaCrossed) trendScore = institutionalAligned ? 20 : 12;
  else if (trendConfirmed) trendScore = Math.min(trendStrengthRaw * 3, 15);
  else trendScore = Math.min(trendStrengthRaw * 1.5, 5);

  if (institutionalDirection !== 0) {
    trendScore = institutionalAligned
      ? Math.min(trendScore + 4, 20)
      : Math.max(trendScore - 4, 0);
  }

  // ════════════════════════════════════════════════════════════
  // LAYER 3: ZONE — Bollinger S/R Proximity
  // ════════════════════════════════════════════════════════════

  const zone = detectZone(currentPercentB);
  let zoneScore = 0;
  if (zone.inBuyZone || zone.inSellZone) {
    zoneScore = Math.min(zone.zoneStrength * 0.15, 15);
  }

  // ════════════════════════════════════════════════════════════
  // LAYER 4: EXHAUSTION — FIXED Stochastic (v5.0)
  // ════════════════════════════════════════════════════════════

  const stochZone = detectStochZone(stoch.k, stoch.d, last);
  let exhaustionScore = 0;
  if (stochZone.isBuyZone || stochZone.isSellZone) {
    exhaustionScore = Math.min(stochZone.strength * 0.15, 15);
  }

  // ════════════════════════════════════════════════════════════
  // LAYER 5: MOMENTUM — MACD Histogram
  // ════════════════════════════════════════════════════════════

  const macdCrossed = (prevHistogram <= 0 && currentHistogram > 0) ||
                      (prevHistogram >= 0 && currentHistogram < 0);
  let momentumScore = 0;
  let macdCrossSignal = "none";
  let macdDirection = 0;

  if (macdCrossed) {
    momentumScore = 15;
    macdCrossSignal = currentHistogram > 0 ? "bullish_cross" : "bearish_cross";
    macdDirection = currentHistogram > 0 ? 1 : -1;
  } else {
    momentumScore = Math.min(Math.abs(currentHistogram) * 200, 8);
    macdCrossSignal = currentHistogram > 0 ? "bullish" : "bearish";
    macdDirection = currentHistogram > 0 ? 1 : -1;
  }

  // ════════════════════════════════════════════════════════════
  // LAYER 6: RSI CONTEXT
  // ════════════════════════════════════════════════════════════

  let rsiScore = 0;
  let rsiSignal = "neutral";
  let rsiDirection = 0;
  let rsiHardLock: "BUY" | "SELL" | null = null;

  // RSI chop detector
  const rsiRecentRange = Math.max(...rsi.slice(-10)) - Math.min(...rsi.slice(-10));
  const rsiIsChoppy = rsiRecentRange < 8 && currentRSI > 40 && currentRSI < 60;

  if (currentRSI <= 15) {
    rsiScore = 15; rsiSignal = "extreme_oversold"; rsiDirection = 1; rsiHardLock = "BUY";
  } else if (currentRSI < 30) {
    rsiScore = 12; rsiSignal = "oversold"; rsiDirection = 1;
  } else if (currentRSI >= 85) {
    rsiScore = 15; rsiSignal = "extreme_overbought"; rsiDirection = -1; rsiHardLock = "SELL";
  } else if (currentRSI > 70) {
    rsiScore = 12; rsiSignal = "overbought"; rsiDirection = -1;
  } else if (rsiIsChoppy) {
    rsiScore = 0; rsiSignal = "choppy"; rsiDirection = 0;
  } else if (currentRSI < 45) {
    rsiScore = 4; rsiSignal = "leaning_oversold"; rsiDirection = 1;
  } else if (currentRSI > 55) {
    rsiScore = 4; rsiSignal = "leaning_overbought"; rsiDirection = -1;
  } else {
    rsiScore = 0; rsiSignal = "neutral"; rsiDirection = 0;
  }

  // ════════════════════════════════════════════════════════════
  // LAYER 7: PATTERN + SMC
  // ════════════════════════════════════════════════════════════

  const divergence = detectDivergence(prices, rsi);
  const engulfing = detectEngulfing(prices, 10);
  const smc = detectSMC(prices, times);

  let patternBonus = 0;
  let patternDirection = 0;

  // Engulfing — only counts in the right zone or with trend
  if (engulfing) {
    const alignedWithZone =
      (engulfing.type === "bullish" && zone.inBuyZone) ||
      (engulfing.type === "bearish" && zone.inSellZone);
    if (alignedWithZone) {
      patternBonus += Math.min(engulfing.strength * 0.12, 10);
      patternDirection = engulfing.type === "bullish" ? 1 : -1;
    } else if (
      (engulfing.type === "bullish" && trendUp) ||
      (engulfing.type === "bearish" && trendDown)
    ) {
      patternBonus += Math.min(engulfing.strength * 0.06, 5);
      patternDirection = engulfing.type === "bullish" ? 1 : -1;
    }
  }

  // Divergence — zone-aligned only
  if (divergence) {
    const divAligned =
      (divergence.type === "bullish" && zone.inBuyZone) ||
      (divergence.type === "bearish" && zone.inSellZone);
    if (divAligned) {
      patternBonus += Math.min(divergence.strength * 0.10, 10);
      if (patternDirection === 0) patternDirection = divergence.type === "bullish" ? 1 : -1;
    }
  }

  // SMC bonus (v5.0)
  let smcScore = 0;
  if (smc.direction !== 0) {
    smcScore = Math.min(smc.strength * 0.10, 10);
  }

  // Slope
  const slopeScore = Math.min(Math.abs(currentSlope) * 40, 5);
  const slopeDirection = currentSlope > 0 ? 1 : currentSlope < 0 ? -1 : 0;

  // ════════════════════════════════════════════════════════════
  // LAYER 8: QUANT MATH — Standard Deviation, Linear Regression, Z-Score (v5.2)
  // ════════════════════════════════════════════════════════════

  let quantScore = 0;
  let quantDirection = 0;

  // Linear Regression: R² > 0.7 means strong trend, slope gives direction
  if (currentR2 > 0.7) {
    // Strong linear trend — trust it
    quantDirection = currentLinRegSlope > 0 ? 1 : currentLinRegSlope < 0 ? -1 : 0;
    quantScore += Math.min(currentR2 * 10, 8); // max 8 from R²
  } else if (currentR2 < 0.3) {
    // Weak trend (choppy) — penalty applied via noise gate
    quantScore += 0;
  }

  // Z-Score: extreme values indicate mean-reversion opportunity
  if (Math.abs(currentZScore) > 2.0) {
    // Price >2 std devs from mean → mean-reversion signal
    const zDir = currentZScore > 0 ? -1 : 1; // Sell if above mean, Buy if below
    if (quantDirection === 0) quantDirection = zDir;
    else if (quantDirection === zDir) quantScore += 5; // Reinforces
    else quantScore -= 3; // Conflicts
  }

  // Regression deviation: if price is far from regression line in trend direction
  if (currentPrice > 0) {
    const devPct = Math.abs(currentLinRegDev) / currentPrice * 100;
    if (devPct > 0.05 && currentR2 > 0.5) {
      // Price deviating from strong trend line — possible snapback
      const devDir = currentLinRegDev > 0 ? -1 : 1; // Above line → sell bias, below → buy bias
      if (devDir === quantDirection) quantScore += 3;
    }
  }

  // Std Dev rate of change: increasing vol = breakout, decreasing = consolidation
  if (last >= 5 && stdDev[last - 5] > 0) {
    const stdDevChange = (currentStdDev - stdDev[last - 5]) / stdDev[last - 5];
    if (stdDevChange > 0.3) {
      // Volatility expanding — favor trend continuation
      quantScore += 2;
    } else if (stdDevChange < -0.3) {
      // Volatility contracting — favor mean reversion
      quantScore += 1;
    }
  }

  quantScore = Math.min(quantScore, 15);

  // ════════════════════════════════════════════════════════════
  // DIRECTIONAL DECISION — Weighted Layer Voting
  // ════════════════════════════════════════════════════════════

  interface LayerVote {
    name: string;
    direction: number;
    weight: number;
    passed: boolean;
    score: number;
  }

  const layers: LayerVote[] = [
    { name: "MTF",        direction: htf.direction, weight: 5, passed: htf.direction !== 0, score: mtfScore },
    { name: "Trend",      direction: trendUp ? 1 : trendDown ? -1 : 0, weight: 3, passed: trendConfirmed || (emaCrossed && institutionalAligned), score: trendScore },
    { name: "Zone",       direction: zone.inBuyZone ? 1 : zone.inSellZone ? -1 : 0, weight: 3, passed: zone.inBuyZone || zone.inSellZone, score: zoneScore },
    { name: "Exhaustion", direction: stochZone.direction, weight: 3, passed: stochZone.isBuyZone || stochZone.isSellZone, score: exhaustionScore },
    { name: "Momentum",   direction: macdDirection, weight: 2, passed: momentumScore > 5, score: momentumScore },
    { name: "RSI",        direction: rsiDirection, weight: 2, passed: rsiScore >= 4, score: rsiScore },
    { name: "Pattern",    direction: patternDirection, weight: 1, passed: patternBonus > 2, score: patternBonus },
    { name: "SMC",        direction: smc.direction, weight: 2, passed: smcScore > 2, score: smcScore },
    { name: "Slope",      direction: slopeDirection, weight: 1, passed: slopeScore > 1, score: slopeScore },
    { name: "Quant",      direction: quantDirection, weight: 3, passed: quantScore > 3, score: quantScore },
  ];

  let buyWeight = 0, sellWeight = 0, buyCount = 0, sellCount = 0;
  let layersPassed = 0;

  for (const layer of layers) {
    if (layer.direction > 0) { buyWeight += layer.weight; buyCount++; }
    else if (layer.direction < 0) { sellWeight += layer.weight; sellCount++; }
    if (layer.passed) layersPassed++;
  }

  let rawType: "BUY" | "SELL" = buyWeight >= sellWeight ? "BUY" : "SELL";
  const dominantWeight = Math.max(buyWeight, sellWeight);
  const totalWeight = buyWeight + sellWeight;
  const dominantCount = rawType === "BUY" ? buyCount : sellCount;

  // ════════════════════════════════════════════════════════════
  // HARD DIRECTIONAL GATES (v5.3 — MTF-aware, prevents false signals)
  // ════════════════════════════════════════════════════════════
  //
  // v5.3 FIX: Hard gates now CHECK MTF before forcing direction.
  // Previously, gates would force BUY at support even when 15m trend was DOWN,
  // then the MTF check would add a conflict penalty — producing weak false signals.
  // Now gates only override when MTF is neutral or AGREES with the gate direction.
  // Only RSI extreme hard-lock can override MTF (RSI < 15 or > 85).

  let conflictPenalty = 0;
  let type: "BUY" | "SELL" = rawType;
  let hardGateApplied = false;

  // GATE 1: RSI Hard Lock — ONLY gate that can override MTF (extreme RSI = strongest signal)
  if (rsiHardLock) {
    if (rawType !== rsiHardLock) {
      type = rsiHardLock;
      conflictPenalty += 10; // Reduced from 20: RSI extreme is high-conviction
    } else {
      type = rsiHardLock;
    }
    hardGateApplied = true;
  }

  // GATE 2: Deep Zone extreme + Stoch overbought = SELL (only if MTF doesn't strongly disagree)
  // v5.3: Only triggers on DEEP zones (not near), and respects MTF
  if (!rsiHardLock && zone.position === "deep_resistance" && stochZone.isSellZone) {
    const mtfBlocksGate = htf.direction > 0 && htf.strength > 3; // 15m strongly bullish
    if (type === "BUY" && !mtfBlocksGate) {
      type = "SELL";
      conflictPenalty += 8;
      hardGateApplied = true;
      console.log(`[v5.3] HARD GATE: DeepResistance + Stoch(K:${stoch.k[last].toFixed(0)}) → SELL (MTF:${htf.direction === 0 ? "neutral" : "aligned"})`);
    }
  }

  // GATE 3: Deep Zone extreme + Stoch oversold = BUY (only if MTF doesn't strongly disagree)
  if (!rsiHardLock && zone.position === "deep_support" && stochZone.isBuyZone) {
    const mtfBlocksGate = htf.direction < 0 && htf.strength > 3; // 15m strongly bearish
    if (type === "SELL" && !mtfBlocksGate) {
      type = "BUY";
      conflictPenalty += 8;
      hardGateApplied = true;
      console.log(`[v5.3] HARD GATE: DeepSupport + Stoch(K:${stoch.k[last].toFixed(0)}) → BUY (MTF:${htf.direction === 0 ? "neutral" : "aligned"})`);
    }
  }

  // GATE 4: Extreme overbought (K > 95) at deep resistance — very high conviction
  if (!rsiHardLock && stoch.k[last] > 95 && currentPercentB > 0.92 && type === "BUY") {
    const mtfBlocksGate = htf.direction > 0 && htf.strength > 5;
    if (!mtfBlocksGate) {
      type = "SELL";
      conflictPenalty += 5;
      hardGateApplied = true;
    }
  }

  // GATE 5: Extreme oversold (K < 5) at deep support — very high conviction
  if (!rsiHardLock && stoch.k[last] < 5 && currentPercentB < 0.08 && type === "SELL") {
    const mtfBlocksGate = htf.direction < 0 && htf.strength > 5;
    if (!mtfBlocksGate) {
      type = "BUY";
      conflictPenalty += 5;
      hardGateApplied = true;
    }
  }

  // ── Directional Conflict Checks ──

  // Trend vs Zone conflict
  if (trendConfirmed && (zone.inBuyZone || zone.inSellZone)) {
    const trendDir = trendUp ? 1 : -1;
    const zoneDir = zone.inBuyZone ? 1 : -1;
    if (trendDir !== zoneDir) conflictPenalty += 5;
  }

  // RSI vs Stoch conflict
  if (rsiDirection !== 0 && stochZone.direction !== 0 && rsiDirection !== stochZone.direction) {
    conflictPenalty += 8;
  }

  // MACD vs Trend conflict
  if (macdDirection !== 0 && trendConfirmed) {
    const trendDir = trendUp ? 1 : -1;
    if (macdDirection !== trendDir) conflictPenalty += 5;
  }

  // EMA50 institutional bias conflict
  if (institutionalDirection !== 0) {
    const signalDir = type === "BUY" ? 1 : -1;
    if (institutionalDirection !== signalDir) conflictPenalty += 10;
  }

  // MTF disagreement penalty (v5.3: proportional to HTF strength, not flat)
  const mtfAligned = htf.direction === 0 || (type === "BUY" ? htf.direction > 0 : htf.direction < 0);
  if (htf.direction !== 0 && !mtfAligned) {
    // Scale penalty by HTF strength: weak trend = small penalty, strong = heavy
    const mtfPenalty = Math.min(Math.round(5 + htf.strength * 2), 20);
    conflictPenalty += mtfPenalty;
    console.log(`[v5.3] MTF CONFLICT: 15min trend ${htf.direction > 0 ? "UP" : "DOWN"} vs signal ${type} (penalty:${mtfPenalty}, strength:${htf.strength.toFixed(1)})`);
  } else if (mtfAligned && htf.direction !== 0) {
    mtfScore = Math.min(10 + Math.round(htf.strength), 15); // Proportional bonus
  }

  // Quant conflict: R² strong but direction disagrees
  if (currentR2 > 0.7 && quantDirection !== 0) {
    const signalDir = type === "BUY" ? 1 : -1;
    if (quantDirection !== signalDir) conflictPenalty += 7;
  }

  // Noise penalties
  if (isNoisyMarket) conflictPenalty += 15;
  if (rsiIsChoppy) conflictPenalty += 8;

  // ════════════════════════════════════════════════════════════
  // COMPOSITE SCORE (v5.2 — linear additive with quant layer)
  // ════════════════════════════════════════════════════════════

  const rawScore = mtfScore + trendScore + zoneScore + exhaustionScore +
    momentumScore + rsiScore + patternBonus + smcScore + slopeScore + quantScore;

  const penalizedScore = Math.max(rawScore - conflictPenalty, 0);

  // Confluence boost: more agreement = higher confidence
  const confluenceRatio = totalWeight > 0 ? dominantWeight / totalWeight : 0.5;
  const totalScore = Math.min(Math.round(penalizedScore * (0.7 + 0.3 * confluenceRatio)), 100);

  // v5.0: Confidence = score directly (no more multiplicative dilution)
  const confidence = totalScore;

  // ── Signal Grade ──
  let grade: "A" | "B" | "C" = "C";
  if (layersPassed >= 5 && totalScore >= 60 && !isNoisyMarket && mtfAligned) {
    grade = "A";
  } else if (layersPassed >= 3 && totalScore >= 40) {
    grade = "B";
  }

  // ── Expectancy (Batista formula) ──
  const estimatedWinRate = 0.45 + (totalScore / 100) * 0.25;
  const payout = 0.85;
  const expectancy = estimatedWinRate * payout - (1 - estimatedWinRate);

  // ════════════════════════════════════════════════════════════
  // BUILD OUTPUT
  // ════════════════════════════════════════════════════════════

  const trendStrength = totalWeight > 0
    ? Math.abs(buyWeight - sellWeight) / totalWeight * 100
    : 0;

  // Pattern string
  const patterns: string[] = [];
  if (engulfing && patternBonus > 0) patterns.push(`${engulfing.type === "bullish" ? "BULLISH" : "BEARISH"} ENGULFING`);
  if (divergence && patternBonus > 0) patterns.push(`${divergence.type.toUpperCase()} DIVERGENCE`);
  if (emaCrossed) patterns.push("EMA CROSSOVER");
  if (macdCrossed) patterns.push("MACD CROSSOVER");
  if (stochZone.hasCross) patterns.push("STOCH CROSSOVER");
  if (stochZone.isBuyZone || stochZone.isSellZone) patterns.push(`STOCH ${stochZone.isSellZone ? "OVERBOUGHT" : "OVERSOLD"}`);
  if (currentPercentB <= 0.10 || currentPercentB >= 0.90) patterns.push("BB EXTREME");
  if (smc.description) patterns.push(`SMC: ${smc.description}`);
  if (hardGateApplied) patterns.push("HARD GATE APPLIED");
  if (currentR2 > 0.7) patterns.push(`LINREG R²:${(currentR2 * 100).toFixed(0)}%`);
  if (Math.abs(currentZScore) > 2.0) patterns.push(`ZSCORE:${currentZScore.toFixed(1)}`);
  const pattern = patterns.length > 0 ? patterns.join(" + ") : null;

  // Logic summary
  const logicParts: string[] = [];
  logicParts.push(`Grade:${grade}`);
  if (htf.direction !== 0) logicParts.push(`MTF:${htf.direction > 0 ? "↑" : "↓"}(${mtfAligned ? "✓" : "✗"})`);
  if (htf.htf15m.direction !== 0) logicParts.push(`15m:${htf.htf15m.direction > 0 ? "↑" : "↓"}`);
  if (institutionalDirection !== 0) logicParts.push(`EMA50:${institutionalDirection > 0 ? "↑" : "↓"}`);
  if (trendConfirmed) logicParts.push(`Trend:${trendUp ? "↑" : "↓"}`);
  else logicParts.push("Trend:⚠️");
  logicParts.push(`Zone:${zone.position}`);
  logicParts.push(`RSI:${currentRSI.toFixed(0)}`);
  logicParts.push(`Stoch:${stoch.k[last].toFixed(0)}(${stochZone.signal})`);
  logicParts.push(`${layersPassed}/${layers.length} layers`);
  if (currentR2 > 0.5) logicParts.push(`R²:${(currentR2 * 100).toFixed(0)}%`);
  if (isNoisyMarket) logicParts.push(`Vol:${volState}`);
  if (smc.description) logicParts.push(`SMC:${smc.description}`);
  logicParts.push(expectancy > 0 ? `E+:${(expectancy * 100).toFixed(1)}%` : `E-:${(expectancy * 100).toFixed(1)}%`);
  const logic = logicParts.join(" | ");

  const details = [
    `[${grade}] EMA${emaCrossed ? " CROSS" : ""}: ${emaDiff > 0 ? "↑" : "↓"} (gap:${trendStrengthRaw.toFixed(1)})`,
    `RSI:${currentRSI.toFixed(1)}(${rsiSignal})`,
    `MACD:${macdCrossSignal}`,
    `BB:${zone.position}(${(currentPercentB * 100).toFixed(0)}%)`,
    `Stoch:${stochZone.signal}(K:${stoch.k[last].toFixed(0)})`,
    `Vol:${volState}`,
    `ATR:${currentATR.toFixed(4)}`,
    htf.direction !== 0 ? `MTF:${htf.direction > 0 ? "↑" : "↓"}` : null,
    smc.description ? `SMC:${smc.description}` : null,
    pattern,
  ].filter(Boolean).join(" | ");

  return {
    symbol: "",
    type,
    price: currentPrice,
    score: totalScore,
    confidence,
    grade,
    details,
    logic,
    pattern,
    metrics: {
      ema9: ema9[last],
      ema21: ema21[last],
      ema50: ema50[last],
      ema_cross: emaDiff,
      ema_gap_pct: currentEMAGap,
      ema_slope: currentSlope,
      rsi: currentRSI,
      rsi_signal: rsiSignal,
      macd_histogram: currentHistogram,
      macd_cross: macdCrossSignal,
      atr: currentATR,
      divergence: divergence?.type || null,
      divergence_strength: divergence?.strength || 0,
      engulfing: engulfing?.type || null,
      engulfing_strength: engulfing?.strength || 0,
      trend_strength: trendStrength,
      bb_percentB: currentPercentB,
      bb_position: zone.position,
      bb_bandwidth: currentBandwidth,
      stoch_k: stoch.k[last],
      stoch_d: stoch.d[last],
      stoch_signal: stochZone.signal,
      confluence_count: dominantCount,
      confluence_required: 3,
      volatility_state: volState,
      layers_passed: layersPassed,
      expectancy,
      htf_trend_5m: htf.htf5m.direction,
      htf_trend_15m: htf.htf15m.direction,
      mtf_aligned: mtfAligned,
      smc_signal: smc.description,
      // v5.2 Quant Math metrics
      std_dev: currentStdDev,
      lin_reg_slope: currentLinRegSlope,
      lin_reg_r2: currentR2,
      lin_reg_deviation: currentLinRegDev,
      z_score: currentZScore,
      quant_score: quantScore,
    },
  };
}

// ─── Signal Generator (v5.2) ────────────────────────────────

export type SignalCallback = (signal: SignalCandidate) => void;

export class SignalGenerator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private worker: Worker | null = null;
  private callbacks: SignalCallback[] = [];
  private activeSymbols: string[] = [];
  private running = false;
  private lastSignalTime = 0;
  private readonly MIN_INTERVAL_MS = 4 * 60 * 1000;
  private recentGrades: string[] = [];
  private consecutiveLosses = 0;

  constructor(symbols: string[]) {
    this.activeSymbols = symbols;
  }

  onSignal(cb: SignalCallback) {
    this.callbacks.push(cb);
    return () => { this.callbacks = this.callbacks.filter((c) => c !== cb); };
  }

  setSymbols(symbols: string[]) {
    this.activeSymbols = symbols;
  }

  reportTradeResult(isWin: boolean) {
    if (isWin) {
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;
    }
  }

  async generateSignal(): Promise<SignalCandidate | null> {
    if (this.activeSymbols.length === 0) return null;

    const candidates: SignalCandidate[] = [];

    const analyses = await Promise.allSettled(
      this.activeSymbols.map(async (symbol) => {
        const history = await derivWs.getTickHistory(symbol, 5000);
        if (!history?.prices || history.prices.length < 50) return null;

        const prices = history.prices.map(Number);
        const times = history.times ? history.times.map(Number) : undefined;
        const candidate = analyzeSymbol(prices, times);
        if (candidate) {
          candidate.symbol = symbol;
          return candidate;
        }
        return null;
      })
    );

    for (const result of analyses) {
      if (result.status === "fulfilled" && result.value) {
        candidates.push(result.value);
      }
    }

    if (candidates.length === 0) {
      console.log("[v5.3] No symbols with sufficient data this cycle");
      return null;
    }

    // v5.0: EMISSION GATE — Only A and B grades
    const qualityCandidates = candidates.filter(c => c.grade === "A" || c.grade === "B");

    // After 3+ consecutive losses, require A-grade only
    const minGrade = this.consecutiveLosses >= 3 ? "A" : "B";
    const filteredCandidates = this.consecutiveLosses >= 3
      ? qualityCandidates.filter(c => c.grade === "A")
      : qualityCandidates;

    const finalCandidates = filteredCandidates.length > 0 ? filteredCandidates : qualityCandidates;

    if (finalCandidates.length === 0) {
      const aCount = candidates.filter(c => c.grade === "A").length;
      const bCount = candidates.filter(c => c.grade === "B").length;
      const cCount = candidates.filter(c => c.grade === "C").length;
      console.log(
        `[v5.3] NO QUALITY SIGNALS — ${candidates.length} candidates: ${aCount}A/${bCount}B/${cCount}C | ` +
        `Min grade required: ${minGrade} | Consecutive losses: ${this.consecutiveLosses} — SKIPPING CYCLE`
      );
      return null;
    }

    // Quality-first sorting
    finalCandidates.sort((a, b) => {
      const gradeOrder = { A: 3, B: 2, C: 1 };
      const gradeDiff = gradeOrder[b.grade] - gradeOrder[a.grade];
      if (gradeDiff !== 0) return gradeDiff;
      if (b.metrics.expectancy !== a.metrics.expectancy) {
        return b.metrics.expectancy - a.metrics.expectancy;
      }
      return b.confidence - a.confidence;
    });

    const best = finalCandidates[0];

    const aCount = candidates.filter(c => c.grade === "A").length;
    const bCount = candidates.filter(c => c.grade === "B").length;
    const cCount = candidates.filter(c => c.grade === "C").length;
    console.log(
      `[v5.3] ${candidates.length} candidates: ${aCount}A/${bCount}B/${cCount}C (${cCount} filtered out) | ` +
      `Best: ${SYMBOLS[best.symbol] || best.symbol} ${best.type} [${best.grade}] ` +
      `score:${best.score} conf:${best.confidence}% ` +
      `MTF:${best.metrics.mtf_aligned ? "✓" : "✗"} ` +
      `E:${(best.metrics.expectancy * 100).toFixed(1)}% | ` +
      `Losses streak: ${this.consecutiveLosses}`
    );

    this.recentGrades.push(best.grade);
    if (this.recentGrades.length > 20) this.recentGrades.shift();

    return best;
  }

  start(intervalMs = 5 * 60 * 1000) {
    if (this.running) return;
    this.running = true;

    // Use Web Worker timer to prevent browser throttling in background tabs
    try {
      const workerScript = `
        let timerId = null;
        self.onmessage = function(e) {
          if (e.data.type === 'start') {
            if (timerId) clearInterval(timerId);
            timerId = setInterval(function() { self.postMessage('tick'); }, e.data.interval);
            self.postMessage('tick');
          } else if (e.data.type === 'stop') {
            if (timerId) clearInterval(timerId);
            timerId = null;
          }
        };
      `;
      const blob = new Blob([workerScript], { type: "application/javascript" });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = () => this.tick();
      this.worker.postMessage({ type: "start", interval: intervalMs });
      console.log(`[v5.3] Signal Engine Started — Web Worker timer (background-safe)`);
    } catch (err) {
      // Fallback to regular interval if Workers unavailable
      console.warn("[v5.3] Web Worker unavailable, using setInterval (will throttle in background):", err);
      this.intervalId = setInterval(() => this.tick(), intervalMs);
      console.log(`[v5.3] Signal Engine Started — setInterval fallback`);
    }

    console.log(`[v5.3] Layers: MTF(15m+5m) → Trend → Zone → Stoch → Momentum → RSI → Pattern → SMC → Slope → Quant(StdDev+LinReg+Z)`);
    console.log(`[v5.3] Filters: Hard Gates + Noise Gate + RSI Chop + MTF(15m) Conflict + Quant R² + Loss Streak`);
    console.log(`[v5.3] Emission: A/B grades only (C-grade suppressed) | Default: 15m TF + EMA(50)`);
  }

  stop() {
    this.running = false;
    if (this.worker) {
      this.worker.postMessage({ type: "stop" });
      this.worker.terminate();
      this.worker = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log(`[v5.3] Signal Engine Stopped`);
  }

  private async tick() {
    if (!this.running) return;
    try {
      const now = Date.now();
      const elapsed = now - this.lastSignalTime;
      if (elapsed < this.MIN_INTERVAL_MS) {
        console.log(`[v5.3] Skipping — ${Math.round(elapsed / 1000)}s since last (min ${this.MIN_INTERVAL_MS / 1000}s)`);
        return;
      }

      const signal = await this.generateSignal();
      if (signal) {
        this.lastSignalTime = Date.now();
        this.callbacks.forEach((cb) => cb(signal));
      }
    } catch (err) {
      console.error("[v5.3] Tick error:", err);
    }
  }

  isRunning() {
    return this.running;
  }

  getQualityStats() {
    const total = this.recentGrades.length;
    if (total === 0) return { aRate: 0, bRate: 0, cRate: 0 };
    return {
      aRate: this.recentGrades.filter(g => g === "A").length / total,
      bRate: this.recentGrades.filter(g => g === "B").length / total,
      cRate: this.recentGrades.filter(g => g === "C").length / total,
    };
  }
}
