CREATE POLICY "Anyone can update trade logs"
ON public.trade_logs
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);