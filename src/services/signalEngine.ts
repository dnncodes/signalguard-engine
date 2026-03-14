/**
 * Signal Analysis Engine v3.0
 * 
 * Professional 5-minute scalping signal generator using:
 * - EMA crossovers (9/21) with slope momentum
 * - RSI (14-period) with overbought/oversold detection
 * - MACD (12/26/9) with signal line crossovers
 * - ATR (14-period) for volatility measurement
 * - Engulfing pattern detection (tick-based micro-candles)
 * - Price-RSI divergence detection (bullish/bearish)
 * 
 * Scores all active symbols every 5 minutes and selects 
 * the highest-confidence opportunity.
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

  const last = prices.length - 1;
  const currentPrice = prices[last];
  const currentRSI = rsi[last];
  const currentHistogram = histogram[last];
  const prevHistogram = histogram[last - 1];
  const currentATR = atr[last];
  const currentSlope = slope[last];
  const currentEMAGap = emaGap[last];

  // ── EMA Crossover Score (0-25) ──
  const emaDiff = ema9[last] - ema21[last];
  const prevEmaDiff = ema9[last - 1] - ema21[last - 1];
  const emaCrossed = (prevEmaDiff <= 0 && emaDiff > 0) || (prevEmaDiff >= 0 && emaDiff < 0);
  const emaTrending = Math.abs(emaDiff) / currentPrice * 10000;
  const emaScore = emaCrossed ? 25 : Math.min(emaTrending * 5, 12);

  // ── RSI Score (0-20) ──
  let rsiScore = 0;
  let rsiSignal = "neutral";
  if (currentRSI < 30) { rsiScore = 20; rsiSignal = "oversold"; }
  else if (currentRSI > 70) { rsiScore = 20; rsiSignal = "overbought"; }
  else if (currentRSI < 40) { rsiScore = 12; rsiSignal = "approaching_oversold"; }
  else if (currentRSI > 60) { rsiScore = 12; rsiSignal = "approaching_overbought"; }
  else { rsiScore = 3; rsiSignal = "neutral"; }

  // ── MACD Score (0-20) ──
  const macdCrossed = (prevHistogram <= 0 && currentHistogram > 0) || (prevHistogram >= 0 && currentHistogram < 0);
  let macdScore = 0;
  let macdCrossSignal = "none";
  if (macdCrossed) {
    macdScore = 20;
    macdCrossSignal = currentHistogram > 0 ? "bullish_cross" : "bearish_cross";
  } else {
    macdScore = Math.min(Math.abs(currentHistogram) * 400, 10);
    macdCrossSignal = currentHistogram > 0 ? "bullish" : "bearish";
  }

  // ── Divergence Score (0-15) ──
  const divergence = detectDivergence(prices, rsi);
  const divScore = divergence ? Math.min(divergence.strength * 0.15, 15) : 0;

  // ── Engulfing Pattern Score (0-15) ──
  const engulfing = detectEngulfing(prices, 10);
  let engulfingScore = 0;
  if (engulfing) {
    engulfingScore = Math.min(engulfing.strength * 0.15, 15);
  }

  // ── Slope Momentum Score (0-5) ──
  const slopeScore = Math.min(Math.abs(currentSlope) * 50, 5);

  // ── Determine direction ──
  let buySignals = 0;
  let sellSignals = 0;

  if (emaDiff > 0) buySignals += 2; else sellSignals += 2;
  if (currentRSI < 45) buySignals++; else if (currentRSI > 55) sellSignals++;
  if (currentHistogram > 0) buySignals += 2; else sellSignals += 2;
  if (currentSlope > 0) buySignals++; else sellSignals++;
  if (divergence?.type === "bullish") buySignals += 3;
  if (divergence?.type === "bearish") sellSignals += 3;
  if (engulfing?.type === "bullish") buySignals += 2;
  if (engulfing?.type === "bearish") sellSignals += 2;

  const type: "BUY" | "SELL" = buySignals >= sellSignals ? "BUY" : "SELL";
  const totalScore = Math.min(
    emaScore + rsiScore + macdScore + divScore + engulfingScore + slopeScore,
    100
  );

  // Only generate if score ≥ 25 for higher quality signals
  if (totalScore < 25) return null;

  const trendStrength = Math.abs(buySignals - sellSignals) / Math.max(buySignals + sellSignals, 1) * 100;

  // Calculate confidence as weighted agreement percentage
  const totalIndicators = buySignals + sellSignals;
  const dominantCount = Math.max(buySignals, sellSignals);
  const confidence = Math.min(
    (dominantCount / Math.max(totalIndicators, 1)) * totalScore,
    100
  );

  // Build pattern string
  const patterns: string[] = [];
  if (engulfing) patterns.push(`${engulfing.type === "bullish" ? "BULLISH" : "BEARISH"} ENGULFING`);
  if (divergence) patterns.push(`${divergence.type.toUpperCase()} DIVERGENCE`);
  if (emaCrossed) patterns.push("EMA CROSSOVER");
  if (macdCrossed) patterns.push("MACD CROSSOVER");
  const pattern = patterns.length > 0 ? patterns.join(" + ") : null;

  // Logic summary
  const logicParts: string[] = [];
  if (trendStrength > 60) logicParts.push("Strong Trend");
  else if (trendStrength > 30) logicParts.push("Moderate Trend");
  else logicParts.push("Weak Trend");
  logicParts.push(`RSI: ${currentRSI.toFixed(1)}`);
  if (engulfing) logicParts.push("Engulfing");
  if (divergence) logicParts.push("Divergence");
  const logic = logicParts.join(" | ");

  const details = [
    `EMA${emaCrossed ? " CROSS" : ""}: ${emaDiff > 0 ? "↑" : "↓"}`,
    `RSI: ${currentRSI.toFixed(1)} (${rsiSignal})`,
    `MACD: ${macdCrossSignal}`,
    `ATR: ${currentATR.toFixed(4)}`,
    pattern,
  ].filter(Boolean).join(" | ");

  return {
    symbol: "",
    type,
    price: currentPrice,
    score: Math.round(totalScore),
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

    // Analyze ALL symbols in parallel for speed
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
      // No candidates passed the threshold — skip this cycle entirely
      // Better to skip than send low-quality signals
      console.log("[SignalEngine] No high-confidence signals this cycle — skipping");
      return null;
    }

    // Sort by confidence descending, pick the best
    candidates.sort((a, b) => b.confidence - a.confidence || b.score - a.score);
    return candidates[0] || null;
  }

  private lastSignalTime = 0;
  private MIN_INTERVAL_MS = 4 * 60 * 1000; // Never fire signals less than 4 minutes apart

  start(intervalMs = 5 * 60 * 1000) {
    if (this.running) return;
    this.running = true;
    // Do NOT fire immediately — wait for the first full interval
    this.intervalId = setInterval(() => this.tick(), intervalMs);
    console.log(`[SignalEngine] Started — signals every ${intervalMs / 1000}s (min gap: ${this.MIN_INTERVAL_MS / 1000}s)`);
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
