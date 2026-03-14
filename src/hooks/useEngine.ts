import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  type Signal,
  type MarketStatus,
  type BacktestResult,
  type LiveAutomationStatus,
  type TestTradeResult,
  ApiError,
} from "@/types/engine";
import * as api from "@/services/api";

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

// ─── useSignals ──────────────────────────────────────────────

export function useSignals(pollInterval = 5000) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [status, setStatus] = useState<MarketStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const [sigData, statData] = await Promise.all([
        api.fetchSignals(),
        api.fetchMarketStatus(),
      ]);
      if (!mountedRef.current) return;
      setSignals(sigData);
      setStatus(statData);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = handleApiError(err, "Market data fetch failed");
      setError(msg);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const interval = setInterval(fetchData, pollInterval);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData, pollInterval]);

  return { signals, status, loading, error, refetch: fetchData };
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
  const abortRef = useRef<AbortController | null>(null);

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

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsRunning(true);
    setResults(null);

    try {
      const data = await api.runBacktest(
        {
          symbol: config.symbols,
          duration: config.duration,
          timeframe: config.timeframe,
          initialAmount: config.initialTradeAmount,
          initialBalance: config.initialBalance,
          martingaleMultiplier: config.martingaleMultiplier,
          maxMartingaleLevel: config.maxMartingaleLevel,
          profitTarget: config.profitTarget,
        },
        controller.signal
      );
      setResults(data);
      toast.success("Backtest complete");
    } catch (err) {
      handleApiError(err, "Backtest failed");
    } finally {
      setIsRunning(false);
    }
  }, [validate]);

  const stop = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    try {
      await api.stopBacktest();
    } catch (err) {
      handleApiError(err, "Failed to stop backtest");
    }
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
      if (config.initialTradeAmount < 0.1)
        errs.initialTradeAmount = "Must be ≥ $0.10";
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
      setStatus(null);
      try {
        await api.startLiveAutomation({
          accountType,
          durationHours: params.duration,
          profitTarget: params.profitTarget,
          initialTradeAmount: params.initialTradeAmount,
          martingaleMultiplier: params.martingaleMultiplier,
          maxMartingaleLevel: params.maxMartingaleLevel,
          timeframeMinutes: 5,
        });
        toast.success("Live automation started");
      } catch (err) {
        handleApiError(err, "Failed to start automation");
        setIsRunning(false);
      }
    },
    [accountType, validate]
  );

  const stop = useCallback(async () => {
    try {
      await api.stopLiveAutomation();
      toast.info("Automation stopped");
    } catch (err) {
      handleApiError(err, "Failed to stop automation");
    }
    setIsRunning(false);
    loadBalance(accountType);
  }, [accountType, loadBalance]);

  // Poll live status
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(async () => {
      try {
        const data = await api.fetchLiveStatus();
        setStatus(data);
        if (!data.running) {
          setIsRunning(false);
          loadBalance(accountType);
          if (data.profitTargetReached) toast.success("Profit target reached!");
          if (data.martingaleStopped) toast.warning("Max martingale loss — stopped");
          if (data.error) toast.error(`Automation error: ${data.error}`);
        }
      } catch (err) {
        console.error("Live status poll error:", err);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isRunning, accountType, loadBalance]);

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
        toast[data.result === "WIN" ? "success" : "error"](
          `Test trade ${data.result}: ${data.profit >= 0 ? "+" : ""}$${data.profit.toFixed(2)}`
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
