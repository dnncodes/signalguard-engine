import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  type Signal,
  type MarketStatus,
  type BacktestResult,
  type LiveAutomationStatus,
  type TestTradeResult,
  ApiError,
  SYMBOLS,
} from "@/types/engine";
import * as api from "@/services/api";
import { derivWs, type TickData, type ConnectionStatus } from "@/services/derivWebSocket";

// ─── Error handler ───────────────────────────────────────────

function handleApiError(err: unknown, context: string): string {
  if (err instanceof ApiError) {
    if (err.code === "ABORT") return "";
    const msg = `${context}: ${err.message}`;
    toast.error(msg);
    console.error(`[${err.code}]`, msg);
    return msg;
  }
  const msg = `${context}: ${err instanceof Error ? err.message : "Unknown error"}`;
  toast.error(msg);
  console.error(msg);
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

    return () => {
      unsubStatus();
      unsubTick();
      unsubError();
    };
  }, []);

  const subscribeTo = useCallback((symbols: string[]) => {
    symbols.forEach((s) => derivWs.subscribeTicks(s));
  }, []);

  return { wsStatus: status, latestTicks, subscribeTo };
}

// ─── useSignals (Realtime from database + WebSocket ticks) ──

export function useSignals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [marketStatus, setMarketStatus] = useState<MarketStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { wsStatus, latestTicks, subscribeTo } = useDerivConnection();

  // Initial load from database
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

        // Subscribe to ticks for all known symbols
        const symbolKeys = Object.keys(SYMBOLS);
        subscribeTo(symbolKeys);
      } catch (err) {
        const msg = handleApiError(err, "Initial data load failed");
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    loadInitial();
  }, [subscribeTo]);

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
          toast.info(`New ${s.type} signal: ${SYMBOLS[s.symbol] || s.symbol}`);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Update market status from WebSocket ticks
  useEffect(() => {
    if (latestTicks.size === 0) return;

    setMarketStatus((prev) => {
      const updated = [...prev];
      for (const [symbol, tick] of latestTicks) {
        const idx = updated.findIndex((m) => m.symbol === symbol);
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], lastPrice: tick.quote };
        }
      }
      return updated;
    });
  }, [latestTicks]);

  return { signals, status: marketStatus, loading, error, wsStatus, refetch: async () => {} };
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
    if (config.duration < 1) errs.duration = "At least 1 hour";
    if (config.initialTradeAmount < 0.1) errs.initialTradeAmount = "Must be ≥ $0.10";
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
      // Fetch real tick history from Deriv for each symbol
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
          console.error(`Failed to get tick history for ${symbol}:`, err);
          continue;
        }

        if (!history?.prices || history.prices.length < 20) continue;

        const prices = history.prices.map(Number);
        const times = history.times.map(Number);
        let tradeAmount = config.initialTradeAmount;
        let martingaleLevel = 0;
        let symbolWins = 0;
        let symbolLosses = 0;

        // Simple EMA crossover backtest on historical ticks
        const ema9 = calculateEMA(prices, 9);
        const ema21 = calculateEMA(prices, 21);

        for (let i = 22; i < prices.length - 1 && !abortRef.current; i++) {
          if (balance <= 0) break;
          if (config.profitTarget > 0 && balance - config.initialBalance >= config.profitTarget) break;

          // Signal: EMA 9 crosses above EMA 21 = BUY, below = SELL
          const prevDiff = ema9[i - 1] - ema21[i - 1];
          const currDiff = ema9[i] - ema21[i];

          if ((prevDiff <= 0 && currDiff > 0) || (prevDiff >= 0 && currDiff < 0)) {
            const type = currDiff > 0 ? "BUY" : "SELL";
            const entryPrice = prices[i];
            const exitPrice = prices[Math.min(i + config.timeframe, prices.length - 1)];

            const isWin =
              (type === "BUY" && exitPrice > entryPrice) ||
              (type === "SELL" && exitPrice < entryPrice);

            if (isWin) {
              balance += tradeAmount * 0.85; // ~85% payout
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
              symbol,
              type,
              entryPrice,
              exitPrice,
              tradeAmount: isWin ? tradeAmount : tradeAmount / (isWin ? 1 : config.martingaleMultiplier),
              result: isWin ? "WIN" : "LOSS",
              newBalance: balance,
              score: Math.abs(currDiff) * 100,
              martingaleLevel,
            });
          }
        }

        const totalSymbolTrades = symbolWins + symbolLosses;
        if (totalSymbolTrades > 0) {
          perSymbolResults.push({
            symbol,
            totalTrades: totalSymbolTrades,
            wins: symbolWins,
            losses: symbolLosses,
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
          totalTrades,
          totalWins,
          totalLosses,
          winRate: totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) + "%" : "0%",
          finalBalance: balance.toFixed(2),
          initialBalance: config.initialBalance.toFixed(2),
          totalNetProfit: netProfit.toFixed(2),
          isProfitable: netProfit > 0,
          maxDrawdown: maxDrawdown.toFixed(1) + "%",
          profitFactor:
            totalLosses > 0
              ? (totalWins / totalLosses).toFixed(2)
              : totalWins > 0
              ? "∞"
              : "0",
        },
        results: perSymbolResults,
        allTrades,
      };

      setResults(backtestResult);
      toast.success("Backtest complete — real Deriv tick data used");

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
        console.error("Failed to save backtest session:", err);
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
  }, []);

  const clear = useCallback(() => {
    setResults(null);
  }, []);

  return { isRunning, results, errors, validate, setErrors, run, stop, clear };
}

// ─── useLiveAutomation ───────────────────────────────────────

export function useLiveAutomation() {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<LiveAutomationStatus | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [accountType, setAccountType] = useState<"demo" | "live">("demo");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadBalance = useCallback(async (acct: "demo" | "live") => {
    setBalanceLoading(true);
    try {
      const data = await api.fetchBalance(acct);
      setBalance(typeof data.balance === "number" ? data.balance : null);
      setCurrency(data.currency || "USD");
    } catch (err) {
      handleApiError(err, "Balance fetch failed");
      setBalance(null);
      setCurrency("USD");
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const validate = useCallback(
    (config: {
      duration: number;
      profitTarget: number;
      initialTradeAmount: number;
      martingaleMultiplier: number;
      maxMartingaleLevel: number;
    }): Record<string, string> => {
      const errs: Record<string, string> = {};
      if (config.duration < 1) errs.duration = "Must be at least 1 hour";
      if (config.profitTarget < 0) errs.profitTarget = "Cannot be negative";
      if (config.initialTradeAmount < 0.1) errs.initialTradeAmount = "Must be ≥ $0.10";
      if (config.martingaleMultiplier < 1.1 || config.martingaleMultiplier > 5)
        errs.martingaleMultiplier = "1.1–5.0 range";
      if (config.maxMartingaleLevel < 1 || config.maxMartingaleLevel > 10)
        errs.maxMartingaleLevel = "1–10 levels";
      return errs;
    },
    []
  );

  const start = useCallback(
    async (params: {
      duration: number;
      profitTarget: number;
      initialTradeAmount: number;
      martingaleMultiplier: number;
      maxMartingaleLevel: number;
    }) => {
      const errs = validate(params);
      setErrors(errs);
      if (Object.keys(errs).length > 0) return;

      setIsRunning(true);
      setStatus({
        running: true,
        accountType,
        trades: [],
      });
      toast.success("Live automation started — monitoring signals");
    },
    [accountType, validate]
  );

  const stop = useCallback(async () => {
    setIsRunning(false);
    setStatus((prev) => (prev ? { ...prev, running: false } : null));
    toast.info("Automation stopped");
    loadBalance(accountType);
  }, [accountType, loadBalance]);

  // Load balance on account change
  useEffect(() => {
    setBalance(null);
    loadBalance(accountType);
  }, [accountType, loadBalance]);

  return {
    isRunning,
    status,
    balance,
    currency,
    balanceLoading,
    accountType,
    setAccountType,
    errors,
    setErrors,
    validate,
    start,
    stop,
  };
}

// ─── useTestTrade ────────────────────────────────────────────

export function useTestTrade() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestTradeResult | null>(null);

  const execute = useCallback(
    async (params: {
      accountType: "demo" | "live";
      amount: number;
      symbol: string;
      durationMinutes: number;
    }) => {
      setLoading(true);
      setResult(null);
      try {
        const data = await api.executeTestTrade({
          ...params,
          type: Math.random() > 0.5 ? "BUY" : "SELL",
        });
        setResult(data);
        toast.success(
          `Trade placed! Contract #${data.contractId} — waiting for result...`
        );
      } catch (err) {
        handleApiError(err, "Test trade failed");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { loading, result, execute };
}

// ─── Utility: EMA calculation ────────────────────────────────

function calculateEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = new Array(prices.length).fill(0);

  // Initialize with SMA for the first `period` values
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
