-- Create signals table for persistent signal history
CREATE TABLE public.signals (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
  price NUMERIC NOT NULL,
  time TIMESTAMPTZ NOT NULL DEFAULT now(),
  details TEXT,
  score NUMERIC,
  metrics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create trade_logs table for persistent trade history
CREATE TABLE public.trade_logs (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  trade_type TEXT NOT NULL CHECK (trade_type IN ('BUY', 'SELL')),
  contract_type TEXT NOT NULL DEFAULT 'CALL',
  amount NUMERIC NOT NULL,
  entry_price NUMERIC,
  exit_price NUMERIC,
  profit NUMERIC,
  result TEXT CHECK (result IN ('WIN', 'LOSS', 'PENDING', 'ERROR')),
  contract_id BIGINT,
  transaction_id BIGINT,
  balance_after NUMERIC,
  duration_minutes INTEGER,
  account_type TEXT NOT NULL DEFAULT 'demo' CHECK (account_type IN ('demo', 'live')),
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'backtest', 'automation', 'test')),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create backtest_sessions table
CREATE TABLE public.backtest_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbols TEXT[] NOT NULL,
  duration_hours INTEGER NOT NULL,
  timeframe_minutes INTEGER NOT NULL,
  initial_balance NUMERIC NOT NULL,
  initial_trade_amount NUMERIC NOT NULL,
  martingale_multiplier NUMERIC NOT NULL,
  max_martingale_level INTEGER NOT NULL,
  profit_target NUMERIC,
  total_trades INTEGER,
  total_wins INTEGER,
  total_losses INTEGER,
  win_rate TEXT,
  final_balance NUMERIC,
  net_profit NUMERIC,
  is_profitable BOOLEAN,
  max_drawdown TEXT,
  profit_factor TEXT,
  stop_reason TEXT,
  results JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_sessions ENABLE ROW LEVEL SECURITY;

-- Signals are publicly readable
CREATE POLICY "Signals are publicly readable" ON public.signals
  FOR SELECT USING (true);
CREATE POLICY "Anyone can insert signals" ON public.signals
  FOR INSERT WITH CHECK (true);

-- Trade logs are publicly readable
CREATE POLICY "Trade logs are publicly readable" ON public.trade_logs
  FOR SELECT USING (true);
CREATE POLICY "Anyone can insert trade logs" ON public.trade_logs
  FOR INSERT WITH CHECK (true);

-- Backtest sessions are publicly readable
CREATE POLICY "Backtest sessions are publicly readable" ON public.backtest_sessions
  FOR SELECT USING (true);
CREATE POLICY "Anyone can insert backtest sessions" ON public.backtest_sessions
  FOR INSERT WITH CHECK (true);

-- Enable realtime for signals table
ALTER PUBLICATION supabase_realtime ADD TABLE public.signals;

-- Create indexes for performance
CREATE INDEX idx_signals_time ON public.signals (time DESC);
CREATE INDEX idx_signals_symbol ON public.signals (symbol);
CREATE INDEX idx_trade_logs_created ON public.trade_logs (created_at DESC);
CREATE INDEX idx_trade_logs_source ON public.trade_logs (source);
CREATE INDEX idx_backtest_sessions_created ON public.backtest_sessions (created_at DESC);