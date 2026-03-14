/**
 * Signal Analysis Engine
 * 
 * Generates trading signals using multiple technical indicators:
 * - EMA crossovers (9/21)
 * - RSI (14-period) with overbought/oversold detection
 * - MACD (12/26/9) with signal line crossovers
 * - Price-RSI divergence detection (bullish/bearish)
 * 
 * Produces one signal every ~5 minutes by scoring all active symbols
 * and selecting the strongest opportunity.
 */

import { derivWs, type TickData } from "./derivWebSocket";
import { SYMBOLS } from "@/types/engine";
import * as api from "./api";

// ─── Technical Indicators ────────────────────────────────────

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

export function calculateMACD(prices: number[]): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = prices.map((_, i) => ema12[i] - ema26[i]);
  const signal = calculateEMA(macd.slice(26), 9);
  // Pad signal to match length
  const paddedSignal = new Array(26).fill(0).concat(signal);
  const histogram = macd.map((v, i) => v - (paddedSignal[i] || 0));
  return { macd, signal: paddedSignal, histogram };
}

// ─── Divergence Detection ────────────────────────────────────

interface Divergence {
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

  // Bullish divergence: price makes lower low, RSI makes higher low
  if (priceSwings.lows.length >= 2 && rsiSwings.lows.length >= 2) {
    const [prevPriceLow, currPriceLow] = priceSwings.lows.slice(-2);
    const [prevRSILow, currRSILow] = rsiSwings.lows.slice(-2);

    if (
      recentPrices[currPriceLow] < recentPrices[prevPriceLow] &&
      recentRSI[currRSILow] > recentRSI[prevRSILow]
    ) {
      const strength = Math.min(
        Math.abs(recentRSI[currRSILow] - recentRSI[prevRSILow]) * 2,
        100
      );
      return {
        type: "bullish",
        strength,
        description: `Bullish divergence: Price lower low but RSI higher low (strength: ${strength.toFixed(0)})`,
      };
    }
  }

  // Bearish divergence: price makes higher high, RSI makes lower high
  if (priceSwings.highs.length >= 2 && rsiSwings.highs.length >= 2) {
    const [prevPriceHigh, currPriceHigh] = priceSwings.highs.slice(-2);
    const [prevRSIHigh, currRSIHigh] = rsiSwings.highs.slice(-2);

    if (
      recentPrices[currPriceHigh] > recentPrices[prevPriceHigh] &&
      recentRSI[currRSIHigh] < recentRSI[prevRSIHigh]
    ) {
      const strength = Math.min(
        Math.abs(recentRSI[prevRSIHigh] - recentRSI[currRSIHigh]) * 2,
        100
      );
      return {
        type: "bearish",
        strength,
        description: `Bearish divergence: Price higher high but RSI lower high (strength: ${strength.toFixed(0)})`,
      };
    }
  }

  return null;
}

// ─── Signal Scoring ──────────────────────────────────────────

export interface SignalCandidate {
  symbol: string;
  type: "BUY" | "SELL";
  price: number;
  score: number; // 0-100 composite score
  details: string;
  metrics: {
    ema_cross: number;
    rsi: number;
    rsi_signal: string;
    macd_histogram: number;
    macd_cross: string;
    divergence: string | null;
    divergence_strength: number;
    trend_strength: number;
  };
}

export function analyzeSymbol(prices: number[]): SignalCandidate | null {
  if (prices.length < 50) return null;

  const ema9 = calculateEMA(prices, 9);
  const ema21 = calculateEMA(prices, 21);
  const rsi = calculateRSI(prices, 14);
  const { macd, signal: macdSignal, histogram } = calculateMACD(prices);

  const last = prices.length - 1;
  const currentPrice = prices[last];
  const currentRSI = rsi[last];
  const currentHistogram = histogram[last];
  const prevHistogram = histogram[last - 1];

  // ── EMA Crossover Score (0-30) ──
  const emaDiff = ema9[last] - ema21[last];
  const prevEmaDiff = ema9[last - 1] - ema21[last - 1];
  const emaCrossed = (prevEmaDiff <= 0 && emaDiff > 0) || (prevEmaDiff >= 0 && emaDiff < 0);
  const emaTrending = Math.abs(emaDiff) / currentPrice * 10000; // Normalize
  const emaScore = emaCrossed ? 30 : Math.min(emaTrending * 5, 15);

  // ── RSI Score (0-25) ──
  let rsiScore = 0;
  let rsiSignal = "neutral";
  if (currentRSI < 30) { rsiScore = 25; rsiSignal = "oversold"; }
  else if (currentRSI > 70) { rsiScore = 25; rsiSignal = "overbought"; }
  else if (currentRSI < 40) { rsiScore = 15; rsiSignal = "approaching_oversold"; }
  else if (currentRSI > 60) { rsiScore = 15; rsiSignal = "approaching_overbought"; }
  else { rsiScore = 5; rsiSignal = "neutral"; }

  // ── MACD Score (0-25) ──
  const macdCrossed = (prevHistogram <= 0 && currentHistogram > 0) || (prevHistogram >= 0 && currentHistogram < 0);
  let macdScore = 0;
  let macdCrossSignal = "none";
  if (macdCrossed) {
    macdScore = 25;
    macdCrossSignal = currentHistogram > 0 ? "bullish_cross" : "bearish_cross";
  } else {
    macdScore = Math.min(Math.abs(currentHistogram) * 500, 12);
    macdCrossSignal = currentHistogram > 0 ? "bullish" : "bearish";
  }

  // ── Divergence Score (0-20) ──
  const divergence = detectDivergence(prices, rsi);
  const divScore = divergence ? Math.min(divergence.strength * 0.2, 20) : 0;

  // ── Determine direction ──
  let buySignals = 0;
  let sellSignals = 0;

  if (emaDiff > 0) buySignals++; else sellSignals++;
  if (currentRSI < 45) buySignals++; else if (currentRSI > 55) sellSignals++;
  if (currentHistogram > 0) buySignals++; else sellSignals++;
  if (divergence?.type === "bullish") buySignals += 2;
  if (divergence?.type === "bearish") sellSignals += 2;

  const type: "BUY" | "SELL" = buySignals >= sellSignals ? "BUY" : "SELL";
  const totalScore = Math.min(emaScore + rsiScore + macdScore + divScore, 100);

  // Only generate if score ≥ 25 (at least some indicators agree)
  if (totalScore < 25) return null;

  const trendStrength = Math.abs(buySignals - sellSignals) / Math.max(buySignals + sellSignals, 1) * 100;

  const details = [
    `EMA${emaCrossed ? " CROSS" : ""}: ${emaDiff > 0 ? "↑" : "↓"}`,
    `RSI: ${currentRSI.toFixed(1)} (${rsiSignal})`,
    `MACD: ${macdCrossSignal}`,
    divergence ? divergence.description : null,
  ].filter(Boolean).join(" | ");

  return {
    symbol: "",
    type,
    price: currentPrice,
    score: Math.round(totalScore),
    details,
    metrics: {
      ema_cross: emaDiff,
      rsi: currentRSI,
      rsi_signal: rsiSignal,
      macd_histogram: currentHistogram,
      macd_cross: macdCrossSignal,
      divergence: divergence?.type || null,
      divergence_strength: divergence?.strength || 0,
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

    for (const symbol of this.activeSymbols) {
      try {
        const history = await derivWs.getTickHistory(symbol, 200);
        if (!history?.prices || history.prices.length < 50) continue;

        const prices = history.prices.map(Number);
        const candidate = analyzeSymbol(prices);
        if (candidate) {
          candidate.symbol = symbol;
          candidates.push(candidate);
        }
      } catch (err) {
        console.warn(`[SignalEngine] Failed to analyze ${symbol}:`, err);
      }
    }

    if (candidates.length === 0) {
      // Fallback: pick the best from whatever we have, even with lower score
      // We ALWAYS want a signal every 5 minutes
      for (const symbol of this.activeSymbols) {
        try {
          const history = await derivWs.getTickHistory(symbol, 100);
          if (!history?.prices || history.prices.length < 30) continue;
          const prices = history.prices.map(Number);
          const ema9 = calculateEMA(prices, 9);
          const ema21 = calculateEMA(prices, 21);
          const last = prices.length - 1;
          const emaDiff = ema9[last] - ema21[last];

          candidates.push({
            symbol,
            type: emaDiff > 0 ? "BUY" : "SELL",
            price: prices[last],
            score: 20,
            details: `Trend following: EMA ${emaDiff > 0 ? "↑ bullish" : "↓ bearish"} (low confidence)`,
            metrics: {
              ema_cross: emaDiff,
              rsi: 50,
              rsi_signal: "unknown",
              macd_histogram: 0,
              macd_cross: "none",
              divergence: null,
              divergence_strength: 0,
              trend_strength: 30,
            },
          });
          break; // Just need one fallback
        } catch {
          continue;
        }
      }
    }

    // Sort by score descending, pick the best
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  start(intervalMs = 5 * 60 * 1000) {
    if (this.running) return;
    this.running = true;

    // Generate immediately on start
    this.tick();

    this.intervalId = setInterval(() => this.tick(), intervalMs);
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
      const signal = await this.generateSignal();
      if (signal) {
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
