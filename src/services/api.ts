import { supabase } from "@/integrations/supabase/client";
import {
  ApiError,
  type Signal,
  type MarketStatus,
  type TestTradeResult,
  type BalanceResponse,
  SYMBOLS,
} from "@/types/engine";
import type { SignalCandidate } from "./signalEngine";

// ─── Edge Function Caller ────────────────────────────────────

async function callEdgeFunction<T>(
  action: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    queryParams?: Record<string, string>;
  }
): Promise<T> {
  const params = new URLSearchParams({ action, ...options?.queryParams });
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deriv-trading?${params}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };

  const res = await fetch(url, {
    method: options?.method || "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "No response body");
    let errorMsg: string;
    try {
      const json = JSON.parse(text);
      errorMsg = json.error || text;
    } catch {
      errorMsg = text;
    }
    throw new ApiError(
      `Edge function error (${res.status}): ${errorMsg}`,
      "SERVER_ERROR",
      res.status
    );
  }

  const data = await res.json();
  if (data.error) throw new ApiError(data.error, "SERVER_ERROR");
  return data as T;
}

// ─── Public API ──────────────────────────────────────────────

export async function fetchSignals(): Promise<Signal[]> {
  const { data, error } = await supabase
    .from("signals")
    .select("*")
    .order("time", { ascending: false })
    .limit(10);

  if (error) throw new ApiError(`Failed to fetch signals: ${error.message}`, "SERVER_ERROR");
  return (data || []).map((s: any) => ({
    id: s.id,
    symbol: s.symbol,
    type: s.type as "BUY" | "SELL",
    price: Number(s.price),
    time: s.time,
    details: s.details || "",
    score: s.score ? Number(s.score) : undefined,
    metrics: s.metrics ? JSON.stringify(s.metrics) : undefined,
  }));
}

export async function fetchMarketStatus(): Promise<MarketStatus[]> {
  try {
    const symbols = await callEdgeFunction<any[]>("active_symbols");
    return symbols
      .filter((s: any) => SYMBOLS[s.symbol])
      .map((s: any) => ({
        symbol: s.symbol,
        name: s.display_name || SYMBOLS[s.symbol] || s.symbol,
        candles: 0,
        lastPrice: s.spot || 0,
      }));
  } catch {
    return [];
  }
}

export async function fetchBalance(
  _accountType: "demo" | "live"
): Promise<BalanceResponse> {
  const data = await callEdgeFunction<{
    balance: number;
    currency: string;
    loginid: string;
  }>("balance");
  return { balance: data.balance, currency: data.currency };
}

export async function executeTrade(params: {
  symbol: string;
  amount: number;
  contractType: string;
  duration: number;
  durationUnit: string;
  source: string;
}): Promise<{
  success: boolean;
  contract_id: number;
  buy_price: number;
  payout: number;
  balance_after: number;
  longcode: string;
}> {
  return callEdgeFunction("buy", {
    method: "POST",
    body: {
      symbol: params.symbol,
      amount: params.amount,
      contract_type: params.contractType,
      duration: params.duration,
      duration_unit: params.durationUnit,
      source: params.source,
    },
  });
}

export async function settleContract(contractId: number): Promise<{
  settled: boolean;
  profit?: number;
  status: string;
  sold_for?: number;
  balance_after?: number;
}> {
  return callEdgeFunction("settle", {
    method: "POST",
    body: { contract_id: contractId },
  });
}

export async function checkContractStatus(contractId: number): Promise<any> {
  return callEdgeFunction("contract_status", {
    method: "POST",
    body: { contract_id: contractId },
  });
}

export async function executeTestTrade(params: {
  accountType: "demo" | "live";
  amount: number;
  symbol: string;
  type: "BUY" | "SELL";
  durationMinutes: number;
}): Promise<TestTradeResult> {
  const contractType = params.type === "BUY" ? "CALL" : "PUT";

  const result = await callEdgeFunction<{
    success: boolean;
    contract_id: number;
    buy_price: number;
    payout: number;
    balance_after: number;
    longcode: string;
  }>("buy", {
    method: "POST",
    body: {
      symbol: params.symbol,
      amount: params.amount,
      contract_type: contractType,
      duration: params.durationMinutes,
      duration_unit: "m",
      source: "test",
    },
  });

  return {
    contractId: result.contract_id,
    result: "PENDING",
    profit: 0,
    symbol: params.symbol,
    type: params.type,
    amount: result.buy_price,
    durationMinutes: params.durationMinutes,
    currency: "USD",
  };
}

// ─── Telegram Signal Push ────────────────────────────────────

export async function sendTelegramSignal(signal: SignalCandidate): Promise<void> {
  try {
    await callEdgeFunction("telegram_signal", {
      method: "POST",
      body: {
        symbol: signal.symbol,
        type: signal.type,
        price: signal.price,
        score: signal.score,
        details: signal.details,
      },
    });
  } catch (err) {
    console.warn("[Telegram] Signal push failed:", err);
  }
}

// ─── Database operations ─────────────────────────────────────

export async function insertSignal(signal: {
  symbol: string;
  type: "BUY" | "SELL";
  price: number;
  details: string;
  score?: number;
  metrics?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from("signals").insert({
    symbol: signal.symbol,
    type: signal.type,
    price: signal.price,
    details: signal.details,
    score: signal.score,
    metrics: signal.metrics as any,
  });
  if (error) throw new ApiError(`Failed to insert signal: ${error.message}`, "SERVER_ERROR");
}

export async function fetchTradeHistory(limit = 50): Promise<any[]> {
  const { data, error } = await supabase
    .from("trade_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ApiError(`Failed to fetch trade history: ${error.message}`, "SERVER_ERROR");
  return data || [];
}

export async function fetchBacktestSessions(limit = 10): Promise<any[]> {
  const { data, error } = await supabase
    .from("backtest_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ApiError(`Failed to fetch backtest sessions: ${error.message}`, "SERVER_ERROR");
  return data || [];
}

export async function saveBacktestSession(session: Record<string, any>): Promise<string> {
  const { data, error } = await supabase
    .from("backtest_sessions")
    .insert(session as any)
    .select("id")
    .single();
  if (error) throw new ApiError(`Failed to save backtest: ${error.message}`, "SERVER_ERROR");
  return data.id;
}
