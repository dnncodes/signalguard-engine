import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  type Signal,
  type MarketStatus,
  type BacktestResult,
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
  calculateEMA,
  calculateRSI,
  calculateMACD,
  detectDivergence,
} from "@/services/signalEngine";

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

  useEffect(() => {
    derivWs.connect();
    const unsubStatus = derivWs.onStatusChange(setStatus);
    const unsubTick = derivWs.onTick((tick) => {
      setLatestTicks((prev) => {
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

  return { wsStatus: status, latestTicks, subscribeTo };
}

// ─── useSignals (Realtime + 5-minute signal generation) ─────

export function useSignals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [marketStatus, setMarketStatus] = useState<MarketStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { wsStatus, latestTicks, subscribeTo } = useDerivConnection();
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

        // Subscribe to verified symbols only
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
      } catch (err) {
        console.error("[SignalEngine] Failed to save signal:", err);
        // Still show locally
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

    generator.start(5 * 60 * 1000); // 5 minutes

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

  // Update market status from WebSocket ticks
  useEffect(() => {
    if (latestTicks.size === 0) return;
    setMarketStatus((prev) => {
      const updated = [...prev];
      for (const [symbol, tick] of latestTicks) {
        if (!SYMBOLS[symbol]) continue; // Skip unverified symbols
        const idx = updated.findIndex((m) => m.symbol === symbol);
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], lastPrice: tick.quote };
        } else {
          updated.push({ symbol, name: SYMBOLS[symbol], candles: 0, lastPrice: tick.quote });
        }
      }
      return updated;
    });
  }, [latestTicks]);

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
      const allTrades: any[] = [];
      let balance = config.initialBalance;
      let totalWins = 0;
      let totalLosses = 0;
      let maxDrawdown = 0;
      let peakBalance = balance;
      const perSymbolResults: any[] = [];

      for (const symbol of config.symbols) {
        if (abortRef.current) break;

        let history;
        try {
          history = await derivWs.getTickHistory(symbol, 500);
        } catch (err) {
          toast.error(`No data for ${SYMBOLS[symbol] || symbol}`);
          continue;
        }

        if (!history?.prices || history.prices.length < 50) {
          toast.warning(`Insufficient data for ${SYMBOLS[symbol] || symbol}`);
          continue;
        }

        const prices = history.prices.map(Number);
        const times = history.times.map(Number);
        let tradeAmount = config.initialTradeAmount;
        let martingaleLevel = 0;
        let symbolWins = 0;
        let symbolLosses = 0;

        // Use full analysis
        const ema9 = calculateEMA(prices, 9);
        const ema21 = calculateEMA(prices, 21);
        const rsi = calculateRSI(prices, 14);
        const { histogram } = calculateMACD(prices);

        for (let i = 30; i < prices.length - config.timeframe && !abortRef.current; i++) {
          if (balance <= 0) break;
          if (config.profitTarget > 0 && balance - config.initialBalance >= config.profitTarget) break;

          const prevEmaDiff = ema9[i - 1] - ema21[i - 1];
          const currEmaDiff = ema9[i] - ema21[i];
          const emaCross = (prevEmaDiff <= 0 && currEmaDiff > 0) || (prevEmaDiff >= 0 && currEmaDiff < 0);

          const prevHist = histogram[i - 1] || 0;
          const currHist = histogram[i] || 0;
          const macdCross = (prevHist <= 0 && currHist > 0) || (prevHist >= 0 && currHist < 0);

          const rsiExtreme = rsi[i] < 30 || rsi[i] > 70;

          // Need at least one trigger
          if (!emaCross && !macdCross && !rsiExtreme) continue;

          // Score the setup
          let score = 0;
          if (emaCross) score += 30;
          if (macdCross) score += 25;
          if (rsiExtreme) score += 20;

          // Check divergence
          const div = detectDivergence(prices.slice(0, i + 1), rsi.slice(0, i + 1));
          if (div) score += div.strength * 0.2;

          const type = currEmaDiff > 0 || currHist > 0 || rsi[i] < 40 ? "BUY" : "SELL";
          const entryPrice = prices[i];
          const exitPrice = prices[Math.min(i + config.timeframe, prices.length - 1)];

          const isWin =
            (type === "BUY" && exitPrice > entryPrice) ||
            (type === "SELL" && exitPrice < entryPrice);

          if (isWin) {
            balance += tradeAmount * 0.85;
            symbolWins++;
            totalWins++;
            tradeAmount = config.initialTradeAmount;
            martingaleLevel = 0;
          } else {
            balance -= tradeAmount;
            symbolLosses++;
            totalLosses++;
            martingaleLevel++;
            if (martingaleLevel < config.maxMartingaleLevel) {
              tradeAmount *= config.martingaleMultiplier;
            } else {
              tradeAmount = config.initialTradeAmount;
              martingaleLevel = 0;
            }
          }

          if (balance > peakBalance) peakBalance = balance;
          const drawdown = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
          if (drawdown > maxDrawdown) maxDrawdown = drawdown;

          allTrades.push({
            executionTime: new Date(times[i] * 1000).toISOString(),
            symbol, type, entryPrice, exitPrice,
            tradeAmount: isWin ? config.initialTradeAmount : tradeAmount / config.martingaleMultiplier,
            result: isWin ? "WIN" : "LOSS",
            newBalance: balance,
            score: Math.round(score),
            martingaleLevel,
          });
        }

        const totalSymbolTrades = symbolWins + symbolLosses;
        if (totalSymbolTrades > 0) {
          perSymbolResults.push({
            symbol, totalTrades: totalSymbolTrades, wins: symbolWins, losses: symbolLosses,
            winRate: ((symbolWins / totalSymbolTrades) * 100).toFixed(1),
            finalBalance: balance.toFixed(2),
            netProfit: (balance - config.initialBalance).toFixed(2),
            trades: [],
          });
        }
      }

      const totalTrades = totalWins + totalLosses;
      const netProfit = balance - config.initialBalance;

      const backtestResult: BacktestResult = {
        duration: config.duration,
        timeframe: config.timeframe,
        initialBalance: config.initialBalance,
        initialTradeAmount: config.initialTradeAmount,
        martingaleMultiplier: config.martingaleMultiplier,
        maxMartingaleLevel: config.maxMartingaleLevel,
        summary: {
          totalTrades, totalWins, totalLosses,
          winRate: totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) + "%" : "0%",
          finalBalance: balance.toFixed(2),
          initialBalance: config.initialBalance.toFixed(2),
          totalNetProfit: netProfit.toFixed(2),
          isProfitable: netProfit > 0,
          maxDrawdown: maxDrawdown.toFixed(1) + "%",
          profitFactor: totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : totalWins > 0 ? "∞" : "0",
        },
        results: perSymbolResults,
        allTrades,
      };

      setResults(backtestResult);

      if (totalTrades === 0) {
        toast.warning("No trade signals generated — try different symbols or longer duration");
      } else {
        toast.success(`Backtest complete: ${totalTrades} trades on real Deriv ticks`);
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
          profit_factor: backtestResult.summary.profitFactor,
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

  // Settle pending contracts (check every 30s)
  const settlePendingContracts = useCallback(async () => {
    const pending = pendingContractsRef.current;
    if (pending.size === 0) return;

    const now = Date.now();
    for (const [contractId, info] of pending.entries()) {
      // Wait at least 5 minutes before trying to settle
      if (now - info.openedAt < 5 * 60 * 1000) continue;

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
        // If contract is too old (>15 min), remove from pending to avoid stuck state
        if (now - info.openedAt > 15 * 60 * 1000) {
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
        duration: 5, // Always 5 minutes
        durationUnit: "m",
        source: "automation",
      });

      // Track pending contract
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

      // Start signal generator
      const generator = new SignalGenerator(Object.keys(SYMBOLS));
      generatorRef.current = generator;

      generator.onSignal((signal) => executeTrade(signal));
      generator.start(5 * 60 * 1000); // Signal every 5 minutes

      // Start settlement checker (every 30 seconds)
      settleTimerRef.current = setInterval(() => settlePendingContracts(), 30 * 1000);

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

  // Cleanup on unmount
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
    }) => {
      if (params.amount < 0.35) {
        toast.error("Minimum trade amount is $0.35");
        return;
      }

      setLoading(true);
      setResult(null);
      try {
        const data = await api.executeTestTrade({
          ...params,
          type: Math.random() > 0.5 ? "BUY" : "SELL",
        });
        setResult(data);
        toast.success(`Trade placed! Contract #${data.contractId} — settling in ${params.durationMinutes}m`);

        // Auto-settle after duration + 30s buffer
        const settleDelay = (params.durationMinutes * 60 + 30) * 1000;
        settleTimerRef.current = setInterval(async () => {
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
        }, 30000);

        // First attempt after duration
        setTimeout(async () => {
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
          } catch { /* retry will catch it */ }
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

// ─── Utility: EMA calculation ────────────────────────────────

function calculateEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = new Array(prices.length).fill(0);

  let sum = 0;
  for (let i = 0; i < period && i < prices.length; i++) {
    sum += prices[i];
  }
  ema[period - 1] = sum / period;

  for (let i = period; i < prices.length; i++) {
    ema[i] = prices[i] * k + ema[i - 1] * (1 - k);
  }

  return ema;
}
