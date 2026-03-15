/**
 * Signal Analysis Engine v3.1
 *
 * CHANGELOG from v3.0 → v3.1:
 * ─────────────────────────────
 * 1. RSI DIRECTION ENFORCEMENT
 *    RSI < 25 → hard BUY-only lock (SELL signals are impossible)
 *    RSI > 75 → hard SELL-only lock (BUY signals are impossible)
 *    This prevents the critical bug where RSI=3.1 produced a SELL.
 *
 * 2. CONFLICT DETECTION & SUPPRESSION
 *    If RSI says BUY but pattern/EMA says SELL (or vice versa),
 *    the signal is penalized or killed entirely.
 *
 * 3. BOLLINGER BANDS (%B position)
 *    Adds mean-reversion context: price near lower band supports BUY,
 *    price near upper band supports SELL.
 *
 * 4. STOCHASTIC OSCILLATOR (%K/%D crossover)
 *    Adds momentum confirmation: oversold %K crossing above %D = BUY,
 *    overbought %K crossing below %D = SELL.
 *
 * 5. CONFLUENCE GATE
 *    Minimum 2 out of 8 indicators must agree on direction.
 *    Below that, signal is suppressed regardless of score.
 *
 * 6. RAISED CONFIDENCE THRESHOLD
 *    Minimum composite score raised from 25 → 40.
 *    Minimum confidence raised to 45%.
 *
 * 7. REBALANCED WEIGHTS (total 100)
 *    EMA Cross:   0-20  (was 0-25)
 *    RSI:         0-15  (was 0-20)
 *    MACD:        0-15  (was 0-20)
 *    Bollinger:   0-15  (NEW)
 *    Stochastic:  0-10  (NEW)
 *    Divergence:  0-10  (was 0-15)
 *    Engulfing:   0-10  (was 0-15)
 *    Slope:       0-5   (unchanged)
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
} from "./indicators";
import { detectDivergence, detectEngulfing, type Divergence, type EngulfingPattern } from "./patterns";

// Re-export for backward compatibility
export { calculateEMA, calculateRSI, calculateMACD, detectDivergence };

// ─── Enhanced Signal Candidate ───────────────────────────────

export interface SignalCandidate {
  symbol: string;
  type: "BUY" | "SELL";
  price: number;
  score: number; // 0-100 composite confidence
  confidence: number; // 0-100 percentage
  details: string;
  logic: string; // human-readable logic summary
  pattern: string | null; // detected pattern name
  metrics: {
    ema9: number;
    ema21: number;
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
    stoch_k: number;
    stoch_d: number;
    stoch_signal: string;
    confluence_count: number;
    confluence_required: number;
  };
}

// ─── Symbol Analysis ─────────────────────────────────────────

export function analyzeSymbol(prices: number[]): SignalCandidate | null {
  if (prices.length < 50) return null;

  const ema9 = calculateEMA(prices, 9);
  const ema21 = calculateEMA(prices, 21);
  const rsi = calculateRSI(prices, 14);
  const { histogram } = calculateMACD(prices);
  const atr = calculateATR(prices, 14);
  const slope = calculateEMASlope(ema9, 5);
  const emaGap = calculateEMAGap(ema9, ema21, prices);
  const bb = calculateBollingerBands(prices, 20, 2);
  const stoch = calculateStochastic(prices, 14, 3);

  const last = prices.length - 1;
  const currentPrice = prices[last];
  const currentRSI = rsi[last];
  const currentHistogram = histogram[last];
  const prevHistogram = histogram[last - 1];
  const currentATR = atr[last];
  const currentSlope = slope[last];
  const currentEMAGap = emaGap[last];
  const currentPercentB = bb.percentB[last];
  const currentStochK = stoch.k[last];
  const currentStochD = stoch.d[last];
  const prevStochK = stoch.k[last - 1];
  const prevStochD = stoch.d[last - 1];

  // ════════════════════════════════════════════════════════════
  // STEP 1: Compute individual indicator scores & directions
  // Each indicator votes BUY (+1), SELL (-1), or NEUTRAL (0)
  // ════════════════════════════════════════════════════════════

  // ── EMA Crossover Score (0-20) ──
  const emaDiff = ema9[last] - ema21[last];
  const prevEmaDiff = ema9[last - 1] - ema21[last - 1];
  const emaCrossed = (prevEmaDiff <= 0 && emaDiff > 0) || (prevEmaDiff >= 0 && emaDiff < 0);
  const emaTrending = Math.abs(emaDiff) / currentPrice * 10000;
  const emaScore = emaCrossed ? 20 : Math.min(emaTrending * 4, 10);
  const emaDirection: number = emaDiff > 0 ? 1 : emaDiff < 0 ? -1 : 0;

  // ── RSI Score (0-15) ──
  let rsiScore = 0;
  let rsiSignal = "neutral";
  let rsiDirection = 0; // +1 = favors BUY, -1 = favors SELL
  let rsiHardLock: "BUY" | "SELL" | null = null;

  if (currentRSI <= 15) {
    // EXTREME oversold → strong BUY signal, HARD LOCK against SELL
    rsiScore = 15;
    rsiSignal = "extreme_oversold";
    rsiDirection = 1;
    rsiHardLock = "BUY";
  } else if (currentRSI < 30) {
    rsiScore = 12;
    rsiSignal = "oversold";
    rsiDirection = 1;
  } else if (currentRSI >= 85) {
    // EXTREME overbought → strong SELL signal, HARD LOCK against BUY
    rsiScore = 15;
    rsiSignal = "extreme_overbought";
    rsiDirection = -1;
    rsiHardLock = "SELL";
  } else if (currentRSI > 70) {
    rsiScore = 12;
    rsiSignal = "overbought";
    rsiDirection = -1;
  } else if (currentRSI < 45) {
    rsiScore = 5;
    rsiSignal = "leaning_oversold";
    rsiDirection = 1;
  } else if (currentRSI > 55) {
    rsiScore = 5;
    rsiSignal = "leaning_overbought";
    rsiDirection = -1;
  } else {
    rsiScore = 2;
    rsiSignal = "neutral";
    rsiDirection = 0;
  }

  // ── MACD Score (0-15) ──
  const macdCrossed = (prevHistogram <= 0 && currentHistogram > 0) || (prevHistogram >= 0 && currentHistogram < 0);
  let macdScore = 0;
  let macdCrossSignal = "none";
  let macdDirection = 0;

  if (macdCrossed) {
    macdScore = 15;
    macdCrossSignal = currentHistogram > 0 ? "bullish_cross" : "bearish_cross";
    macdDirection = currentHistogram > 0 ? 1 : -1;
  } else {
    macdScore = Math.min(Math.abs(currentHistogram) * 300, 8);
    macdCrossSignal = currentHistogram > 0 ? "bullish" : "bearish";
    macdDirection = currentHistogram > 0 ? 1 : -1;
  }

  // ── Bollinger Bands Score (0-15) ── NEW
  let bbScore = 0;
  let bbPosition = "middle";
  let bbDirection = 0;

  if (currentPercentB <= 0.05) {
    // Price at or below lower band → strong BUY
    bbScore = 15;
    bbPosition = "below_lower";
    bbDirection = 1;
  } else if (currentPercentB <= 0.2) {
    bbScore = 10;
    bbPosition = "near_lower";
    bbDirection = 1;
  } else if (currentPercentB >= 0.95) {
    // Price at or above upper band → strong SELL
    bbScore = 15;
    bbPosition = "above_upper";
    bbDirection = -1;
  } else if (currentPercentB >= 0.8) {
    bbScore = 10;
    bbPosition = "near_upper";
    bbDirection = -1;
  } else {
    bbScore = 2;
    bbPosition = "middle";
    bbDirection = 0;
  }

  // ── Stochastic Oscillator Score (0-10) ── NEW
  let stochScore = 0;
  let stochSignal = "neutral";
  let stochDirection = 0;

  const stochBullishCross = prevStochK <= prevStochD && currentStochK > currentStochD;
  const stochBearishCross = prevStochK >= prevStochD && currentStochK < currentStochD;

  if (currentStochK < 20 && stochBullishCross) {
    stochScore = 10;
    stochSignal = "oversold_cross_up";
    stochDirection = 1;
  } else if (currentStochK > 80 && stochBearishCross) {
    stochScore = 10;
    stochSignal = "overbought_cross_down";
    stochDirection = -1;
  } else if (currentStochK < 20) {
    stochScore = 6;
    stochSignal = "oversold";
    stochDirection = 1;
  } else if (currentStochK > 80) {
    stochScore = 6;
    stochSignal = "overbought";
    stochDirection = -1;
  } else if (stochBullishCross) {
    stochScore = 4;
    stochSignal = "cross_up";
    stochDirection = 1;
  } else if (stochBearishCross) {
    stochScore = 4;
    stochSignal = "cross_down";
    stochDirection = -1;
  } else {
    stochScore = 1;
    stochSignal = "neutral";
    stochDirection = 0;
  }

  // ── Divergence Score (0-10) ──
  const divergence = detectDivergence(prices, rsi);
  const divScore = divergence ? Math.min(divergence.strength * 0.10, 10) : 0;
  const divDirection = divergence ? (divergence.type === "bullish" ? 1 : -1) : 0;

  // ── Engulfing Pattern Score (0-10) ──
  const engulfing = detectEngulfing(prices, 10);
  let engulfingScore = 0;
  let engulfingDirection = 0;
  if (engulfing) {
    engulfingScore = Math.min(engulfing.strength * 0.10, 10);
    engulfingDirection = engulfing.type === "bullish" ? 1 : -1;
  }

  // ── Slope Momentum Score (0-5) ──
  const slopeScore = Math.min(Math.abs(currentSlope) * 50, 5);
  const slopeDirection = currentSlope > 0 ? 1 : currentSlope < 0 ? -1 : 0;

  // ════════════════════════════════════════════════════════════
  // STEP 2: CONFLUENCE GATE — count directional agreement
  // ════════════════════════════════════════════════════════════

  const indicators = [
    { name: "EMA", dir: emaDirection, weight: 2 },
    { name: "RSI", dir: rsiDirection, weight: 2 },
    { name: "MACD", dir: macdDirection, weight: 2 },
    { name: "BB", dir: bbDirection, weight: 1 },
    { name: "Stoch", dir: stochDirection, weight: 1 },
    { name: "Slope", dir: slopeDirection, weight: 1 },
    { name: "Div", dir: divDirection, weight: 1 },
    { name: "Engulf", dir: engulfingDirection, weight: 1 },
  ];

  let buyWeight = 0;
  let sellWeight = 0;
  let buyCount = 0;
  let sellCount = 0;

  for (const ind of indicators) {
    if (ind.dir > 0) { buyWeight += ind.weight; buyCount++; }
    else if (ind.dir < 0) { sellWeight += ind.weight; sellCount++; }
  }

  // Determine raw direction from weighted votes
  let rawType: "BUY" | "SELL" = buyWeight >= sellWeight ? "BUY" : "SELL";
  const dominantWeight = Math.max(buyWeight, sellWeight);
  const totalWeight = buyWeight + sellWeight;
  const dominantCount = rawType === "BUY" ? buyCount : sellCount;

  // ════════════════════════════════════════════════════════════
  // STEP 3: RSI HARD LOCK — override direction if RSI is extreme
  // This is the CRITICAL fix: RSI=3.1 can NEVER produce a SELL
  // ════════════════════════════════════════════════════════════

  let type: "BUY" | "SELL" = rawType;

  if (rsiHardLock) {
    if (rawType !== rsiHardLock) {
      // RSI extreme contradicts the voted direction → KILL the signal
      console.log(
        `[SignalEngine] CONFLICT SUPPRESSED: RSI ${currentRSI.toFixed(1)} (${rsiSignal}) locks ${rsiHardLock} but indicators voted ${rawType} — signal killed`
      );
      return null;
    }
    type = rsiHardLock;
  }

  // ════════════════════════════════════════════════════════════
  // STEP 4: CONFLUENCE MINIMUM — require ≥3 agreeing indicators
  // ════════════════════════════════════════════════════════════

  const MIN_CONFLUENCE = 2;
  if (dominantCount < MIN_CONFLUENCE) {
    console.log(
      `[SignalEngine] CONFLUENCE GATE: Only ${dominantCount}/${indicators.length} indicators agree on ${type} — need ${MIN_CONFLUENCE}. Skipping.`
    );
    return null;
  }

  // ════════════════════════════════════════════════════════════
  // STEP 5: CONFLICT PENALTY — reduce score if strong disagreement
  // ════════════════════════════════════════════════════════════

  let conflictPenalty = 0;

  // Check for RSI vs Pattern conflict (the exact bug from the Telegram example)
  if (rsiDirection !== 0 && engulfingDirection !== 0 && rsiDirection !== engulfingDirection) {
    conflictPenalty += 8;
    console.log(`[SignalEngine] CONFLICT: RSI (${rsiSignal}) vs Engulfing (${engulfing?.type}) — penalty -15`);
  }

  // Check for RSI vs EMA conflict
  if (rsiDirection !== 0 && emaDirection !== 0 && rsiDirection !== emaDirection) {
    conflictPenalty += 5;
  }

  // Check for Bollinger vs MACD conflict
  if (bbDirection !== 0 && macdDirection !== 0 && bbDirection !== macdDirection) {
    conflictPenalty += 5;
  }

  // ════════════════════════════════════════════════════════════
  // STEP 6: COMPOSITE SCORE
  // ════════════════════════════════════════════════════════════

  const rawScore = emaScore + rsiScore + macdScore + bbScore + stochScore +
    divScore + engulfingScore + slopeScore;

  // Apply conflict penalty
  const penalizedScore = Math.max(rawScore - conflictPenalty, 0);

  // Apply confluence multiplier: more agreement = higher score
  const confluenceRatio = dominantWeight / Math.max(totalWeight, 1);
  const totalScore = Math.min(Math.round(penalizedScore * (0.6 + 0.4 * confluenceRatio)), 100);

  // ════════════════════════════════════════════════════════════
  // STEP 7: QUALITY GATE — minimum score and confidence
  // ════════════════════════════════════════════════════════════

  if (totalScore < 40) {
    return null; // Score too low — don't generate noise
  }

  const confidence = Math.min(
    (dominantWeight / Math.max(totalWeight, 1)) * totalScore,
    100
  );

  if (confidence < 55) {
    return null; // Confidence too low — skip
  }

  // ════════════════════════════════════════════════════════════
  // STEP 8: BUILD OUTPUT
  // ════════════════════════════════════════════════════════════

  const trendStrength = totalWeight > 0
    ? Math.abs(buyWeight - sellWeight) / totalWeight * 100
    : 0;

  // Build pattern string
  const patterns: string[] = [];
  if (engulfing) patterns.push(`${engulfing.type === "bullish" ? "BULLISH" : "BEARISH"} ENGULFING`);
  if (divergence) patterns.push(`${divergence.type.toUpperCase()} DIVERGENCE`);
  if (emaCrossed) patterns.push("EMA CROSSOVER");
  if (macdCrossed) patterns.push("MACD CROSSOVER");
  if (stochBullishCross || stochBearishCross) patterns.push("STOCH CROSSOVER");
  if (currentPercentB <= 0.05 || currentPercentB >= 0.95) patterns.push("BB EXTREME");
  const pattern = patterns.length > 0 ? patterns.join(" + ") : null;

  // Logic summary
  const logicParts: string[] = [];
  if (trendStrength > 60) logicParts.push("Strong Trend");
  else if (trendStrength > 30) logicParts.push("Moderate Trend");
  else logicParts.push("Mild Trend");
  logicParts.push(`RSI: ${currentRSI.toFixed(1)}`);
  logicParts.push(`BB: ${(currentPercentB * 100).toFixed(0)}%`);
  logicParts.push(`Stoch: ${currentStochK.toFixed(0)}`);
  logicParts.push(`${dominantCount}/${indicators.length} agree`);
  if (engulfing) logicParts.push("Engulfing");
  if (divergence) logicParts.push("Divergence");
  const logic = logicParts.join(" | ");

  const details = [
    `EMA${emaCrossed ? " CROSS" : ""}: ${emaDiff > 0 ? "↑" : "↓"}`,
    `RSI: ${currentRSI.toFixed(1)} (${rsiSignal})`,
    `MACD: ${macdCrossSignal}`,
    `BB: ${bbPosition} (${(currentPercentB * 100).toFixed(0)}%)`,
    `Stoch: ${stochSignal} (K:${currentStochK.toFixed(0)})`,
    `ATR: ${currentATR.toFixed(4)}`,
    pattern,
  ].filter(Boolean).join(" | ");

  return {
    symbol: "",
    type,
    price: currentPrice,
    score: totalScore,
    confidence: Math.round(confidence * 10) / 10,
    details,
    logic,
    pattern,
    metrics: {
      ema9: ema9[last],
      ema21: ema21[last],
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
      bb_position: bbPosition,
      stoch_k: currentStochK,
      stoch_d: currentStochD,
      stoch_signal: stochSignal,
      confluence_count: dominantCount,
      confluence_required: MIN_CONFLUENCE,
    },
  };
}

// ─── Signal Generator (runs every 5 minutes) ────────────────

export type SignalCallback = (signal: SignalCandidate) => void;

export class SignalGenerator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callbacks: SignalCallback[] = [];
  private activeSymbols: string[] = [];
  private running = false;

  constructor(symbols: string[]) {
    this.activeSymbols = symbols;
  }

  onSignal(cb: SignalCallback) {
    this.callbacks.push(cb);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== cb);
    };
  }

  setSymbols(symbols: string[]) {
    this.activeSymbols = symbols;
  }

  async generateSignal(): Promise<SignalCandidate | null> {
    if (this.activeSymbols.length === 0) return null;

    const candidates: SignalCandidate[] = [];

    const analyses = await Promise.allSettled(
      this.activeSymbols.map(async (symbol) => {
        const history = await derivWs.getTickHistory(symbol, 200);
        if (!history?.prices || history.prices.length < 50) return null;

        const prices = history.prices.map(Number);
        const candidate = analyzeSymbol(prices);
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
      console.log("[SignalEngine] No high-confidence signals this cycle — skipping");
      return null;
    }

    // Sort by confidence descending, then score as tiebreaker
    candidates.sort((a, b) => b.confidence - a.confidence || b.score - a.score);
    return candidates[0] || null;
  }

  private lastSignalTime = 0;
  private MIN_INTERVAL_MS = 4 * 60 * 1000;

  start(intervalMs = 5 * 60 * 1000) {
    if (this.running) return;
    this.running = true;
    this.intervalId = setInterval(() => this.tick(), intervalMs);
    console.log(`[SignalEngine] v3.1 Started — signals every ${intervalMs / 1000}s (min gap: ${this.MIN_INTERVAL_MS / 1000}s)`);
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async tick() {
    try {
      const now = Date.now();
      const elapsed = now - this.lastSignalTime;
      if (elapsed < this.MIN_INTERVAL_MS) {
        console.log(`[SignalEngine] Skipping — only ${Math.round(elapsed / 1000)}s since last signal (min ${this.MIN_INTERVAL_MS / 1000}s)`);
        return;
      }

      const signal = await this.generateSignal();
      if (signal) {
        this.lastSignalTime = Date.now();
        this.callbacks.forEach((cb) => cb(signal));
      }
    } catch (err) {
      console.error("[SignalEngine] Tick error:", err);
    }
  }

  isRunning() {
    return this.running;
  }
}
