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
        // Store previous price before updating
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

export function useSignals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [marketStatus, setMarketStatus] = useState<MarketStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { wsStatus, latestTicks, prevTicks, subscribeTo } = useDerivConnection();
  const generatorRef = useRef<SignalGenerator | null>(null);

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

        // Subscribe to all 20 symbols
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

  // Start signal generator (every 5 minutes)
  useEffect(() => {
    if (wsStatus !== "connected") return;

    const generator = new SignalGenerator(Object.keys(SYMBOLS));
    generatorRef.current = generator;

    const unsub = generator.onSignal(async (candidate: SignalCandidate) => {
      try {
        // Save to database (triggers realtime push)
        await api.insertSignal({
          symbol: candidate.symbol,
          type: candidate.type,
          price: candidate.price,
          details: candidate.details,
          score: candidate.score,
          metrics: candidate.metrics as any,
        });

        // Send to Telegram
        try {
          await api.sendTelegramSignal(candidate);
        } catch (tgErr) {
          console.warn("[Telegram] Failed to send signal:", tgErr);
        }
      } catch (err) {
        console.error("[SignalEngine] Failed to save signal:", err);
        const localSignal: Signal = {
          id: Date.now(),
          symbol: candidate.symbol,
          type: candidate.type,
          price: candidate.price,
          time: new Date().toISOString(),
          details: candidate.details,
          score: candidate.score,
        };
        setSignals((prev) => [localSignal, ...prev].slice(0, 10));
      }
    });

    generator.start(5 * 60 * 1000);

    return () => {
      unsub();
      generator.stop();
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

  // Update market status from WebSocket ticks with direction tracking
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
      // Calculate required ticks: for 1s indices, 1 hour ≈ 3600 ticks
      // Request enough data for the full duration + 50 warmup ticks
      const ticksNeeded = Math.min(config.duration * 3600 + 100, 5000);

      // Fetch history for ALL symbols in parallel
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

      // Use timestamp-based stepping: find time range across all symbols
      // Get the reference timeline from the first symbol
      const firstData = symbolHistories.values().next().value!;
      const startTime = firstData.times[50]; // Skip first 50 for warmup
      const timeframeSeconds = config.timeframe * 60; // Convert minutes to seconds
      const expectedTrades = Math.floor(config.duration * 60 / config.timeframe);

      // Build time-aligned index lookup for each symbol
      // For each 5-minute interval, find the nearest tick index
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

      // Per-symbol tracking
      const symbolStats: Map<string, { wins: number; losses: number; grossWin: number; grossLoss: number }> = new Map();
      for (const symbol of symbolHistories.keys()) {
        symbolStats.set(symbol, { wins: 0, losses: 0, grossWin: 0, grossLoss: 0 });
      }

      // Walk through TIME intervals — exactly 1 trade per 5-minute slot
      for (let interval = 0; interval < expectedTrades && !abortRef.current; interval++) {
        if (balance <= 0) break;
        if (config.profitTarget > 0 && balance - config.initialBalance >= config.profitTarget) {
          stopReason = "profitTarget";
          break;
        }

        const intervalStartTime = startTime + interval * timeframeSeconds;
        const intervalEndTime = intervalStartTime + timeframeSeconds;

        // Analyze all symbols at this time step
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

          // Need enough data for analysis (at least 50 points before entry)
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

        // Pick the highest confidence candidate
        candidates.sort((a, b) => b.confidence - a.confidence || b.score - a.score);
        const best = candidates[0];

        const isWin =
          (best.type === "BUY" && best.exitPrice > best.entryPrice) ||
          (best.type === "SELL" && best.exitPrice < best.entryPrice);

        const currentTradeAmount = tradeAmount;
        const payout = currentTradeAmount * 0.85;

        // Track the level at which this trade was placed BEFORE outcome
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
            // CRITICAL: Stop trading when max consecutive losses reached
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
          martingaleLevel,
          pattern: best.pattern,
          competingSymbols: candidates.length,
        });
      }

      // Build per-symbol results
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

      // Sort by win rate descending
      perSymbolResults.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

      const totalTrades = totalWins + totalLosses;
      const netProfit = balance - config.initialBalance;

      // Profit factor = gross wins / gross losses (NOT win count / loss count)
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
        allTrades, // Chronological order (oldest first)
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

      // Save to database
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

export function useLiveAutomation() {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<LiveAutomationStatus | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [accountType, setAccountType] = useState<"demo" | "live">("demo");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const generatorRef = useRef<SignalGenerator | null>(null);
  const pendingContractsRef = useRef<Map<number, { symbol: string; type: string; amount: number; openedAt: number }>>(new Map());
  const settleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const configRef = useRef<{ martingaleMultiplier: number; maxMartingaleLevel: number; initialTradeAmount: number; profitTarget: number } | null>(null);
  const martingaleRef = useRef({ level: 0, amount: 0 });

  const loadBalance = useCallback(async (acct: "demo" | "live") => {
    setBalanceLoading(true);
    try {
      const data = await api.fetchBalance(acct);
      setBalance(typeof data.balance === "number" ? data.balance : null);
      setCurrency(data.currency || "USD");
    } catch {
      setBalance(null);
      setCurrency("USD");
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
      if (config.duration < 1) errs.duration = "Must be at least 1 hour";
      if (config.profitTarget < 0) errs.profitTarget = "Cannot be negative";
      if (config.initialTradeAmount < 0.35) errs.initialTradeAmount = "Must be ≥ $0.35";
      if (config.martingaleMultiplier < 1.1 || config.martingaleMultiplier > 5)
        errs.martingaleMultiplier = "1.1–5.0 range";
      if (config.maxMartingaleLevel < 1 || config.maxMartingaleLevel > 10)
        errs.maxMartingaleLevel = "1–10 levels";
      return errs;
    }, []);

  // Settle pending contracts — check every 15s, settle after 5min+10s buffer
  const settlePendingContracts = useCallback(async () => {
    const pending = pendingContractsRef.current;
    if (pending.size === 0) return;

    const now = Date.now();
    for (const [contractId, info] of pending.entries()) {
      // Wait at least 5 minutes + 10 second buffer before trying to settle
      const CONTRACT_DURATION_MS = 5 * 60 * 1000 + 10 * 1000;
      if (now - info.openedAt < CONTRACT_DURATION_MS) continue;

      try {
        const result = await api.settleContract(contractId);
        if (result.settled) {
          pending.delete(contractId);
          const profit = result.profit || 0;
          const isWin = profit >= 0;

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
            return { ...prev, trades, totalProfit, winCount, lossCount };
          });

          // Martingale logic
          if (configRef.current) {
            if (isWin) {
              martingaleRef.current = { level: 0, amount: configRef.current.initialTradeAmount };
            } else {
              const newLevel = martingaleRef.current.level + 1;
              if (newLevel < configRef.current.maxMartingaleLevel) {
                martingaleRef.current = {
                  level: newLevel,
                  amount: martingaleRef.current.amount * configRef.current.martingaleMultiplier,
                };
              } else {
                martingaleRef.current = { level: 0, amount: configRef.current.initialTradeAmount };
              }
            }
          }

          // Refresh balance
          loadBalance(accountType);
        }
      } catch (err) {
        console.warn(`Failed to settle ${contractId}:`, err);
        // If contract is too old (>10 min past expiry), remove from pending
        if (now - info.openedAt > 10 * 60 * 1000) {
          pending.delete(contractId);
          console.warn(`Removed stale contract ${contractId} from pending`);
        }
      }
    }
  }, [accountType, loadBalance]);

  // Execute a trade based on signal
  const executeTrade = useCallback(async (signal: SignalCandidate) => {
    if (!runningRef.current || !configRef.current) return;

    const tradeAmount = Math.max(martingaleRef.current.amount, 0.35);
    const contractType = signal.type === "BUY" ? "CALL" : "PUT";

    try {
      const result = await api.executeTrade({
        symbol: signal.symbol,
        amount: tradeAmount,
        contractType,
        duration: 5,
        durationUnit: "m",
        source: "automation",
      });

      pendingContractsRef.current.set(result.contract_id, {
        symbol: signal.symbol,
        type: signal.type,
        amount: tradeAmount,
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
        ...(prev || { running: true, accountType: "demo" }),
        running: true,
        trades: [...(prev?.trades || []), trade],
        currentBalance: result.balance_after,
      }));

      toast.success(`🤖 Auto-trade: ${signal.type} ${SYMBOLS[signal.symbol]} ($${tradeAmount.toFixed(2)}) — Contract #${result.contract_id}`);
    } catch (err) {
      console.error("[Automation] Trade execution failed:", err);
      toast.error(`Auto-trade failed: ${err instanceof Error ? err.message : "Unknown error"}`);
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

      runningRef.current = true;
      configRef.current = params;
      martingaleRef.current = { level: 0, amount: params.initialTradeAmount };
      setIsRunning(true);
      setStatus({
        running: true,
        accountType,
        trades: [],
        totalProfit: 0,
        winCount: 0,
        lossCount: 0,
      });

      const generator = new SignalGenerator(Object.keys(SYMBOLS));
      generatorRef.current = generator;

      generator.onSignal((signal) => executeTrade(signal));
      generator.start(5 * 60 * 1000);

      // Settlement checker every 15 seconds for faster settling
      settleTimerRef.current = setInterval(() => settlePendingContracts(), 15 * 1000);

      // Auto-stop after duration
      stopTimerRef.current = setTimeout(() => {
        toast.info("⏰ Automation duration reached — stopping");
        stopAutomation();
      }, params.duration * 60 * 60 * 1000);

      toast.success(`🚀 Automation started — trading every 5 minutes for ${params.duration}h`);
    },
    [accountType, validate, executeTrade, settlePendingContracts]
  );

  const stopAutomation = useCallback(async () => {
    runningRef.current = false;
    setIsRunning(false);

    if (generatorRef.current) {
      generatorRef.current.stop();
      generatorRef.current = null;
    }
    if (settleTimerRef.current) {
      clearInterval(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }

    // Final settle attempt
    await settlePendingContracts();

    setStatus((prev) => (prev ? { ...prev, running: false } : null));
    toast.info("Automation stopped");
    loadBalance(accountType);
  }, [accountType, loadBalance, settlePendingContracts]);

  useEffect(() => {
    setBalance(null);
    loadBalance(accountType);
  }, [accountType, loadBalance]);

  useEffect(() => {
    return () => {
      if (generatorRef.current) generatorRef.current.stop();
      if (settleTimerRef.current) clearInterval(settleTimerRef.current);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
  }, []);

  return {
    isRunning, status, balance, currency, balanceLoading,
    accountType, setAccountType, errors, setErrors, validate,
    start, stop: stopAutomation,
  };
}

// ─── useTestTrade ────────────────────────────────────────────

export function useTestTrade() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestTradeResult | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      try {
        // Use provided direction, or fallback to latest signal for this symbol, or random
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
          type: tradeType,
        });
        setResult(data);
        toast.success(`Trade placed! Contract #${data.contractId} — settling in ${params.durationMinutes}m`);

        // Auto-settle: first attempt after duration + 15s buffer, then retry every 15s
        const settleDelay = (params.durationMinutes * 60 + 15) * 1000;

        const attemptSettle = async () => {
          try {
            const settled = await api.settleContract(data.contractId);
            if (settled.settled) {
              if (settleTimerRef.current) clearInterval(settleTimerRef.current);
              const profit = settled.profit || 0;
              setResult((prev) =>
                prev ? { ...prev, result: profit >= 0 ? "WIN" : "LOSS", profit } : prev
              );
              toast[profit >= 0 ? "success" : "error"](
                `Contract #${data.contractId} settled: ${profit >= 0 ? "WIN" : "LOSS"} ($${profit.toFixed(2)})`
              );
            }
          } catch {
            // Keep retrying
          }
        };

        // First attempt after contract expiry
        setTimeout(() => {
          attemptSettle();
          // Then retry every 15 seconds
          settleTimerRef.current = setInterval(attemptSettle, 15000);
        }, settleDelay);
      } catch (err) {
        handleApiError(err, "Test trade failed");
      } finally {
        setLoading(false);
      }
    }, []);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearInterval(settleTimerRef.current);
    };
  }, []);

  return { loading, result, execute };
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
