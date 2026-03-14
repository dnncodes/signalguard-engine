import { supabase } from "@/integrations/supabase/client";
import {
  ApiError,
  type Signal,
  type MarketStatus,
  type BacktestParams,
  type BacktestResult,
  type TestTradeResult,
  type BalanceResponse,
} from "@/types/engine";

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
  if (data.error) {
    throw new ApiError(data.error, "SERVER_ERROR");
  }
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
  // Use edge function to get active symbols from Deriv
  try {
    const symbols = await callEdgeFunction<any[]>("active_symbols");
    return symbols.map((s: any) => ({
      symbol: s.symbol,
      name: s.display_name || s.symbol,
      candles: 0,
      lastPrice: s.spot || 0,
    }));
  } catch {
    // Fallback: return empty
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

  return {
    balance: data.balance,
    currency: data.currency,
  };
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

export async function sellContract(contractId: number): Promise<{
  success: boolean;
  sold_for: number;
  balance_after: number;
}> {
  return callEdgeFunction("sell", {
    method: "POST",
    body: { contract_id: contractId, price: 0 },
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
    result: "PENDING" as any, // Contract is now open, result comes later
    profit: 0,
    symbol: params.symbol,
    type: params.type,
    amount: result.buy_price,
    durationMinutes: params.durationMinutes,
    currency: "USD",
  };
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

export async function saveBacktestSession(session: {
  symbols: string[];
  duration_hours: number;
  timeframe_minutes: number;
  initial_balance: number;
  initial_trade_amount: number;
  martingale_multiplier: number;
  max_martingale_level: number;
  profit_target?: number;
  total_trades?: number;
  total_wins?: number;
  total_losses?: number;
  win_rate?: string;
  final_balance?: number;
  net_profit?: number;
  is_profitable?: boolean;
  max_drawdown?: string;
  profit_factor?: string;
  stop_reason?: string;
  results?: any;
}): Promise<string> {
  const { data, error } = await supabase
    .from("backtest_sessions")
    .insert(session as any)
    .select("id")
    .single();

  if (error) throw new ApiError(`Failed to save backtest: ${error.message}`, "SERVER_ERROR");
  return data.id;
}

// Keep legacy function signatures for backward compatibility
export async function runBacktest(
  params: BacktestParams,
  signal?: AbortSignal
): Promise<BacktestResult> {
  // Backtesting is done client-side using WebSocket tick data
  // This is a placeholder — the actual backtest logic runs in the hook
  throw new ApiError("Use the WebSocket-based backtest engine", "UNKNOWN");
}

export async function stopBacktest(): Promise<void> {
  // No-op, handled client-side
}

export async function startLiveAutomation(params: any): Promise<void> {
  throw new ApiError("Live automation uses the WebSocket engine directly", "UNKNOWN");
}

export async function fetchLiveStatus(): Promise<any> {
  throw new ApiError("Use WebSocket for live status", "UNKNOWN");
}

export async function stopLiveAutomation(): Promise<void> {
  // No-op
}
