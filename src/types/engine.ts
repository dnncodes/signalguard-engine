/**
 * Verified Deriv synthetic index symbols — queried from active_symbols API.
 * 23 confirmed symbols that stream live ticks.
 */
export const SYMBOLS: Record<string, string> = {
  // Volatility Indices (1s tick)
  "1HZ10V": "Volatility 10 (1s) Index",
  "1HZ15V": "Volatility 15 (1s) Index",
  "1HZ25V": "Volatility 25 (1s) Index",
  "1HZ30V": "Volatility 30 (1s) Index",
  "1HZ50V": "Volatility 50 (1s) Index",
  "1HZ75V": "Volatility 75 (1s) Index",
  "1HZ90V": "Volatility 90 (1s) Index",
  "1HZ100V": "Volatility 100 (1s) Index",
  // Volatility Indices (standard)
  "R_10": "Volatility 10 Index",
  "R_25": "Volatility 25 Index",
  "R_50": "Volatility 50 Index",
  "R_75": "Volatility 75 Index",
  "R_100": "Volatility 100 Index",
  // Step Indices — CORRECT Deriv API symbols (verified via active_symbols)
  "stpRNG": "Step Index 100",
  "stpRNG2": "Step Index 200",
  "stpRNG3": "Step Index 300",
  "stpRNG4": "Step Index 400",
  "stpRNG5": "Step Index 500",
  // Jump Indices
  "JD10": "Jump 10 Index",
  "JD25": "Jump 25 Index",
  "JD50": "Jump 50 Index",
  "JD75": "Jump 75 Index",
  "JD100": "Jump 100 Index",
};

// Trade duration constants (in minutes)
export const TRADE_DURATION_LIVE = 4.75; // 4min 45s for live/manual — allows settlement buffer
export const TRADE_DURATION_BACKTEST = 5; // 5min for backtesting

export interface Signal {
  id: number;
  symbol: string;
  type: "BUY" | "SELL";
  price: number;
  time: string;
  details: string;
  score?: number;
  metrics?: string;
}

export interface MarketStatus {
  symbol: string;
  name: string;
  candles: number;
  lastPrice: number;
  prevPrice?: number;
  direction?: "up" | "down" | "neutral";
}

export interface BacktestTrade {
  executionTime: string;
  symbol: string;
  type: string;
  entryPrice: number;
  exitPrice: number;
  tradeAmount: number;
  result: "WIN" | "LOSS";
  newBalance: number;
  score: number;
  confidence?: number;
  martingaleLevel: number;
  pattern?: string | null;
  competingSymbols?: number;
}

export interface BacktestSymbolResult {
  symbol: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: string;
  finalBalance: string;
  netProfit: string;
  trades: BacktestTrade[];
}

export interface BacktestSummary {
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  winRate: string;
  finalBalance: string;
  initialBalance: string;
  totalNetProfit: string;
  isProfitable: boolean;
  maxDrawdown: string;
  profitFactor: string;
}

export interface BacktestResult {
  duration: number;
  timeframe: number;
  initialBalance: number;
  initialTradeAmount: number;
  martingaleMultiplier: number;
  maxMartingaleLevel?: number;
  stopReason?: "profitTarget" | "martingale" | null;
  summary: BacktestSummary;
  results: BacktestSymbolResult[];
  allTrades: BacktestTrade[];
}

export interface BacktestParams {
  symbol: string[];
  duration: number;
  timeframe: number;
  initialAmount: number;
  initialBalance: number;
  martingaleMultiplier: number;
  maxMartingaleLevel: number;
  profitTarget: number;
}

export interface LiveAutomationParams {
  accountType: "demo" | "live";
  durationHours: number;
  profitTarget: number;
  initialTradeAmount: number;
  martingaleMultiplier: number;
  maxMartingaleLevel: number;
  timeframeMinutes: number;
}

export interface LiveTrade {
  timestamp: string;
  signal?: { symbol: string; type: string };
  tradeAmount: number;
  result?: string;
  profit?: number;
  contractId?: number;
  status?: "PENDING" | "WON" | "LOST" | "SETTLED";
}

export interface LiveAutomationStatus {
  running: boolean;
  accountType: string;
  initialBalance?: number;
  currentBalance?: number;
  profitTargetReached?: boolean;
  martingaleStopped?: boolean;
  error?: string;
  trades?: LiveTrade[];
  totalProfit?: number;
  winCount?: number;
  lossCount?: number;
}

export interface TestTradeParams {
  accountType: "demo" | "live";
  amount: number;
  symbol: string;
  type: "BUY" | "SELL";
  durationMinutes: number;
}

export interface TestTradeResult {
  contractId: number;
  result: "WIN" | "LOSS" | "PENDING";
  profit: number;
  symbol: string;
  type: "BUY" | "SELL";
  amount: number;
  durationMinutes: number;
  currency: string;
}

export interface BalanceResponse {
  balance: number;
  currency: string;
}

export type ApiErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "SERVER_ERROR"
  | "PARSE_ERROR"
  | "ABORT"
  | "UNKNOWN";

export class ApiError extends Error {
  code: ApiErrorCode;
  status?: number;

  constructor(message: string, code: ApiErrorCode, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}
