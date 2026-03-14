/**
 * Verified Deriv synthetic index symbols with real-time data.
 * 20 confirmed symbols that stream live ticks.
 */
export const SYMBOLS: Record<string, string> = {
  "1HZ10V": "Volatility 10 (1s) Index",
  "R_10": "Volatility 10 Index",
  "1HZ15V": "Volatility 15 (1s) Index",
  "1HZ25V": "Volatility 25 (1s) Index",
  "R_25": "Volatility 25 Index",
  "1HZ30V": "Volatility 30 (1s) Index",
  "1HZ50V": "Volatility 50 (1s) Index",
  "R_50": "Volatility 50 Index",
  "1HZ75V": "Volatility 75 (1s) Index",
  "R_75": "Volatility 75 Index",
  "1HZ90V": "Volatility 90 (1s) Index",
  "1HZ100V": "Volatility 100 (1s) Index",
  "R_100": "Volatility 100 Index",
  "BOOM500": "Boom 500 Index",
  "BOOM1000": "Boom 1000 Index",
  "CRASH500": "Crash 500 Index",
  "CRASH1000": "Crash 1000 Index",
  "JD10": "Jump 10 Index",
  "JD25": "Jump 25 Index",
  "JD50": "Jump 50 Index",
};

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
