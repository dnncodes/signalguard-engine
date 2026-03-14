import {
  ApiError,
  type Signal,
  type MarketStatus,
  type BacktestParams,
  type BacktestResult,
  type LiveAutomationParams,
  type LiveAutomationStatus,
  type TestTradeParams,
  type TestTradeResult,
  type BalanceResponse,
} from "@/types/engine";

const API_BASE = "/api";
const DEFAULT_TIMEOUT = 15_000;
const LONG_TIMEOUT = 120_000;

interface FetchOptions {
  timeout?: number;
  signal?: AbortSignal;
  retries?: number;
  retryDelay?: number;
}

async function safeFetch<T>(
  url: string,
  init?: RequestInit,
  options: FetchOptions = {}
): Promise<T> {
  const {
    timeout = DEFAULT_TIMEOUT,
    signal: externalSignal,
    retries = 0,
    retryDelay = 1000,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine external signal with timeout
    const combinedSignal = externalSignal
      ? anySignal([externalSignal, controller.signal])
      : controller.signal;

    try {
      const res = await fetch(url, { ...init, signal: combinedSignal });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "No response body");
        throw new ApiError(
          `Server error: ${res.status} ${res.statusText} — ${errorBody}`,
          "SERVER_ERROR",
          res.status
        );
      }

      const contentType = res.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        throw new ApiError(
          "Server returned non-JSON response. It may still be starting up.",
          "PARSE_ERROR"
        );
      }

      const data = await res.json();

      // Check for application-level errors
      if (data && typeof data === "object" && "error" in data && data.error) {
        throw new ApiError(String(data.error), "SERVER_ERROR");
      }

      return data as T;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof ApiError) {
        lastError = err;
      } else if (err instanceof DOMException && err.name === "AbortError") {
        if (externalSignal?.aborted) {
          throw new ApiError("Request aborted", "ABORT");
        }
        lastError = new ApiError("Request timed out", "TIMEOUT");
      } else if (err instanceof TypeError) {
        // Network errors (DNS, CORS, offline)
        lastError = new ApiError(
          `Network error: ${err.message}`,
          "NETWORK_ERROR"
        );
      } else {
        lastError = new ApiError(
          err instanceof Error ? err.message : "Unknown error",
          "UNKNOWN"
        );
      }

      // Don't retry aborted requests or client errors
      if (
        lastError instanceof ApiError &&
        (lastError.code === "ABORT" ||
          (lastError.status && lastError.status >= 400 && lastError.status < 500))
      ) {
        throw lastError;
      }

      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new ApiError("Request failed", "UNKNOWN");
}

/** Combine multiple AbortSignals into one */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

// ─── Public API ──────────────────────────────────────────────

export async function fetchSignals(): Promise<Signal[]> {
  const data = await safeFetch<Signal[]>(`${API_BASE}/signals`, undefined, {
    retries: 2,
    retryDelay: 2000,
  });
  return data.sort((a, b) => b.id - a.id).slice(0, 10);
}

export async function fetchMarketStatus(): Promise<MarketStatus[]> {
  return safeFetch<MarketStatus[]>(`${API_BASE}/status`, undefined, {
    retries: 2,
    retryDelay: 2000,
  });
}

export async function runBacktest(
  params: BacktestParams,
  signal?: AbortSignal
): Promise<BacktestResult> {
  return safeFetch<BacktestResult>(
    `${API_BASE}/backtest`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    { timeout: LONG_TIMEOUT, signal }
  );
}

export async function stopBacktest(): Promise<void> {
  await safeFetch<{ ok: boolean }>(`${API_BASE}/backtest/stop`, {
    method: "POST",
  });
}

export async function startLiveAutomation(
  params: LiveAutomationParams
): Promise<void> {
  await safeFetch<{ ok: boolean }>(
    `${API_BASE}/live-automation`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    { timeout: 30_000 }
  );
}

export async function fetchLiveStatus(): Promise<LiveAutomationStatus> {
  return safeFetch<LiveAutomationStatus>(`${API_BASE}/live/status`);
}

export async function stopLiveAutomation(): Promise<void> {
  await safeFetch<{ ok: boolean }>(`${API_BASE}/live/stop`, {
    method: "POST",
  });
}

export async function executeTestTrade(
  params: TestTradeParams
): Promise<TestTradeResult> {
  return safeFetch<TestTradeResult>(
    `${API_BASE}/test-trade`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    { timeout: 60_000 }
  );
}

export async function fetchBalance(
  accountType: "demo" | "live"
): Promise<BalanceResponse> {
  return safeFetch<BalanceResponse>(
    `${API_BASE}/balance?account=${accountType}`,
    undefined,
    { retries: 1 }
  );
}
