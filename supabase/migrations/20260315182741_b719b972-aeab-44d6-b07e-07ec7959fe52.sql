
-- Allow deleting trade logs
CREATE POLICY "Anyone can delete trade logs"
ON public.trade_logs
FOR DELETE
TO public
USING (true);

-- Allow deleting backtest sessions
CREATE POLICY "Anyone can delete backtest sessions"
ON public.backtest_sessions
FOR DELETE
TO public
USING (true);
