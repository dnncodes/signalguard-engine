import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  type Signal,
  type MarketStatus,
  type BacktestResult,
  type BacktestTrade,
  type BacktestSymbolResult,
  type LiveAutomationStatus,
  type LiveTrade,
  type TestTradeResult,
  ApiError,
  SYMBOLS,
  TRADE_DURATION_LIVE,
  TRADE_DURATION_BACKTEST,
} from "@/types/engine";
import * as api from "@/services/api";
import { derivWs, type TickData, type ConnectionStatus } from "@/services/derivWebSocket";
import {
  SignalGenerator,
  type SignalCandidate,
  analyzeSymbol,
} from "@/services/signalEngine";
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
} from "@/services/indicators";
import { detectDivergence, detectEngulfing } from "@/services/patterns";

// ─── Error handler ───────────────────────────────────────────

function handleApiError(err: unknown, context: string): string {
  if (err instanceof ApiError) {
    if (err.code === "ABORT") return "";
    const msg = `${context}: ${err.message}`;
    toast.error(msg);
    return msg;
  }
  const msg = `${context}: ${err instanceof Error ? err.message : "Unknown error"}`;
  toast.error(msg);
  return msg;
}

// ─── useDerivConnection ─────────────────────────────────────

export function useDerivConnection() {
  const [status, setStatus] = useState<ConnectionStatus>(derivWs.getStatus());
  const [latestTicks, setLatestTicks] = useState<Map<string, TickData>>(new Map());
  const [prevTicks, setPrevTicks] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    derivWs.connect();
    const unsubStatus = derivWs.onStatusChange(setStatus);
    const unsubTick = derivWs.onTick((tick) => {
      setLatestTicks((prev) => {
        const existing = prev.get(tick.symbol);
        if (existing) {
          setPrevTicks((p) => {
            const next = new Map(p);
            next.set(tick.symbol, existing.quote);
            return next;
          });
        }
        const next = new Map(prev);
        next.set(tick.symbol, tick);
        return next;
      });
    });
    const unsubError = derivWs.onError((error) => {
      console.error("[DerivWS]", error);
    });
    return () => { unsubStatus(); unsubTick(); unsubError(); };
  }, []);

  const subscribeTo = useCallback((symbols: string[]) => {
    symbols.forEach((s) => derivWs.subscribeTicks(s));
  }, []);

  return { wsStatus: status, latestTicks, prevTicks, subscribeTo };
}

// ─── useSignals (Realtime + 5-minute signal generation) ─────
// Signal generator runs as a SINGLETON — survives page navigation.

let globalGeneratorInstance: SignalGenerator | null = null;
let globalGeneratorRefCount = 0;

export function useSignals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [marketStatus, setMarketStatus] = useState<MarketStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [engineRunning, setEngineRunning] = useState(globalGeneratorInstance?.isRunning() ?? false);
  const [timeframe, setTimeframe] = useState(15);
  const [trendDirections, setTrendDirections] = useState<Map<string, "up" | "down" | "neutral">>(new Map());
  const priceHistoryRef = useRef<Map<string, { price: number; time: number }[]>>(new Map());
  const { wsStatus, latestTicks, prevTicks, subscribeTo } = useDerivConnection();

  // Initial load
  useEffect(() => {
    const loadInitial = async () => {
      try {
        const [sigData, statusData] = await Promise.all([
          api.fetchSignals(),
          api.fetchMarketStatus(),
        ]);
        setSignals(sigData);
        setMarketStatus(statusData);
        setError(null);

        // Subscribe to all symbols
        const symbolKeys = Object.keys(SYMBOLS);
        subscribeTo(symbolKeys);
      } catch (err) {
        setError(handleApiError(err, "Initial data load failed"));
      } finally {
        setLoading(false);
      }
    };
    loadInitial();
  }, [subscribeTo]);

  // Start signal generator as singleton — persists across tab navigation
  useEffect(() => {
    if (wsStatus !== "connected") return;

    globalGeneratorRefCount++;

    if (!globalGeneratorInstance) {
      const generator = new SignalGenerator(Object.keys(SYMBOLS));
      globalGeneratorInstance = generator;

      generator.onSignal(async (candidate: SignalCandidate) => {
        try {
          await api.insertSignal({
            symbol: candidate.symbol,
            type: candidate.type,
            price: candidate.price,
            details: candidate.details,
            score: candidate.score,
            metrics: candidate.metrics as any,
          });

          try {
            await api.sendTelegramSignal(candidate);
          } catch (tgErr) {
            console.warn("[Telegram] Failed to send signal:", tgErr);
          }
        } catch (err) {
          console.error("[SignalEngine] Failed to save signal:", err);
        }
      });

      generator.start(5 * 60 * 1000);
      console.log("[SignalEngine] Singleton generator started");
    }

    return () => {
      globalGeneratorRefCount--;
      // Only stop if truly no components using it
      if (globalGeneratorRefCount <= 0 && globalGeneratorInstance) {
        // DON'T stop — keep running even when navigating away
        // globalGeneratorInstance.stop();
        // globalGeneratorInstance = null;
      }
    };
  }, [wsStatus]);

  // Realtime signals from database
  useEffect(() => {
    const channel = supabase
      .channel("signals-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signals" },
        (payload) => {
          const s = payload.new;
          const newSignal: Signal = {
            id: s.id,
            symbol: s.symbol,
            type: s.type as "BUY" | "SELL",
            price: Number(s.price),
            time: s.time,
            details: s.details || "",
            score: s.score ? Number(s.score) : undefined,
          };
          setSignals((prev) => [newSignal, ...prev].slice(0, 10));
          toast.info(`📊 ${s.type} signal: ${SYMBOLS[s.symbol] || s.symbol} (score: ${s.score || "?"})`);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Update market status from WebSocket ticks
  useEffect(() => {
    if (latestTicks.size === 0) return;
    setMarketStatus((prev) => {
      const updated = [...prev];
      for (const [symbol, tick] of latestTicks) {
        if (!SYMBOLS[symbol]) continue;
        const prevPrice = prevTicks.get(symbol);
        const direction: "up" | "down" | "neutral" = prevPrice
          ? tick.quote > prevPrice ? "up" : tick.quote < prevPrice ? "down" : "neutral"
          : "neutral";

        const idx = updated.findIndex((m) => m.symbol === symbol);
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], lastPrice: tick.quote, prevPrice, direction };
        } else {
          updated.push({ symbol, name: SYMBOLS[symbol], candles: 0, lastPrice: tick.quote, prevPrice, direction });
        }
      }
      return updated;
    });
  }, [latestTicks, prevTicks]);

  return { signals, status: marketStatus, loading, error, wsStatus };
}

// ─── useBacktest ─────────────────────────────────────────────

export interface BacktestConfig {
  symbols: string[];
  duration: number;
  timeframe: number;
  initialTradeAmount: number;
  initialBalance: number;
  martingaleMultiplier: number;
  maxMartingaleLevel: number;
  profitTarget: number;
}

export function useBacktest() {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<BacktestResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const abortRef = useRef(false);

  const validate = useCallback((config: BacktestConfig): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (config.symbols.length === 0) errs.symbols = "Select at least one symbol";
    if (config.duration < 1) errs.duration = "At least 1 hour";
    if (config.initialTradeAmount < 0.35) errs.initialTradeAmount = "Must be ≥ $0.35";
    if (config.initialBalance < 1) errs.initialBalance = "Balance must be positive";
    if (config.martingaleMultiplier < 1.1 || config.martingaleMultiplier > 5)
      errs.martingaleMultiplier = "1.1–5.0 range";
    if (config.maxMartingaleLevel < 1 || config.maxMartingaleLevel > 10)
      errs.maxMartingaleLevel = "1–10 levels";
    if (config.profitTarget < 0) errs.profitTarget = "Cannot be negative";
    return errs;
  }, []);

  const run = useCallback(async (config: BacktestConfig) => {
    const errs = validate(config);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setIsRunning(true);
    setResults(null);
    abortRef.current = false;

    try {
      const ticksNeeded = Math.min(config.duration * 3600 + 100, 5000);

      const symbolHistories: Map<string, { prices: number[]; times: number[] }> = new Map();

      const fetches = await Promise.allSettled(
        config.symbols.map(async (symbol) => {
          const history = await derivWs.getTickHistory(symbol, ticksNeeded);
          if (!history?.prices || history.prices.length < 50) return null;
          return { symbol, prices: history.prices.map(Number), times: history.times.map(Number) };
        })
      );

      for (const result of fetches) {
        if (result.status === "fulfilled" && result.value) {
          symbolHistories.set(result.value.symbol, {
            prices: result.value.prices,
            times: result.value.times,
          });
        }
      }

      if (symbolHistories.size === 0) {
        toast.error("No valid data for any selected symbol");
        setIsRunning(false);
        return;
      }

      const firstData = symbolHistories.values().next().value!;
      const startTime = firstData.times[50];
      // BACKTEST uses 5-minute intervals always
      const timeframeSeconds = TRADE_DURATION_BACKTEST * 60;
      const expectedTrades = Math.floor(config.duration * 60 / TRADE_DURATION_BACKTEST);

      function findNearestIndex(times: number[], targetTime: number): number {
        let lo = 0, hi = times.length - 1;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (times[mid] < targetTime) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      }

      const allTrades: BacktestTrade[] = [];
      let balance = config.initialBalance;
      let totalWins = 0;
      let totalLosses = 0;
      let grossWins = 0;
      let grossLosses = 0;
      let maxDrawdown = 0;
      let peakBalance = balance;
      let tradeAmount = config.initialTradeAmount;
      let martingaleLevel = 0;
      let stopReason: "profitTarget" | "martingale" | null = null;

      const symbolStats: Map<string, { wins: number; losses: number; grossWin: number; grossLoss: number }> = new Map();
      for (const symbol of symbolHistories.keys()) {
        symbolStats.set(symbol, { wins: 0, losses: 0, grossWin: 0, grossLoss: 0 });
      }

      for (let interval = 0; interval < expectedTrades && !abortRef.current; interval++) {
        if (balance <= 0) break;
        if (config.profitTarget > 0 && balance - config.initialBalance >= config.profitTarget) {
          stopReason = "profitTarget";
          break;
        }

        const intervalStartTime = startTime + interval * timeframeSeconds;
        const intervalEndTime = intervalStartTime + timeframeSeconds;

        interface CandidateWithMeta {
          symbol: string;
          type: "BUY" | "SELL";
          score: number;
          confidence: number;
          entryPrice: number;
          exitPrice: number;
          entryIdx: number;
          exitIdx: number;
          details: string;
          pattern: string | null;
        }

        const candidates: CandidateWithMeta[] = [];

        for (const [symbol, data] of symbolHistories) {
          const entryIdx = findNearestIndex(data.times, intervalStartTime);
          const exitIdx = findNearestIndex(data.times, intervalEndTime);

          if (entryIdx < 50 || exitIdx >= data.prices.length || entryIdx >= exitIdx) continue;

          const windowPrices = data.prices.slice(0, entryIdx + 1);
          const candidate = analyzeSymbol(windowPrices);

          if (candidate) {
            candidates.push({
              symbol,
              type: candidate.type,
              score: candidate.score,
              confidence: candidate.confidence,
              entryPrice: data.prices[entryIdx],
              exitPrice: data.prices[exitIdx],
              entryIdx,
              exitIdx,
              details: candidate.details,
              pattern: candidate.pattern,
            });
          }
        }

        if (candidates.length === 0) continue;

        candidates.sort((a, b) => b.confidence - a.confidence || b.score - a.score);
        const best = candidates[0];

        const isWin =
          (best.type === "BUY" && best.exitPrice > best.entryPrice) ||
          (best.type === "SELL" && best.exitPrice < best.entryPrice);

        const currentTradeAmount = tradeAmount;
        const payout = currentTradeAmount * 0.85;

        const tradePlacedAtLevel = martingaleLevel;

        if (isWin) {
          balance += payout;
          totalWins++;
          grossWins += payout;
          const stats = symbolStats.get(best.symbol)!;
          stats.wins++;
          stats.grossWin += payout;
          tradeAmount = config.initialTradeAmount;
          martingaleLevel = 0;
        } else {
          balance -= currentTradeAmount;
          totalLosses++;
          grossLosses += currentTradeAmount;
          const stats = symbolStats.get(best.symbol)!;
          stats.losses++;
          stats.grossLoss += currentTradeAmount;
          martingaleLevel++;
          if (martingaleLevel >= config.maxMartingaleLevel) {
            stopReason = "martingale";
          } else {
            tradeAmount = currentTradeAmount * config.martingaleMultiplier;
          }
        }

        if (balance > peakBalance) peakBalance = balance;
        const drawdown = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;

        allTrades.push({
          executionTime: new Date(intervalStartTime * 1000).toISOString(),
          symbol: best.symbol,
          type: best.type,
          entryPrice: best.entryPrice,
          exitPrice: best.exitPrice,
          tradeAmount: currentTradeAmount,
          result: isWin ? "WIN" : "LOSS",
          newBalance: balance,
          score: best.score,
          confidence: best.confidence,
          martingaleLevel: tradePlacedAtLevel,
          pattern: best.pattern,
          competingSymbols: candidates.length,
        });

        if (stopReason === "martingale") break;
      }

      const perSymbolResults: BacktestSymbolResult[] = [];
      for (const [symbol, stats] of symbolStats) {
        const total = stats.wins + stats.losses;
        if (total > 0) {
          perSymbolResults.push({
            symbol,
            totalTrades: total,
            wins: stats.wins,
            losses: stats.losses,
            winRate: ((stats.wins / total) * 100).toFixed(1),
            finalBalance: balance.toFixed(2),
            netProfit: (stats.grossWin - stats.grossLoss).toFixed(2),
            trades: [],
          });
        }
      }

      perSymbolResults.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

      const totalTrades = totalWins + totalLosses;
      const netProfit = balance - config.initialBalance;

      const profitFactor = grossLosses > 0
        ? (grossWins / grossLosses).toFixed(2)
        : grossWins > 0 ? "∞" : "0";

      const backtestResult: BacktestResult = {
        duration: config.duration,
        timeframe: config.timeframe,
        initialBalance: config.initialBalance,
        initialTradeAmount: config.initialTradeAmount,
        martingaleMultiplier: config.martingaleMultiplier,
        maxMartingaleLevel: config.maxMartingaleLevel,
        stopReason,
        summary: {
          totalTrades, totalWins, totalLosses,
          winRate: totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) + "%" : "0%",
          finalBalance: balance.toFixed(2),
          initialBalance: config.initialBalance.toFixed(2),
          totalNetProfit: netProfit.toFixed(2),
          isProfitable: netProfit > 0,
          maxDrawdown: maxDrawdown.toFixed(1) + "%",
          profitFactor,
        },
        results: perSymbolResults,
        allTrades,
      };

      setResults(backtestResult);

      if (totalTrades === 0) {
        toast.warning("No trade signals generated — try different symbols or longer duration");
      } else {
        const dataMinutes = firstData.times.length > 50
          ? Math.round((firstData.times[firstData.times.length - 1] - firstData.times[50]) / 60)
          : 0;
        toast.success(
          `Backtest complete: ${totalTrades} trades (${config.duration}h × ${config.timeframe}min = ${expectedTrades} slots, ${dataMinutes}min of data)`
        );
      }

      try {
        await api.saveBacktestSession({
          symbols: config.symbols,
          duration_hours: config.duration,
          timeframe_minutes: config.timeframe,
          initial_balance: config.initialBalance,
          initial_trade_amount: config.initialTradeAmount,
          martingale_multiplier: config.martingaleMultiplier,
          max_martingale_level: config.maxMartingaleLevel,
          profit_target: config.profitTarget,
          total_trades: totalTrades,
          total_wins: totalWins,
          total_losses: totalLosses,
          win_rate: backtestResult.summary.winRate,
          final_balance: balance,
          net_profit: netProfit,
          is_profitable: netProfit > 0,
          max_drawdown: backtestResult.summary.maxDrawdown,
          profit_factor: profitFactor,
          stop_reason: stopReason,
          results: { allTrades: allTrades.slice(0, 100), perSymbol: perSymbolResults },
        });
      } catch (err) {
        console.error("Failed to save backtest:", err);
      }
    } catch (err) {
      handleApiError(err, "Backtest failed");
    } finally {
      setIsRunning(false);
    }
  }, [validate]);

  const stop = useCallback(() => {
    abortRef.current = true;
    setIsRunning(false);
    toast.info("Backtest stopped");
  }, []);

  const clear = useCallback(() => { setResults(null); }, []);

  return { isRunning, results, errors, validate, setErrors, run, stop, clear };
}

// ─── useLiveAutomation (REAL trading loop) ───────────────────
// Automation state is module-level so it persists across page navigation.

interface AutomationGlobalState {
  running: boolean;
  pendingContracts: Map<number, { symbol: string; type: string; amount: number; martingaleLevel: number; openedAt: number }>;
  settleTimer: ReturnType<typeof setInterval> | null;
  realtimeChannel: any;
  config: { martingaleMultiplier: number; maxMartingaleLevel: number; initialTradeAmount: number; profitTarget: number } | null;
  martingale: { consecutiveLosses: number; nextAmount: number };
  tradeLocked: boolean;
  signalQueue: SignalCandidate | null;
  settling: boolean;
  initialBalance: number | null;
  accountType: "demo" | "live";
}

const globalAuto: AutomationGlobalState = {
  running: false,
  pendingContracts: new Map(),
  settleTimer: null,
  realtimeChannel: null,
  config: null,
  martingale: { consecutiveLosses: 0, nextAmount: 0 },
  tradeLocked: false,
  signalQueue: null,
  settling: false,
  initialBalance: null,
  accountType: "demo",
};

export function useLiveAutomation() {
  const [isRunning, setIsRunning] = useState(globalAuto.running);
  const [status, setStatus] = useState<LiveAutomationStatus | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [accountType, setAccountTypeState] = useState<"demo" | "live">(globalAuto.accountType);
  const setAccountType = useCallback((val: "demo" | "live") => {
    globalAuto.accountType = val;
    setAccountTypeState(val);
  }, []);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sync running state on mount (when navigating back to dashboard)
  useEffect(() => {
    setIsRunning(globalAuto.running);
  }, []);

  const loadBalance = useCallback(async (acct: "demo" | "live") => {
    setBalanceLoading(true);
    try {
      const data = await api.fetchBalance(acct);
      setBalance(typeof data.balance === "number" ? data.balance : null);
      setCurrency(data.currency || "USD");
      return typeof data.balance === "number" ? data.balance : null;
    } catch {
      setBalance(null);
      setCurrency("USD");
      return null;
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const validate = useCallback(
    (config: {
      duration: number; profitTarget: number; initialTradeAmount: number;
      martingaleMultiplier: number; maxMartingaleLevel: number;
    }): Record<string, string> => {
      const errs: Record<string, string> = {};
      if (config.profitTarget < 0) errs.profitTarget = "Cannot be negative";
      if (config.initialTradeAmount < 0.35) errs.initialTradeAmount = "Must be ≥ $0.35";
      if (config.martingaleMultiplier < 1.1 || config.martingaleMultiplier > 5)
        errs.martingaleMultiplier = "1.1–5.0 range";
      if (config.maxMartingaleLevel < 1 || config.maxMartingaleLevel > 10)
        errs.maxMartingaleLevel = "1–10 levels";
      return errs;
    }, []);

  // Check profit target
  const checkProfitTarget = useCallback(() => {
    if (!globalAuto.config || !globalAuto.initialBalance) return false;
    const cfg = globalAuto.config;
    if (cfg.profitTarget <= 0) return false;

    let currentBal: number | null = null;
    setStatus((prev) => {
      if (prev?.currentBalance != null) currentBal = prev.currentBalance;
      return prev;
    });

    if (currentBal == null) return false;

    const profit = currentBal - globalAuto.initialBalance;
    if (profit >= cfg.profitTarget) {
      console.log(`[Automation] 🎯 PROFIT TARGET REACHED: $${profit.toFixed(2)} >= $${cfg.profitTarget}`);
      toast.success(`🎯 Profit target reached! Net profit: $${profit.toFixed(2)}`);
      return true;
    }
    return false;
  }, []);

  // Settlement — uses 4min 15s wait (matches 4.75min trade duration)
  const SETTLEMENT_WAIT_MS = 4 * 60 * 1000 + 15 * 1000; // 4m15s

  const settlePendingContracts = useCallback(async () => {
    const pending = globalAuto.pendingContracts;
    if (pending.size === 0) return;
    if (globalAuto.settling) return;
    globalAuto.settling = true;

    const now = Date.now();
    const sortedEntries = [...pending.entries()].sort((a, b) => a[1].openedAt - b[1].openedAt);

    for (const [contractId, info] of sortedEntries) {
      if (!globalAuto.running && !globalAuto.config) break;

      if (now - info.openedAt < SETTLEMENT_WAIT_MS) continue;

      try {
        const result = await api.settleContract(contractId, globalAuto.accountType);
        if (result.settled) {
          pending.delete(contractId);
          const profit = result.profit || 0;
          const isWin = profit >= 0;
          const settledBalanceAfter = result.balance_after ?? null;

          toast[isWin ? "success" : "error"](
            `Contract ${contractId} settled: ${isWin ? "WIN" : "LOSS"} ($${profit.toFixed(2)})`
          );

          setStatus((prev) => {
            if (!prev) return prev;
            const trades = [...(prev.trades || [])];
            const idx = trades.findIndex((t) => t.contractId === contractId);
            if (idx >= 0) {
              trades[idx] = { ...trades[idx], result: isWin ? "WON" : "LOST", profit, status: "SETTLED" };
            }
            const totalProfit = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
            const winCount = trades.filter((t) => t.status === "SETTLED" && (t.profit || 0) >= 0).length;
            const lossCount = trades.filter((t) => t.status === "SETTLED" && (t.profit || 0) < 0).length;
            const newCurrentBalance = settledBalanceAfter != null ? settledBalanceAfter : prev.currentBalance;
            return { ...prev, trades, totalProfit, winCount, lossCount, currentBalance: newCurrentBalance };
          });

          if (settledBalanceAfter != null) {
            setBalance(settledBalanceAfter);
          }

          // MARTINGALE
          if (globalAuto.config) {
            const cfg = globalAuto.config;
            if (isWin) {
              globalAuto.martingale = { consecutiveLosses: 0, nextAmount: cfg.initialTradeAmount };
              console.log(`[Martingale] WIN → reset to $${cfg.initialTradeAmount.toFixed(2)}`);
            } else {
              const newConsecutive = globalAuto.martingale.consecutiveLosses + 1;
              if (newConsecutive >= cfg.maxMartingaleLevel) {
                console.log(`[Martingale] STOP → ${newConsecutive} consecutive losses (max: ${cfg.maxMartingaleLevel})`);
                toast.error(`🛑 Max martingale level (${cfg.maxMartingaleLevel}) reached — stopping automation`);
                globalAuto.settling = false;
                globalAuto.tradeLocked = false;
                stopAutomation();
                return;
              }
              const nextAmount = info.amount * cfg.martingaleMultiplier;
              globalAuto.martingale = { consecutiveLosses: newConsecutive, nextAmount };
              console.log(`[Martingale] LOSS #${newConsecutive} → next trade: $${nextAmount.toFixed(2)}`);
            }

            if (checkProfitTarget()) {
              globalAuto.settling = false;
              globalAuto.tradeLocked = false;
              stopAutomation();
              return;
            }
          }

          // Unlock
          globalAuto.tradeLocked = false;
          console.log(`[Automation] Trade lock released after settlement of contract #${contractId}`);

          // Execute queued signal
          if (globalAuto.signalQueue && globalAuto.running) {
            const queuedSignal = globalAuto.signalQueue;
            globalAuto.signalQueue = null;
            console.log(`[Automation] Executing queued signal: ${queuedSignal.type} ${SYMBOLS[queuedSignal.symbol]}`);
            setTimeout(() => {
              if (globalAuto.running) executeTrade(queuedSignal);
            }, 2000);
          }

          loadBalance(globalAuto.accountType);
        }
      } catch (err) {
        console.warn(`Failed to settle ${contractId}:`, err);
        if (now - info.openedAt > 10 * 60 * 1000) {
          pending.delete(contractId);
          globalAuto.tradeLocked = false;
        }
      }
    }
    globalAuto.settling = false;
  }, [loadBalance, checkProfitTarget]);

  // Execute trade — uses 4.75min duration for live trading
  const executeTrade = useCallback(async (signal: SignalCandidate) => {
    if (!globalAuto.running || !globalAuto.config) {
      console.log(`[Automation] Skipping trade — running: ${globalAuto.running}, config: ${!!globalAuto.config}`);
      return;
    }

    if (globalAuto.tradeLocked) {
      console.log(`[Automation] Trade LOCKED — queuing signal: ${signal.type} ${SYMBOLS[signal.symbol]}`);
      globalAuto.signalQueue = signal;
      toast.info(`⏳ Signal queued — waiting for previous trade to settle`);
      return;
    }

    const tradeAmount = Math.max(globalAuto.martingale.nextAmount, 0.35);
    const contractType = signal.type === "BUY" ? "CALL" : "PUT";

    globalAuto.tradeLocked = true;

    try {
      const result = await api.executeTrade({
        symbol: signal.symbol,
        amount: tradeAmount,
        contractType,
        duration: TRADE_DURATION_LIVE, // 4.75 minutes
        durationUnit: "m",
        source: "automation",
        accountType: globalAuto.accountType,
      });

      globalAuto.pendingContracts.set(result.contract_id, {
        symbol: signal.symbol,
        type: signal.type,
        amount: tradeAmount,
        martingaleLevel: globalAuto.martingale.consecutiveLosses,
        openedAt: Date.now(),
      });

      const trade: LiveTrade = {
        timestamp: new Date().toISOString(),
        signal: { symbol: signal.symbol, type: signal.type },
        tradeAmount,
        contractId: result.contract_id,
        status: "PENDING",
      };

      setStatus((prev) => ({
        ...(prev || { running: true, accountType: globalAuto.accountType }),
        running: true,
        trades: [...(prev?.trades || []), trade],
        currentBalance: result.balance_after,
      }));

      toast.success(`🤖 Auto-trade: ${signal.type} ${SYMBOLS[signal.symbol]} ($${tradeAmount.toFixed(2)}) — Contract #${result.contract_id}`);
    } catch (err) {
      console.error("[Automation] Trade execution failed:", err);
      toast.error(`Auto-trade failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      globalAuto.tradeLocked = false;
    }
  }, []);

  const start = useCallback(
    async (params: {
      duration: number; profitTarget: number; initialTradeAmount: number;
      martingaleMultiplier: number; maxMartingaleLevel: number;
    }) => {
      const errs = validate(params);
      setErrors(errs);
      if (Object.keys(errs).length > 0) return;

      const bal = await loadBalance(globalAuto.accountType);
      globalAuto.initialBalance = bal;
      globalAuto.running = true;
      globalAuto.config = params;
      globalAuto.martingale = { consecutiveLosses: 0, nextAmount: params.initialTradeAmount };
      globalAuto.tradeLocked = false;
      globalAuto.signalQueue = null;

      setIsRunning(true);
      setStatus({
        running: true,
        accountType,
        initialBalance: bal ?? undefined,
        trades: [],
        totalProfit: 0,
        winCount: 0,
        lossCount: 0,
      });

      // Subscribe to signals — this channel persists even when navigating away
      const channel = supabase
        .channel("automation-signals")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "signals" },
          (payload) => {
            if (!globalAuto.running) return;
            const s = payload.new;
            const signal: SignalCandidate = {
              symbol: s.symbol,
              type: s.type as "BUY" | "SELL",
              price: Number(s.price),
              score: s.score ? Number(s.score) : 0,
              confidence: s.score ? Number(s.score) : 0,
              grade: "B" as const,
              details: s.details || "",
              logic: "",
              pattern: null,
              metrics: s.metrics || {} as any,
            };
            console.log(`[Automation] Signal received: ${signal.type} ${SYMBOLS[signal.symbol]} — executing trade`);
            executeTrade(signal);
          }
        )
        .subscribe((status) => {
          console.log(`[Automation] Realtime channel status: ${status}`);
          if (status === "CHANNEL_ERROR" && globalAuto.running) {
            console.warn("[Automation] Channel error — will attempt reconnect");
            toast.warning("⚠️ Signal channel reconnecting...");
          }
        });

      globalAuto.realtimeChannel = channel;

      // Settlement checker every 10 seconds
      globalAuto.settleTimer = setInterval(() => settlePendingContracts(), 10 * 1000);

      const durationMsg = params.duration > 0
        ? ` (duration ${params.duration}h is advisory only — engine runs until profit target or manual stop)`
        : "";
      toast.success(`🚀 Automation started — will trade every signal${durationMsg}`);
    },
    [validate, executeTrade, settlePendingContracts, loadBalance, accountType]
  );

  const stopAutomation = useCallback(async () => {
    globalAuto.running = false;
    setIsRunning(false);

    if (globalAuto.realtimeChannel) {
      supabase.removeChannel(globalAuto.realtimeChannel);
      globalAuto.realtimeChannel = null;
    }
    if (globalAuto.settleTimer) {
      clearInterval(globalAuto.settleTimer);
      globalAuto.settleTimer = null;
    }

    globalAuto.tradeLocked = false;
    globalAuto.signalQueue = null;

    // Final settle attempt
    await settlePendingContracts();

    setStatus((prev) => (prev ? { ...prev, running: false } : null));
    toast.info("Automation stopped");
    loadBalance(globalAuto.accountType);
  }, [loadBalance, settlePendingContracts]);

  useEffect(() => {
    setBalance(null);
    loadBalance(accountType);
  }, [accountType, loadBalance]);

  // Do NOT clean up on unmount — automation persists across navigation
  // Only clean up if the entire app is closing

  return {
    isRunning, status, balance, currency, balanceLoading,
    accountType, setAccountType, errors, setErrors, validate,
    start, stop: stopAutomation,
  };
}

// ─── useTestTrade (Manual Trade with martingale support) ─────

export function useTestTrade() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestTradeResult | null>(null);
  const [quickTradeExecuted, setQuickTradeExecuted] = useState(false);
  const [tradeOpenedAt, setTradeOpenedAt] = useState<number | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const martingaleRef = useRef({ consecutiveLosses: 0, baseAmount: 10 });

  const getMartingaleAmount = useCallback((accountType: "demo" | "live") => {
    const baseAmount = accountType === "demo" ? 10 : 0.35;
    martingaleRef.current.baseAmount = baseAmount;
    if (martingaleRef.current.consecutiveLosses === 0) return baseAmount;
    let amount = baseAmount;
    for (let i = 0; i < Math.min(martingaleRef.current.consecutiveLosses, 5); i++) {
      amount *= 2.2;
    }
    return Math.round(amount * 100) / 100;
  }, []);

  const execute = useCallback(
    async (params: {
      accountType: "demo" | "live";
      amount: number;
      symbol: string;
      durationMinutes: number;
      direction?: "BUY" | "SELL";
    }) => {
      if (params.amount < 0.35) {
        toast.error("Minimum trade amount is $0.35");
        return;
      }

      setLoading(true);
      setResult(null);
      // NOTE: Do NOT reset quickTradeExecuted here — it's set by quickTrade()
      // and must persist until settlement completes.
      try {
        let tradeType: "BUY" | "SELL" = params.direction || "BUY";
        if (!params.direction) {
          try {
            const { data: latestSignals } = await supabase
              .from("signals")
              .select("type")
              .eq("symbol", params.symbol)
              .order("time", { ascending: false })
              .limit(1);
            if (latestSignals && latestSignals.length > 0) {
              tradeType = latestSignals[0].type as "BUY" | "SELL";
            }
          } catch {
            // fallback to BUY
          }
        }
        const data = await api.executeTestTrade({
          ...params,
          // Use 4.75min for manual trades (not backtest)
          durationMinutes: TRADE_DURATION_LIVE,
          type: tradeType,
        });
        setResult(data);
        setTradeOpenedAt(Date.now());
        toast.success(`Trade placed! Contract #${data.contractId} — settling in ${TRADE_DURATION_LIVE}m`);

        // Auto-settle after trade duration + 15s buffer
        const settleDelay = (TRADE_DURATION_LIVE * 60 + 15) * 1000;

        const attemptSettle = async () => {
          try {
            const settled = await api.settleContract(data.contractId, params.accountType);
            if (settled.settled) {
              if (settleTimerRef.current) clearInterval(settleTimerRef.current);
              const profit = settled.profit || 0;
              const isWin = profit >= 0;

              setResult((prev) =>
                prev ? { ...prev, result: isWin ? "WIN" : "LOSS", profit } : prev
              );

              if (isWin) {
                martingaleRef.current.consecutiveLosses = 0;
                console.log(`[ManualTrade Martingale] WIN → reset consecutive losses`);
              } else {
                martingaleRef.current.consecutiveLosses = Math.min(
                  martingaleRef.current.consecutiveLosses + 1,
                  5
                );
                console.log(`[ManualTrade Martingale] LOSS → consecutive: ${martingaleRef.current.consecutiveLosses}`);
              }

              // Re-enable quick trade after settlement
              setQuickTradeExecuted(false);
              setTradeOpenedAt(null);

              toast[isWin ? "success" : "error"](
                `Contract #${data.contractId} settled: ${isWin ? "WIN" : "LOSS"} ($${profit.toFixed(2)})`
              );
            }
          } catch {
            // Keep retrying
          }
        };

        setTimeout(() => {
          attemptSettle();
          settleTimerRef.current = setInterval(attemptSettle, 15000);
        }, settleDelay);
      } catch (err) {
        handleApiError(err, "Manual trade failed");
      } finally {
        setLoading(false);
      }
    }, []);

  // Quick trade: uses latest signal direction, auto-computed martingale amount
  const quickTrade = useCallback(
    async (params: {
      accountType: "demo" | "live";
      symbol: string;
      direction: "BUY" | "SELL";
    }) => {
      setQuickTradeExecuted(true);
      const amount = getMartingaleAmount(params.accountType);
      await execute({
        accountType: params.accountType,
        amount,
        symbol: params.symbol,
        durationMinutes: TRADE_DURATION_LIVE,
        direction: params.direction,
      });
    },
    [execute, getMartingaleAmount]
  );

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearInterval(settleTimerRef.current);
    };
  }, []);

  return { loading, result, execute, quickTrade, getMartingaleAmount, quickTradeExecuted, tradeOpenedAt };
}

// ─── useTradeHistory ─────────────────────────────────────────

export function useTradeHistory() {
  const [trades, setTrades] = useState<any[]>([]);
  const [backtests, setBacktests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tradeData, backtestData] = await Promise.all([
        api.fetchTradeHistory(100),
        api.fetchBacktestSessions(20),
      ]);
      setTrades(tradeData);
      setBacktests(backtestData);
    } catch (err) {
      handleApiError(err, "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { trades, backtests, loading, reload: load };
}
