/**
 * Signal Analysis Engine v5.4 — "Audit-Hardened" Edition
 *
 * CHANGES FROM v5.3.1:
 * ─ All magic constants extracted into ENGINE_CONFIG for transparency
 * ─ FVG now checks middle candle (unfilled gap validation)
 * ─ BoS uses proper swing-point structure (HH/HL & LH/LL detection)
 * ─ quantScore floor clamped to 0 (was going negative on Z-Score conflict)
 * ─ Loss-streak filter no longer silently falls back to B-grade
 * ─ NaN guards on all indicator outputs and price data
 * ─ Engulfing/Divergence strength multipliers documented with rationale
 * ─ MACD histogram early-index false spikes prevented
 * ─ EMA50 graceful fallback when history is marginal
 * ─ All original layers, window timing, and architecture PRESERVED
 *
 * ARCHITECTURE (unchanged):
 * ─ Layer 0: NOISE GATE — Volatility squeeze/extreme kills signals
 * ─ Layer 1: MTF TREND — 5m+15m EMA direction (institutional)
 * ─ Layer 2: TREND — 1-min EMA9/EMA21 micro direction
 * ─ Layer 3: ZONE — Bollinger %B S/R proximity
 * ─ Layer 4: EXHAUSTION — Stochastic zone + crossover
 * ─ Layer 5: MOMENTUM — MACD histogram direction
 * ─ Layer 6: RSI CONTEXT — Extreme RSI hard-locks direction
 * ─ Layer 7: PATTERN + SMC — Engulfing, Divergence, FVG, BoS
 * ─ Layer 8: QUANT MATH — Linear Regression R², Z-Score, StdDev
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

// ═════════════════════════════════════════════════════════════
// CONFIGURABLE PARAMETERS — All thresholds in one place
// ═════════════════════════════════════════════════════════════

export const ENGINE_CONFIG = {
  // ── Minimum data requirements ──
  MIN_PRICES: 50,           // Minimum ticks for analysis
  MIN_HTF_TICKS: 100,       // Minimum ticks for HTF computation
  MIN_HTF_CANDLES: 4,       // Minimum candles for HTF EMA

  // ── EMA periods ──
  EMA_FAST: 9,
  EMA_SLOW: 21,
  EMA_INSTITUTIONAL: 50,

  // ── RSI thresholds ──
  RSI_EXTREME_OVERSOLD: 15,
  RSI_OVERSOLD: 30,
  RSI_LEANING_OVERSOLD: 45,
  RSI_LEANING_OVERBOUGHT: 55,
  RSI_OVERBOUGHT: 70,
  RSI_EXTREME_OVERBOUGHT: 85,
  RSI_CHOP_RANGE: 8,        // Range < this in last 10 bars = choppy
  RSI_CHOP_LOW: 40,
  RSI_CHOP_HIGH: 60,

  // ── Stochastic thresholds ──
  STOCH_OVERSOLD: 20,
  STOCH_OVERBOUGHT: 80,
  STOCH_MID_BUY_CEIL: 40,   // Mid-range cross upper bound for buy
  STOCH_MID_SELL_FLOOR: 60,  // Mid-range cross lower bound for sell
  STOCH_EXTREME_HIGH: 95,    // Gate 4 extreme overbought
  STOCH_EXTREME_LOW: 5,      // Gate 5 extreme oversold

  // ── Bollinger Band zone thresholds ──
  BB_DEEP_SUPPORT: 0.10,
  BB_NEAR_SUPPORT: 0.25,
  BB_NEAR_RESISTANCE: 0.75,
  BB_DEEP_RESISTANCE: 0.90,
  BB_GATE4_THRESHOLD: 0.92,
  BB_GATE5_THRESHOLD: 0.08,
  BB_EXTREME_LOW: 0.10,
  BB_EXTREME_HIGH: 0.90,

  // ── Volatility classification ──
  VOL_SQUEEZE_RATIO: 0.5,    // BW < avg * this = squeeze
  VOL_EXPANSION_RATIO: 1.5,  // BW > avg * this = expansion
  VOL_EXTREME_RATIO: 2.0,    // BW > avg * this = extreme
  VOL_ATR_EXTREME_PCT: 0.5,  // ATR% > this = extreme

  // ── Trend detection ──
  TREND_STRENGTH_THRESHOLD: 1.5,  // emaDiff/price*10000 > this = confirmed
  TREND_CROSS_ALIGNED_SCORE: 20,
  TREND_CROSS_UNALIGNED_SCORE: 12,
  TREND_CONFIRMED_MULT: 3,   // trendStrengthRaw * this, capped at 15
  TREND_WEAK_MULT: 1.5,      // trendStrengthRaw * this, capped at 5
  TREND_INSTITUTIONAL_BONUS: 4,

  // ── Score multipliers (documented rationale) ──
  // Zone score: 0.15 = max 15 from zone_strength 100 (keeps zone as supporting, not dominant)
  ZONE_SCORE_MULT: 0.15,
  ZONE_SCORE_CAP: 15,
  // Exhaustion score: same logic as zone
  EXHAUSTION_SCORE_MULT: 0.15,
  EXHAUSTION_SCORE_CAP: 15,
  // Engulfing aligned: 0.12 = max ~12 from strength 100 (zone-aligned engulfing is strong)
  ENGULFING_ALIGNED_MULT: 0.12,
  ENGULFING_ALIGNED_CAP: 10,
  // Engulfing trend-only: 0.06 = half weight (less conviction without zone)
  ENGULFING_TREND_MULT: 0.06,
  ENGULFING_TREND_CAP: 5,
  // Divergence: 0.10 = max 10 (divergence alone is medium-strength)
  DIVERGENCE_MULT: 0.10,
  DIVERGENCE_CAP: 10,
  // SMC: 0.10 = max 10 (supplementary confirmation)
  SMC_SCORE_MULT: 0.10,
  SMC_SCORE_CAP: 10,
  // Slope: 40x raw slope capped at 5 (minor tiebreaker)
  SLOPE_MULT: 40,
  SLOPE_CAP: 5,
  // Momentum (non-cross): MACD histogram * 200 capped at 8
  MOMENTUM_HIST_MULT: 200,
  MOMENTUM_HIST_CAP: 8,
  MOMENTUM_CROSS_SCORE: 15,

  // ── Quant Math (Layer 8) ──
  R2_STRONG_THRESHOLD: 0.7,    // Strong linear trend
  R2_WEAK_THRESHOLD: 0.3,      // Choppy / no trend
  R2_DEVIATION_THRESHOLD: 0.5, // Min R² for regression deviation signal
  ZSCORE_EXTREME: 2.0,         // >2σ from mean = mean-reversion
  ZSCORE_REINFORCE_BONUS: 5,
  ZSCORE_CONFLICT_PENALTY: 3,
  STDDEV_BREAKOUT_CHANGE: 0.3,
  QUANT_SCORE_CAP: 15,

  // ── Conflict penalties ──
  PENALTY_RSI_HARDLOCK_OVERRIDE: 10,
  PENALTY_DEEP_ZONE_GATE: 8,
  PENALTY_EXTREME_STOCH_GATE: 5,
  PENALTY_TREND_ZONE_CONFLICT: 5,
  PENALTY_RSI_STOCH_CONFLICT: 8,
  PENALTY_MACD_TREND_CONFLICT: 5,
  PENALTY_INSTITUTIONAL_CONFLICT: 10,
  PENALTY_QUANT_R2_CONFLICT: 7,
  PENALTY_NOISY_MARKET: 15,
  PENALTY_RSI_CHOPPY: 8,

  // ── MTF ──
  MTF_STRENGTH_MULT: 1.5,
  MTF_SCORE_CAP: 15,
  MTF_PENALTY_BASE: 5,
  MTF_PENALTY_STRENGTH_MULT: 2,
  MTF_PENALTY_CAP: 20,
  MTF_ALIGNED_BONUS_BASE: 10,
  MTF_GATE_BLOCK_STRENGTH: 3,  // Gates 2/3
  MTF_GATE_BLOCK_STRONG: 5,    // Gates 4/5

  // ── Grading ──
  GRADE_A_MIN_LAYERS: 5,
  GRADE_A_MIN_SCORE: 60,
  GRADE_B_MIN_LAYERS: 3,
  GRADE_B_MIN_SCORE: 40,

  // ── Expectancy (Batista formula) ──
  // estimatedWinRate = BASE + (score/100) * SCALE
  // Rationale: a score-0 signal has ~45% win rate (slightly below breakeven),
  // a perfect score-100 signal has ~70% (45+25). Payout is Deriv standard 85%.
  EXPECTANCY_BASE_WINRATE: 0.45,
  EXPECTANCY_WINRATE_SCALE: 0.25,
  PAYOUT_RATIO: 0.85,

  // ── FVG minimum gap percentage ──
  FVG_MIN_GAP_PCT: 0.001,
  FVG_STRENGTH_MULT: 500,
  FVG_STRENGTH_CAP: 30,

  // ── BoS ──
  BOS_LOOKBACK: 5,
  BOS_STRENGTH: 20,

  // ── Signal Generator Window ──
  SCAN_INTERVAL_MS: 30 * 1000,
  WINDOW_OPEN_MS: 3 * 60 * 1000,
  WINDOW_CLOSE_MS: 5 * 60 * 1000,
  LOSS_STREAK_A_ONLY: 3,
} as const;

// ─── NaN safety utility ─────────────────────────────────────

function safeNum(val: number, fallback = 0): number {
  return Number.isFinite(val) ? val : fallback;
}

function sanitizePrices(prices: number[]): number[] {
  return prices.map(p => Number.isFinite(p) ? p : 0);
}

// ─── Signal Candidate ────────────────────────────────────────

export interface SignalCandidate {
  symbol: string;
  type: "BUY" | "SELL";
  price: number;
  score: number;
  confidence: number;
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
  if (!times || times.length < ENGINE_CONFIG.MIN_HTF_TICKS) return result;

  // 5-min candles
  const candles5m = buildCandles(prices, times, 300);
  if (candles5m.length >= ENGINE_CONFIG.MIN_HTF_CANDLES) {
    const closes = candles5m.map(c => c.close);
    const { fast, slow } = getAdaptivePeriods(closes.length, ENGINE_CONFIG.EMA_FAST, ENGINE_CONFIG.EMA_SLOW);
    const emaFast = calculateEMA(closes, fast);
    const emaSlow = calculateEMA(closes, slow);
    const last = closes.length - 1;
    const emaDiff = safeNum(emaFast[last]) - safeNum(emaSlow[last]);
    const emaSlope = last > 0 && safeNum(emaSlow[last - 1]) !== 0
      ? Math.abs((safeNum(emaSlow[last]) - safeNum(emaSlow[last - 1])) / safeNum(emaSlow[last - 1])) * 10000
      : 0;
    result.htf5m = {
      direction: emaDiff > 0 ? 1 : emaDiff < 0 ? -1 : 0,
      strength: safeNum(closes[last]) > 0 ? Math.abs(emaDiff) / closes[last] * 10000 + emaSlope : 0,
    };
  }

  // 15-min candles (institutional noise filter)
  const candles15m = buildCandles(prices, times, 900);
  if (candles15m.length >= ENGINE_CONFIG.MIN_HTF_CANDLES) {
    const closes = candles15m.map(c => c.close);
    const { fast, slow } = getAdaptivePeriods(closes.length, ENGINE_CONFIG.EMA_FAST, ENGINE_CONFIG.EMA_INSTITUTIONAL);
    const emaFast = calculateEMA(closes, fast);
    const emaSlow = calculateEMA(closes, slow);
    const last = closes.length - 1;
    const emaDiff = safeNum(emaFast[last]) - safeNum(emaSlow[last]);
    const emaSlope = last > 0 && safeNum(emaSlow[last - 1]) !== 0
      ? Math.abs((safeNum(emaSlow[last]) - safeNum(emaSlow[last - 1])) / safeNum(emaSlow[last - 1])) * 10000
      : 0;
    result.htf15m = {
      direction: emaDiff > 0 ? 1 : emaDiff < 0 ? -1 : 0,
      strength: safeNum(closes[last]) > 0 ? Math.abs(emaDiff) / closes[last] * 10000 + emaSlope : 0,
    };
  }

  // Combined: 15m priority (institutional), 5m confirms
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

  const currentBW = safeNum(bandwidth[last]);
  let bwSum = 0, bwCount = 0;
  for (let i = Math.max(0, last - 19); i <= last; i++) {
    const bw = safeNum(bandwidth[i]);
    if (bw > 0) { bwSum += bw; bwCount++; }
  }
  // Fallback: if no valid BW samples, treat as normal
  if (bwCount === 0) return "normal";
  const avgBW = bwSum / bwCount;
  const price = safeNum(prices[last]);
  const atrPct = price > 0 ? (safeNum(atr[last]) / price) * 100 : 0;

  if (currentBW < avgBW * ENGINE_CONFIG.VOL_SQUEEZE_RATIO) return "squeeze";
  if (currentBW > avgBW * ENGINE_CONFIG.VOL_EXTREME_RATIO || atrPct > ENGINE_CONFIG.VOL_ATR_EXTREME_PCT) return "extreme";
  if (currentBW > avgBW * ENGINE_CONFIG.VOL_EXPANSION_RATIO) return "expansion";
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
  const pB = safeNum(percentB, 0.5);
  if (pB <= ENGINE_CONFIG.BB_DEEP_SUPPORT) {
    return { inBuyZone: true, inSellZone: false, zoneStrength: Math.min((ENGINE_CONFIG.BB_DEEP_SUPPORT - pB) / ENGINE_CONFIG.BB_DEEP_SUPPORT * 100, 100), position: "deep_support" };
  }
  if (pB <= ENGINE_CONFIG.BB_NEAR_SUPPORT) {
    return { inBuyZone: true, inSellZone: false, zoneStrength: Math.min((ENGINE_CONFIG.BB_NEAR_SUPPORT - pB) / ENGINE_CONFIG.BB_NEAR_SUPPORT * 60, 60), position: "near_support" };
  }
  if (pB >= ENGINE_CONFIG.BB_DEEP_RESISTANCE) {
    return { inBuyZone: false, inSellZone: true, zoneStrength: Math.min((pB - ENGINE_CONFIG.BB_DEEP_RESISTANCE) / (1 - ENGINE_CONFIG.BB_DEEP_RESISTANCE) * 100, 100), position: "deep_resistance" };
  }
  if (pB >= ENGINE_CONFIG.BB_NEAR_RESISTANCE) {
    return { inBuyZone: false, inSellZone: true, zoneStrength: Math.min((pB - ENGINE_CONFIG.BB_NEAR_RESISTANCE) / (1 - ENGINE_CONFIG.BB_NEAR_RESISTANCE) * 60, 60), position: "near_resistance" };
  }
  return { inBuyZone: false, inSellZone: false, zoneStrength: 0, position: "mid_range" };
}

// ─── Stochastic Zone Detection ───────────────────────────────

interface StochZone {
  isBuyZone: boolean;
  isSellZone: boolean;
  hasCross: boolean;
  strength: number;
  signal: string;
  direction: number;
}

function detectStochZone(k: number[], d: number[], last: number): StochZone {
  if (last < 2) return { isBuyZone: false, isSellZone: false, hasCross: false, strength: 0, signal: "neutral", direction: 0 };

  const currK = safeNum(k[last], 50), currD = safeNum(d[last], 50);
  const prevK = safeNum(k[last - 1], 50), prevD = safeNum(d[last - 1], 50);

  const bullishCross = prevK <= prevD && currK > currD;
  const bearishCross = prevK >= prevD && currK < currD;

  if (currK < ENGINE_CONFIG.STOCH_OVERSOLD) {
    const crossBonus = bullishCross ? 50 : 0;
    const depth = (ENGINE_CONFIG.STOCH_OVERSOLD - currK) / ENGINE_CONFIG.STOCH_OVERSOLD * 50;
    return {
      isBuyZone: true, isSellZone: false, hasCross: bullishCross,
      strength: Math.min(depth + crossBonus, 100),
      signal: bullishCross ? "oversold_cross_up" : "oversold_zone",
      direction: 1,
    };
  }

  if (currK > ENGINE_CONFIG.STOCH_OVERBOUGHT) {
    const crossBonus = bearishCross ? 50 : 0;
    const depth = (currK - ENGINE_CONFIG.STOCH_OVERBOUGHT) / (100 - ENGINE_CONFIG.STOCH_OVERBOUGHT) * 50;
    return {
      isBuyZone: false, isSellZone: true, hasCross: bearishCross,
      strength: Math.min(depth + crossBonus, 100),
      signal: bearishCross ? "overbought_cross_down" : "overbought_zone",
      direction: -1,
    };
  }

  if (bullishCross && currK < ENGINE_CONFIG.STOCH_MID_BUY_CEIL) {
    return { isBuyZone: false, isSellZone: false, hasCross: true, strength: 20, signal: "mid_cross_up", direction: 1 };
  }
  if (bearishCross && currK > ENGINE_CONFIG.STOCH_MID_SELL_FLOOR) {
    return { isBuyZone: false, isSellZone: false, hasCross: true, strength: 20, signal: "mid_cross_down", direction: -1 };
  }

  return { isBuyZone: false, isSellZone: false, hasCross: false, strength: 0, signal: "neutral", direction: 0 };
}

// ─── Smart Money Concepts (v5.4 — proper FVG + BoS) ─────────

interface SMCResult {
  fvg: "bullish" | "bearish" | null;
  bos: "bullish" | "bearish" | null;
  direction: number;
  strength: number;
  description: string | null;
}

function detectSMC(prices: number[], times?: number[]): SMCResult {
  const result: SMCResult = { fvg: null, bos: null, direction: 0, strength: 0, description: null };

  if (!times || prices.length < ENGINE_CONFIG.MIN_HTF_TICKS) return result;

  const candles = buildCandles(prices, times, 60);
  if (candles.length < 10) return result;

  const last = candles.length - 1;

  // ── Fair Value Gap Detection (v5.4 FIX: checks middle candle) ──
  // Bullish FVG: candle[i-2].high < candle[i].low AND middle candle didn't fill the gap
  // This means the gap between c0.high and c2.low was NOT covered by c1's range
  if (last >= 2) {
    const c0 = candles[last - 2]; // oldest
    const c1 = candles[last - 1]; // middle — must NOT fill the gap
    const c2 = candles[last];     // newest

    if (c2.low > c0.high) {
      // Potential bullish FVG gap exists
      // v5.4: Validate gap is UNFILLED — middle candle's low must be above c0.high
      // (if c1 dipped into the gap, the FVG is filled/invalid)
      const gapUnfilled = c1.low >= c0.high;
      if (gapUnfilled) {
        const gapSize = c2.low - c0.high;
        const avgPrice = (c0.close + c2.close) / 2;
        const gapPct = avgPrice > 0 ? (gapSize / avgPrice) * 100 : 0;
        if (gapPct > ENGINE_CONFIG.FVG_MIN_GAP_PCT) {
          result.fvg = "bullish";
          result.direction += 1;
          result.strength += Math.min(gapPct * ENGINE_CONFIG.FVG_STRENGTH_MULT, ENGINE_CONFIG.FVG_STRENGTH_CAP);
        }
      }
    } else if (c2.high < c0.low) {
      // Potential bearish FVG
      // v5.4: Middle candle's high must be below c0.low (gap unfilled)
      const gapUnfilled = c1.high <= c0.low;
      if (gapUnfilled) {
        const gapSize = c0.low - c2.high;
        const avgPrice = (c0.close + c2.close) / 2;
        const gapPct = avgPrice > 0 ? (gapSize / avgPrice) * 100 : 0;
        if (gapPct > ENGINE_CONFIG.FVG_MIN_GAP_PCT) {
          result.fvg = "bearish";
          result.direction -= 1;
          result.strength += Math.min(gapPct * ENGINE_CONFIG.FVG_STRENGTH_MULT, ENGINE_CONFIG.FVG_STRENGTH_CAP);
        }
      }
    }
  }

  // ── Break of Structure (v5.4 FIX: proper swing-point detection) ──
  // Instead of simple breakout, detect swing highs/lows and check for
  // structural break: HH after HL = bullish BoS, LL after LH = bearish BoS
  if (last >= 8) {
    const lookback = Math.min(ENGINE_CONFIG.BOS_LOOKBACK, last - 3);

    // Find the two most recent swing highs and swing lows
    const swingHighs: { idx: number; price: number }[] = [];
    const swingLows: { idx: number; price: number }[] = [];

    for (let i = last - lookback * 2; i <= last - 1; i++) {
      if (i < 1 || i >= candles.length - 1) continue;
      // Swing high: higher than both neighbors
      if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
        swingHighs.push({ idx: i, price: candles[i].high });
      }
      // Swing low: lower than both neighbors
      if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
        swingLows.push({ idx: i, price: candles[i].low });
      }
    }

    const latestCandle = candles[last];

    // Bullish BoS: latest candle closes above the most recent swing high
    // AND the most recent swing low is a Higher Low (compared to previous swing low)
    if (swingHighs.length >= 1 && swingLows.length >= 2) {
      const recentHigh = swingHighs[swingHighs.length - 1];
      const [prevLow, currLow] = swingLows.slice(-2);
      // Higher Low + break above swing high = structural bullish break
      if (currLow.price > prevLow.price && latestCandle.close > recentHigh.price) {
        result.bos = "bullish";
        result.direction += 1;
        result.strength += ENGINE_CONFIG.BOS_STRENGTH;
      }
    }

    // Bearish BoS: latest candle closes below recent swing low
    // AND the most recent swing high is a Lower High
    if (!result.bos && swingHighs.length >= 2 && swingLows.length >= 1) {
      const recentLow = swingLows[swingLows.length - 1];
      const [prevHigh, currHigh] = swingHighs.slice(-2);
      if (currHigh.price < prevHigh.price && latestCandle.close < recentLow.price) {
        result.bos = "bearish";
        result.direction -= 1;
        result.strength += ENGINE_CONFIG.BOS_STRENGTH;
      }
    }
  }

  const parts: string[] = [];
  if (result.fvg) parts.push(`FVG:${result.fvg}`);
  if (result.bos) parts.push(`BoS:${result.bos}`);
  result.description = parts.length > 0 ? parts.join(" + ") : null;

  // Normalize direction to -1/0/+1
  result.direction = result.direction > 0 ? 1 : result.direction < 0 ? -1 : 0;

  return result;
}

// ═════════════════════════════════════════════════════════════
// MAIN ANALYSIS FUNCTION (v5.4)
// ═════════════════════════════════════════════════════════════

export function analyzeSymbol(
  prices: number[],
  times?: number[],
): SignalCandidate | null {
  if (prices.length < ENGINE_CONFIG.MIN_PRICES) return null;

  // ── Sanitize input (NaN guard) ──
  const cleanPrices = sanitizePrices(prices);

  // ── Compute all 1-min indicators ──
  const ema9 = calculateEMA(cleanPrices, ENGINE_CONFIG.EMA_FAST);
  const ema21 = calculateEMA(cleanPrices, ENGINE_CONFIG.EMA_SLOW);
  // EMA50: graceful fallback — need at least period+1 valid data points
  const ema50Period = cleanPrices.length > ENGINE_CONFIG.EMA_INSTITUTIONAL + 1
    ? ENGINE_CONFIG.EMA_INSTITUTIONAL
    : Math.max(2, Math.floor(cleanPrices.length * 0.6));
  const ema50 = calculateEMA(cleanPrices, ema50Period);
  const rsi = calculateRSI(cleanPrices, 14);
  const { histogram } = calculateMACD(cleanPrices);
  const atr = calculateATR(cleanPrices, 14);
  const slope = calculateEMASlope(ema9, 5);
  const emaGap = calculateEMAGap(ema9, ema21, cleanPrices);
  const bb = calculateBollingerBands(cleanPrices, 20, 2);
  const stoch = calculateStochastic(cleanPrices, 14, 3);
  const stdDev = calculateStdDev(cleanPrices, 20);
  const linReg = calculateLinearRegression(cleanPrices, 20);
  const zScore = calculateZScore(cleanPrices, 20);

  const last = cleanPrices.length - 1;
  const currentPrice = safeNum(cleanPrices[last]);
  if (currentPrice === 0) return null; // No valid price

  const currentRSI = safeNum(rsi[last], 50);
  const currentHistogram = safeNum(histogram[last]);
  // v5.4 FIX: guard prevHistogram index
  const prevHistogram = last > 0 ? safeNum(histogram[last - 1]) : 0;
  const currentATR = safeNum(atr[last]);
  const currentSlope = safeNum(slope[last]);
  const currentEMAGap = safeNum(emaGap[last]);
  const currentPercentB = safeNum(bb.percentB[last], 0.5);
  const currentBandwidth = safeNum(bb.bandwidth[last]);
  const currentStdDev = safeNum(stdDev[last]);
  const currentLinRegSlope = safeNum(linReg.slope[last]);
  const currentR2 = safeNum(linReg.r2[last]);
  const currentLinRegDev = safeNum(linReg.deviation[last]);
  const currentZScore = safeNum(zScore[last]);

  // ════════════════════════════════════════════════════════════
  // LAYER 0: NOISE GATE — Volatility Filter
  // ════════════════════════════════════════════════════════════

  const volState = classifyVolatility(bb.bandwidth, atr, cleanPrices, last);
  const isNoisyMarket = volState === "squeeze" || volState === "extreme";

  // ════════════════════════════════════════════════════════════
  // LAYER 1: MTF TREND — 5m+15m candle direction
  // ════════════════════════════════════════════════════════════

  const htf: HTFResult = times
    ? computeHTFTrend(cleanPrices, times)
    : { direction: 0, strength: 0, htf5m: { direction: 0, strength: 0 }, htf15m: { direction: 0, strength: 0 } };
  let mtfScore = htf.direction !== 0 ? Math.min(htf.strength * ENGINE_CONFIG.MTF_STRENGTH_MULT, ENGINE_CONFIG.MTF_SCORE_CAP) : 0;

  // ════════════════════════════════════════════════════════════
  // LAYER 2: TREND — EMA9 vs EMA21 (1-min)
  // ════════════════════════════════════════════════════════════

  const ema9Last = safeNum(ema9[last]);
  const ema21Last = safeNum(ema21[last]);
  const ema50Last = safeNum(ema50[last]);
  const ema9Prev = last > 0 ? safeNum(ema9[last - 1]) : ema9Last;
  const ema21Prev = last > 0 ? safeNum(ema21[last - 1]) : ema21Last;

  const emaDiff = ema9Last - ema21Last;
  const prevEmaDiff = ema9Prev - ema21Prev;
  const emaCrossed = (prevEmaDiff <= 0 && emaDiff > 0) || (prevEmaDiff >= 0 && emaDiff < 0);
  const trendUp = emaDiff > 0;
  const trendDown = emaDiff < 0;

  // Institutional filter: price + EMA21 both above/below EMA50
  const institutionalDirection =
    currentPrice > ema50Last && ema21Last >= ema50Last
      ? 1
      : currentPrice < ema50Last && ema21Last <= ema50Last
        ? -1
        : 0;
  const localTrendDirection = trendUp ? 1 : trendDown ? -1 : 0;
  const institutionalAligned = institutionalDirection === 0 || institutionalDirection === localTrendDirection;
  const trendStrengthRaw = currentPrice > 0 ? Math.abs(emaDiff) / currentPrice * 10000 : 0;
  const trendConfirmed = trendStrengthRaw > ENGINE_CONFIG.TREND_STRENGTH_THRESHOLD && institutionalAligned;

  let trendScore = 0;
  if (emaCrossed) trendScore = institutionalAligned ? ENGINE_CONFIG.TREND_CROSS_ALIGNED_SCORE : ENGINE_CONFIG.TREND_CROSS_UNALIGNED_SCORE;
  else if (trendConfirmed) trendScore = Math.min(trendStrengthRaw * ENGINE_CONFIG.TREND_CONFIRMED_MULT, 15);
  else trendScore = Math.min(trendStrengthRaw * ENGINE_CONFIG.TREND_WEAK_MULT, 5);

  if (institutionalDirection !== 0) {
    trendScore = institutionalAligned
      ? Math.min(trendScore + ENGINE_CONFIG.TREND_INSTITUTIONAL_BONUS, 20)
      : Math.max(trendScore - ENGINE_CONFIG.TREND_INSTITUTIONAL_BONUS, 0);
  }

  // ════════════════════════════════════════════════════════════
  // LAYER 3: ZONE — Bollinger S/R Proximity
  // ════════════════════════════════════════════════════════════

  const zone = detectZone(currentPercentB);
  let zoneScore = 0;
  if (zone.inBuyZone || zone.inSellZone) {
    zoneScore = Math.min(zone.zoneStrength * ENGINE_CONFIG.ZONE_SCORE_MULT, ENGINE_CONFIG.ZONE_SCORE_CAP);
  }

  // ════════════════════════════════════════════════════════════
  // LAYER 4: EXHAUSTION — Stochastic
  // ════════════════════════════════════════════════════════════

  const stochZone = detectStochZone(stoch.k, stoch.d, last);
  let exhaustionScore = 0;
  if (stochZone.isBuyZone || stochZone.isSellZone) {
    exhaustionScore = Math.min(stochZone.strength * ENGINE_CONFIG.EXHAUSTION_SCORE_MULT, ENGINE_CONFIG.EXHAUSTION_SCORE_CAP);
  }

  // ════════════════════════════════════════════════════════════
  // LAYER 5: MOMENTUM — MACD Histogram
  // v5.4 FIX: Skip early indices where histogram is unreliable
  // (EMA26 needs 26 bars + signal EMA needs 9 more = 35 bars for valid data)
  // ════════════════════════════════════════════════════════════

  const macdReliable = last >= 35; // MACD valid only after bar 35
  let momentumScore = 0;
  let macdCrossSignal = "none";
  let macdDirection = 0;

  if (macdReliable) {
    const macdCrossed = (prevHistogram <= 0 && currentHistogram > 0) ||
                        (prevHistogram >= 0 && currentHistogram < 0);
    if (macdCrossed) {
      momentumScore = ENGINE_CONFIG.MOMENTUM_CROSS_SCORE;
      macdCrossSignal = currentHistogram > 0 ? "bullish_cross" : "bearish_cross";
      macdDirection = currentHistogram > 0 ? 1 : -1;
    } else {
      momentumScore = Math.min(Math.abs(currentHistogram) * ENGINE_CONFIG.MOMENTUM_HIST_MULT, ENGINE_CONFIG.MOMENTUM_HIST_CAP);
      macdCrossSignal = currentHistogram > 0 ? "bullish" : "bearish";
      macdDirection = currentHistogram > 0 ? 1 : -1;
    }
  }

  // ════════════════════════════════════════════════════════════
  // LAYER 6: RSI CONTEXT
  // ════════════════════════════════════════════════════════════

  let rsiScore = 0;
  let rsiSignal = "neutral";
  let rsiDirection = 0;
  let rsiHardLock: "BUY" | "SELL" | null = null;

  // RSI chop detector: if recent RSI range is tiny and RSI is mid-range → indecisive
  const rsiSlice = rsi.slice(Math.max(0, last - 9), last + 1);
  const rsiRecentRange = Math.max(...rsiSlice) - Math.min(...rsiSlice);
  const rsiIsChoppy = rsiRecentRange < ENGINE_CONFIG.RSI_CHOP_RANGE
    && currentRSI > ENGINE_CONFIG.RSI_CHOP_LOW
    && currentRSI < ENGINE_CONFIG.RSI_CHOP_HIGH;

  if (currentRSI <= ENGINE_CONFIG.RSI_EXTREME_OVERSOLD) {
    rsiScore = 15; rsiSignal = "extreme_oversold"; rsiDirection = 1; rsiHardLock = "BUY";
  } else if (currentRSI < ENGINE_CONFIG.RSI_OVERSOLD) {
    rsiScore = 12; rsiSignal = "oversold"; rsiDirection = 1;
  } else if (currentRSI >= ENGINE_CONFIG.RSI_EXTREME_OVERBOUGHT) {
    rsiScore = 15; rsiSignal = "extreme_overbought"; rsiDirection = -1; rsiHardLock = "SELL";
  } else if (currentRSI > ENGINE_CONFIG.RSI_OVERBOUGHT) {
    rsiScore = 12; rsiSignal = "overbought"; rsiDirection = -1;
  } else if (rsiIsChoppy) {
    rsiScore = 0; rsiSignal = "choppy"; rsiDirection = 0;
  } else if (currentRSI < ENGINE_CONFIG.RSI_LEANING_OVERSOLD) {
    rsiScore = 4; rsiSignal = "leaning_oversold"; rsiDirection = 1;
  } else if (currentRSI > ENGINE_CONFIG.RSI_LEANING_OVERBOUGHT) {
    rsiScore = 4; rsiSignal = "leaning_overbought"; rsiDirection = -1;
  } else {
    rsiScore = 0; rsiSignal = "neutral"; rsiDirection = 0;
  }

  // ════════════════════════════════════════════════════════════
  // LAYER 7: PATTERN + SMC
  // ════════════════════════════════════════════════════════════

  const divergence = detectDivergence(cleanPrices, rsi);
  const engulfing = detectEngulfing(cleanPrices, 10);
  const smc = detectSMC(cleanPrices, times);

  let patternBonus = 0;
  let patternDirection = 0;

  // Engulfing — zone-aligned gets full weight, trend-only gets half
  if (engulfing) {
    const alignedWithZone =
      (engulfing.type === "bullish" && zone.inBuyZone) ||
      (engulfing.type === "bearish" && zone.inSellZone);
    if (alignedWithZone) {
      patternBonus += Math.min(engulfing.strength * ENGINE_CONFIG.ENGULFING_ALIGNED_MULT, ENGINE_CONFIG.ENGULFING_ALIGNED_CAP);
      patternDirection = engulfing.type === "bullish" ? 1 : -1;
    } else if (
      (engulfing.type === "bullish" && trendUp) ||
      (engulfing.type === "bearish" && trendDown)
    ) {
      patternBonus += Math.min(engulfing.strength * ENGINE_CONFIG.ENGULFING_TREND_MULT, ENGINE_CONFIG.ENGULFING_TREND_CAP);
      patternDirection = engulfing.type === "bullish" ? 1 : -1;
    }
  }

  // Divergence — zone-aligned only (divergence without zone context is unreliable)
  if (divergence) {
    const divAligned =
      (divergence.type === "bullish" && zone.inBuyZone) ||
      (divergence.type === "bearish" && zone.inSellZone);
    if (divAligned) {
      patternBonus += Math.min(divergence.strength * ENGINE_CONFIG.DIVERGENCE_MULT, ENGINE_CONFIG.DIVERGENCE_CAP);
      if (patternDirection === 0) patternDirection = divergence.type === "bullish" ? 1 : -1;
    }
  }

  // SMC bonus
  let smcScore = 0;
  if (smc.direction !== 0) {
    smcScore = Math.min(smc.strength * ENGINE_CONFIG.SMC_SCORE_MULT, ENGINE_CONFIG.SMC_SCORE_CAP);
  }

  // Slope (minor tiebreaker)
  const slopeScore = Math.min(Math.abs(currentSlope) * ENGINE_CONFIG.SLOPE_MULT, ENGINE_CONFIG.SLOPE_CAP);
  const slopeDirection = currentSlope > 0 ? 1 : currentSlope < 0 ? -1 : 0;

  // ════════════════════════════════════════════════════════════
  // LAYER 8: QUANT MATH — StdDev, Linear Regression, Z-Score
  // ════════════════════════════════════════════════════════════

  let quantScore = 0;
  let quantDirection = 0;

  // Linear Regression: R² > 0.7 = strong trend, slope gives direction
  if (currentR2 > ENGINE_CONFIG.R2_STRONG_THRESHOLD) {
    quantDirection = currentLinRegSlope > 0 ? 1 : currentLinRegSlope < 0 ? -1 : 0;
    quantScore += Math.min(currentR2 * 10, 8);
  }
  // R² < 0.3 = choppy (no bonus, handled by noise gate)

  // Z-Score: >2σ from mean suggests mean-reversion
  if (Math.abs(currentZScore) > ENGINE_CONFIG.ZSCORE_EXTREME) {
    const zDir = currentZScore > 0 ? -1 : 1; // Sell above mean, Buy below
    if (quantDirection === 0) {
      quantDirection = zDir;
    } else if (quantDirection === zDir) {
      quantScore += ENGINE_CONFIG.ZSCORE_REINFORCE_BONUS;
    } else {
      // v5.4 FIX: clamp subtraction so quantScore never goes negative
      quantScore = Math.max(0, quantScore - ENGINE_CONFIG.ZSCORE_CONFLICT_PENALTY);
    }
  }

  // Regression deviation: price far from regression line in strong trend
  if (currentPrice > 0 && currentR2 > ENGINE_CONFIG.R2_DEVIATION_THRESHOLD) {
    const devPct = Math.abs(currentLinRegDev) / currentPrice * 100;
    if (devPct > 0.05) {
      const devDir = currentLinRegDev > 0 ? -1 : 1;
      if (devDir === quantDirection) quantScore += 3;
    }
  }

  // Std Dev rate of change: expanding vol = breakout, contracting = mean reversion
  if (last >= 5 && safeNum(stdDev[last - 5]) > 0) {
    const stdDevChange = (currentStdDev - safeNum(stdDev[last - 5])) / safeNum(stdDev[last - 5]);
    if (stdDevChange > ENGINE_CONFIG.STDDEV_BREAKOUT_CHANGE) {
      quantScore += 2; // Volatility expanding — favor trend continuation
    } else if (stdDevChange < -ENGINE_CONFIG.STDDEV_BREAKOUT_CHANGE) {
      quantScore += 1; // Volatility contracting — favor mean reversion
    }
  }

  quantScore = Math.min(Math.max(quantScore, 0), ENGINE_CONFIG.QUANT_SCORE_CAP);

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
  // HARD DIRECTIONAL GATES (v5.3+ — MTF-aware)
  // ════════════════════════════════════════════════════════════

  let conflictPenalty = 0;
  let type: "BUY" | "SELL" = rawType;
  let hardGateApplied = false;

  // GATE 1: RSI Hard Lock — only gate that overrides MTF (extreme RSI = highest conviction)
  if (rsiHardLock) {
    if (rawType !== rsiHardLock) {
      type = rsiHardLock;
      conflictPenalty += ENGINE_CONFIG.PENALTY_RSI_HARDLOCK_OVERRIDE;
    } else {
      type = rsiHardLock;
    }
    hardGateApplied = true;
  }

  // GATE 2: Deep resistance + Stoch overbought = SELL (unless MTF strongly bullish)
  if (!rsiHardLock && zone.position === "deep_resistance" && stochZone.isSellZone) {
    const mtfBlocksGate = htf.direction > 0 && htf.strength > ENGINE_CONFIG.MTF_GATE_BLOCK_STRENGTH;
    if (type === "BUY" && !mtfBlocksGate) {
      type = "SELL";
      conflictPenalty += ENGINE_CONFIG.PENALTY_DEEP_ZONE_GATE;
      hardGateApplied = true;
    }
  }

  // GATE 3: Deep support + Stoch oversold = BUY (unless MTF strongly bearish)
  if (!rsiHardLock && zone.position === "deep_support" && stochZone.isBuyZone) {
    const mtfBlocksGate = htf.direction < 0 && htf.strength > ENGINE_CONFIG.MTF_GATE_BLOCK_STRENGTH;
    if (type === "SELL" && !mtfBlocksGate) {
      type = "BUY";
      conflictPenalty += ENGINE_CONFIG.PENALTY_DEEP_ZONE_GATE;
      hardGateApplied = true;
    }
  }

  // GATE 4: Extreme overbought (K > 95, %B > 0.92) — very high conviction
  if (!rsiHardLock && safeNum(stoch.k[last]) > ENGINE_CONFIG.STOCH_EXTREME_HIGH
      && currentPercentB > ENGINE_CONFIG.BB_GATE4_THRESHOLD && type === "BUY") {
    const mtfBlocksGate = htf.direction > 0 && htf.strength > ENGINE_CONFIG.MTF_GATE_BLOCK_STRONG;
    if (!mtfBlocksGate) {
      type = "SELL";
      conflictPenalty += ENGINE_CONFIG.PENALTY_EXTREME_STOCH_GATE;
      hardGateApplied = true;
    }
  }

  // GATE 5: Extreme oversold (K < 5, %B < 0.08) — very high conviction
  if (!rsiHardLock && safeNum(stoch.k[last]) < ENGINE_CONFIG.STOCH_EXTREME_LOW
      && currentPercentB < ENGINE_CONFIG.BB_GATE5_THRESHOLD && type === "SELL") {
    const mtfBlocksGate = htf.direction < 0 && htf.strength > ENGINE_CONFIG.MTF_GATE_BLOCK_STRONG;
    if (!mtfBlocksGate) {
      type = "BUY";
      conflictPenalty += ENGINE_CONFIG.PENALTY_EXTREME_STOCH_GATE;
      hardGateApplied = true;
    }
  }

  // ── Directional Conflict Checks ──

  // Trend vs Zone conflict
  if (trendConfirmed && (zone.inBuyZone || zone.inSellZone)) {
    const trendDir = trendUp ? 1 : -1;
    const zoneDir = zone.inBuyZone ? 1 : -1;
    if (trendDir !== zoneDir) conflictPenalty += ENGINE_CONFIG.PENALTY_TREND_ZONE_CONFLICT;
  }

  // RSI vs Stoch conflict
  if (rsiDirection !== 0 && stochZone.direction !== 0 && rsiDirection !== stochZone.direction) {
    conflictPenalty += ENGINE_CONFIG.PENALTY_RSI_STOCH_CONFLICT;
  }

  // MACD vs Trend conflict
  if (macdDirection !== 0 && trendConfirmed) {
    const trendDir = trendUp ? 1 : -1;
    if (macdDirection !== trendDir) conflictPenalty += ENGINE_CONFIG.PENALTY_MACD_TREND_CONFLICT;
  }

  // EMA50 institutional bias conflict
  if (institutionalDirection !== 0) {
    const signalDir = type === "BUY" ? 1 : -1;
    if (institutionalDirection !== signalDir) conflictPenalty += ENGINE_CONFIG.PENALTY_INSTITUTIONAL_CONFLICT;
  }

  // MTF disagreement penalty (proportional to HTF strength)
  const mtfAligned = htf.direction === 0 || (type === "BUY" ? htf.direction > 0 : htf.direction < 0);
  if (htf.direction !== 0 && !mtfAligned) {
    const mtfPenalty = Math.min(
      Math.round(ENGINE_CONFIG.MTF_PENALTY_BASE + htf.strength * ENGINE_CONFIG.MTF_PENALTY_STRENGTH_MULT),
      ENGINE_CONFIG.MTF_PENALTY_CAP
    );
    conflictPenalty += mtfPenalty;
  } else if (mtfAligned && htf.direction !== 0) {
    mtfScore = Math.min(ENGINE_CONFIG.MTF_ALIGNED_BONUS_BASE + Math.round(htf.strength), ENGINE_CONFIG.MTF_SCORE_CAP);
  }

  // Quant conflict: R² strong but direction disagrees with signal
  if (currentR2 > ENGINE_CONFIG.R2_STRONG_THRESHOLD && quantDirection !== 0) {
    const signalDir = type === "BUY" ? 1 : -1;
    if (quantDirection !== signalDir) conflictPenalty += ENGINE_CONFIG.PENALTY_QUANT_R2_CONFLICT;
  }

  // Noise penalties
  if (isNoisyMarket) conflictPenalty += ENGINE_CONFIG.PENALTY_NOISY_MARKET;
  if (rsiIsChoppy) conflictPenalty += ENGINE_CONFIG.PENALTY_RSI_CHOPPY;

  // ════════════════════════════════════════════════════════════
  // COMPOSITE SCORE — linear additive with confluence adjustment
  // ════════════════════════════════════════════════════════════

  const rawScore = mtfScore + trendScore + zoneScore + exhaustionScore +
    momentumScore + rsiScore + patternBonus + smcScore + slopeScore + quantScore;

  const penalizedScore = Math.max(rawScore - conflictPenalty, 0);

  // Confluence boost: more layers agreeing = higher confidence
  const confluenceRatio = totalWeight > 0 ? dominantWeight / totalWeight : 0.5;
  const totalScore = Math.min(Math.round(penalizedScore * (0.7 + 0.3 * confluenceRatio)), 100);

  const confidence = totalScore;

  // ── Signal Grade ──
  let grade: "A" | "B" | "C" = "C";
  if (layersPassed >= ENGINE_CONFIG.GRADE_A_MIN_LAYERS && totalScore >= ENGINE_CONFIG.GRADE_A_MIN_SCORE && !isNoisyMarket && mtfAligned) {
    grade = "A";
  } else if (layersPassed >= ENGINE_CONFIG.GRADE_B_MIN_LAYERS && totalScore >= ENGINE_CONFIG.GRADE_B_MIN_SCORE) {
    grade = "B";
  }

  // ── Expectancy (Batista formula) ──
  const estimatedWinRate = ENGINE_CONFIG.EXPECTANCY_BASE_WINRATE + (totalScore / 100) * ENGINE_CONFIG.EXPECTANCY_WINRATE_SCALE;
  const expectancy = estimatedWinRate * ENGINE_CONFIG.PAYOUT_RATIO - (1 - estimatedWinRate);

  // ════════════════════════════════════════════════════════════
  // BUILD OUTPUT
  // ════════════════════════════════════════════════════════════

  const trendStrength = totalWeight > 0
    ? Math.abs(buyWeight - sellWeight) / totalWeight * 100
    : 0;

  const patterns: string[] = [];
  if (engulfing && patternBonus > 0) patterns.push(`${engulfing.type === "bullish" ? "BULLISH" : "BEARISH"} ENGULFING`);
  if (divergence && patternBonus > 0) patterns.push(`${divergence.type.toUpperCase()} DIVERGENCE`);
  if (emaCrossed) patterns.push("EMA CROSSOVER");
  if (macdReliable && macdCrossSignal.includes("cross")) patterns.push("MACD CROSSOVER");
  if (stochZone.hasCross) patterns.push("STOCH CROSSOVER");
  if (stochZone.isBuyZone || stochZone.isSellZone) patterns.push(`STOCH ${stochZone.isSellZone ? "OVERBOUGHT" : "OVERSOLD"}`);
  if (currentPercentB <= ENGINE_CONFIG.BB_EXTREME_LOW || currentPercentB >= ENGINE_CONFIG.BB_EXTREME_HIGH) patterns.push("BB EXTREME");
  if (smc.description) patterns.push(`SMC: ${smc.description}`);
  if (hardGateApplied) patterns.push("HARD GATE APPLIED");
  if (currentR2 > ENGINE_CONFIG.R2_STRONG_THRESHOLD) patterns.push(`LINREG R²:${(currentR2 * 100).toFixed(0)}%`);
  if (Math.abs(currentZScore) > ENGINE_CONFIG.ZSCORE_EXTREME) patterns.push(`ZSCORE:${currentZScore.toFixed(1)}`);
  const pattern = patterns.length > 0 ? patterns.join(" + ") : null;

  const logicParts: string[] = [];
  logicParts.push(`Grade:${grade}`);
  if (htf.direction !== 0) logicParts.push(`MTF:${htf.direction > 0 ? "↑" : "↓"}(${mtfAligned ? "✓" : "✗"})`);
  if (htf.htf15m.direction !== 0) logicParts.push(`15m:${htf.htf15m.direction > 0 ? "↑" : "↓"}`);
  if (institutionalDirection !== 0) logicParts.push(`EMA50:${institutionalDirection > 0 ? "↑" : "↓"}`);
  if (trendConfirmed) logicParts.push(`Trend:${trendUp ? "↑" : "↓"}`);
  else logicParts.push("Trend:⚠️");
  logicParts.push(`Zone:${zone.position}`);
  logicParts.push(`RSI:${currentRSI.toFixed(0)}`);
  logicParts.push(`Stoch:${safeNum(stoch.k[last]).toFixed(0)}(${stochZone.signal})`);
  logicParts.push(`${layersPassed}/${layers.length} layers`);
  if (currentR2 > ENGINE_CONFIG.R2_DEVIATION_THRESHOLD) logicParts.push(`R²:${(currentR2 * 100).toFixed(0)}%`);
  if (isNoisyMarket) logicParts.push(`Vol:${volState}`);
  if (smc.description) logicParts.push(`SMC:${smc.description}`);
  logicParts.push(expectancy > 0 ? `E+:${(expectancy * 100).toFixed(1)}%` : `E-:${(expectancy * 100).toFixed(1)}%`);
  const logic = logicParts.join(" | ");

  const details = [
    `[${grade}] EMA${emaCrossed ? " CROSS" : ""}: ${emaDiff > 0 ? "↑" : "↓"} (gap:${trendStrengthRaw.toFixed(1)})`,
    `RSI:${currentRSI.toFixed(1)}(${rsiSignal})`,
    `MACD:${macdCrossSignal}`,
    `BB:${zone.position}(${(currentPercentB * 100).toFixed(0)}%)`,
    `Stoch:${stochZone.signal}(K:${safeNum(stoch.k[last]).toFixed(0)})`,
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
      ema9: ema9Last,
      ema21: ema21Last,
      ema50: ema50Last,
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
      stoch_k: safeNum(stoch.k[last]),
      stoch_d: safeNum(stoch.d[last]),
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
      std_dev: currentStdDev,
      lin_reg_slope: currentLinRegSlope,
      lin_reg_r2: currentR2,
      lin_reg_deviation: currentLinRegDev,
      z_score: currentZScore,
      quant_score: quantScore,
    },
  };
}

// ─── Signal Generator v5.4 — Adaptive Window ────────────────

export type SignalCallback = (signal: SignalCandidate) => void;

export class SignalGenerator {
  private worker: Worker | null = null;
  private fallbackTimerId: ReturnType<typeof setInterval> | null = null;
  private callbacks: SignalCallback[] = [];
  private activeSymbols: string[] = [];
  private running = false;
  private lastEmitTime = 0;
  private recentGrades: string[] = [];
  private consecutiveLosses = 0;

  // Adaptive window state
  private bestCandidate: SignalCandidate | null = null;
  private windowOpenedAt = 0;
  private scanCount = 0;

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
        if (!history?.prices || history.prices.length < ENGINE_CONFIG.MIN_PRICES) return null;

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
      console.log("[v5.4] No symbols with sufficient data this scan");
      return null;
    }

    // Emission gate: A and B grades only
    const qualityCandidates = candidates.filter(c => c.grade === "A" || c.grade === "B");

    // v5.4 FIX: After 3+ consecutive losses, STRICTLY require A-grade only
    // (no fallback to B-grade — this is a protective filter)
    const minGrade = this.consecutiveLosses >= ENGINE_CONFIG.LOSS_STREAK_A_ONLY ? "A" : "B";
    const finalCandidates = minGrade === "A"
      ? qualityCandidates.filter(c => c.grade === "A")
      : qualityCandidates;

    if (finalCandidates.length === 0) {
      const aCount = candidates.filter(c => c.grade === "A").length;
      const bCount = candidates.filter(c => c.grade === "B").length;
      const cCount = candidates.filter(c => c.grade === "C").length;
      console.log(
        `[v5.4] Scan: ${candidates.length} candidates: ${aCount}A/${bCount}B/${cCount}C | ` +
        `Min grade: ${minGrade} | Losses: ${this.consecutiveLosses} — no quality signal`
      );
      return null;
    }

    // Quality-first sorting: Grade > Expectancy > Confidence
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
      `[v5.4] Scan #${this.scanCount}: ${candidates.length} candidates: ${aCount}A/${bCount}B/${cCount}C | ` +
      `Best: ${SYMBOLS[best.symbol] || best.symbol} ${best.type} [${best.grade}] ` +
      `score:${best.score} conf:${best.confidence}% ` +
      `MTF:${best.metrics.mtf_aligned ? "✓" : "✗"} ` +
      `E:${(best.metrics.expectancy * 100).toFixed(1)}%`
    );

    return best;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.bestCandidate = null;
    this.windowOpenedAt = 0;
    this.scanCount = 0;

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
      this.worker.postMessage({ type: "start", interval: ENGINE_CONFIG.SCAN_INTERVAL_MS });
      console.log(`[v5.4] Signal Engine Started — Adaptive Window (3-5 min) | Scan every 30s`);
    } catch (err) {
      console.warn("[v5.4] Web Worker unavailable, using setInterval:", err);
      this.fallbackTimerId = setInterval(() => this.tick(), ENGINE_CONFIG.SCAN_INTERVAL_MS);
    }

    console.log(`[v5.4] Layers: MTF(15m+5m) → Trend → Zone → Stoch → Momentum → RSI → Pattern → SMC → Slope → Quant`);
    console.log(`[v5.4] Window: 0-3min COOLDOWN → 3-5min SCAN (A=instant emit, B=hold→deadline)`);
    console.log(`[v5.4] Filters: Hard Gates + Noise Gate + RSI Chop + MTF Conflict + Quant R² + Loss Streak`);
  }

  stop() {
    this.running = false;
    if (this.worker) {
      this.worker.postMessage({ type: "stop" });
      this.worker.terminate();
      this.worker = null;
    }
    if (this.fallbackTimerId) {
      clearInterval(this.fallbackTimerId);
      this.fallbackTimerId = null;
    }
    this.bestCandidate = null;
    this.windowOpenedAt = 0;
    console.log(`[v5.4] Signal Engine Stopped`);
  }

  private async tick() {
    if (!this.running) return;

    const now = Date.now();
    const elapsed = now - this.lastEmitTime;

    // ── COOLDOWN PHASE (0–3 min) ──
    if (elapsed < ENGINE_CONFIG.WINDOW_OPEN_MS) {
      const remaining = Math.round((ENGINE_CONFIG.WINDOW_OPEN_MS - elapsed) / 1000);
      console.log(`[v5.4] Cooldown: ${remaining}s until observation window opens`);
      return;
    }

    // ── OBSERVATION WINDOW (3–5 min) ──
    if (this.windowOpenedAt === 0) {
      this.windowOpenedAt = now;
      this.bestCandidate = null;
      this.scanCount = 0;
      console.log(`[v5.4] ═══ Observation window OPENED ═══`);
    }

    this.scanCount++;
    const windowElapsed = now - this.windowOpenedAt;
    const isDeadline = elapsed >= ENGINE_CONFIG.WINDOW_CLOSE_MS;

    try {
      const candidate = await this.generateSignal();

      if (candidate) {
        const isBetter = !this.bestCandidate || this.isBetterSignal(candidate, this.bestCandidate);
        if (isBetter) {
          const prev = this.bestCandidate;
          this.bestCandidate = candidate;
          console.log(
            `[v5.4] New best: ${SYMBOLS[candidate.symbol] || candidate.symbol} ` +
            `${candidate.type} [${candidate.grade}] score:${candidate.score}` +
            (prev ? ` (replaced ${prev.grade}:${prev.score})` : ` (first candidate)`)
          );
        }

        // A-grade = instant emit
        if (candidate.grade === "A" && isBetter) {
          console.log(
            `[v5.4] ⚡ A-GRADE INSTANT EMIT at ${Math.round(elapsed / 1000)}s — ` +
            `${SYMBOLS[candidate.symbol] || candidate.symbol} ${candidate.type} score:${candidate.score}`
          );
          this.emitSignal(this.bestCandidate!);
          return;
        }
      }

      // ── DEADLINE: emit best collected so far ──
      if (isDeadline) {
        if (this.bestCandidate) {
          console.log(
            `[v5.4] ⏰ DEADLINE EMIT after ${this.scanCount} scans (${Math.round(windowElapsed / 1000)}s window) — ` +
            `${SYMBOLS[this.bestCandidate.symbol] || this.bestCandidate.symbol} ` +
            `${this.bestCandidate.type} [${this.bestCandidate.grade}] score:${this.bestCandidate.score}`
          );
          this.emitSignal(this.bestCandidate);
        } else {
          console.log(
            `[v5.4] ⏰ DEADLINE — no quality signal after ${this.scanCount} scans — SKIPPING CYCLE`
          );
          this.bestCandidate = null;
          this.windowOpenedAt = 0;
          this.scanCount = 0;
          this.lastEmitTime = now;
        }
      } else {
        const timeLeft = Math.round((ENGINE_CONFIG.WINDOW_CLOSE_MS - elapsed) / 1000);
        console.log(
          `[v5.4] Window scan #${this.scanCount} complete — ` +
          `best: ${this.bestCandidate ? `${this.bestCandidate.grade}:${this.bestCandidate.score}` : "none"} | ` +
          `${timeLeft}s to deadline`
        );
      }
    } catch (err) {
      console.error("[v5.4] Scan error:", err);
    }
  }

  private emitSignal(signal: SignalCandidate) {
    this.lastEmitTime = Date.now();
    this.bestCandidate = null;
    this.windowOpenedAt = 0;
    this.scanCount = 0;

    this.recentGrades.push(signal.grade);
    if (this.recentGrades.length > 20) this.recentGrades.shift();

    this.callbacks.forEach((cb) => cb(signal));
  }

  /** Compare two candidates: returns true if `a` is strictly better than `b` */
  private isBetterSignal(a: SignalCandidate, b: SignalCandidate): boolean {
    const gradeOrder = { A: 3, B: 2, C: 1 };
    if (gradeOrder[a.grade] !== gradeOrder[b.grade]) {
      return gradeOrder[a.grade] > gradeOrder[b.grade];
    }
    if (Math.abs(a.metrics.expectancy - b.metrics.expectancy) > 0.01) {
      return a.metrics.expectancy > b.metrics.expectancy;
    }
    return a.score > b.score;
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
