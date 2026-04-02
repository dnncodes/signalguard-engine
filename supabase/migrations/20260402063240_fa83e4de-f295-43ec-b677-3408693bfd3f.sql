CREATE POLICY "Anyone can read engine secrets"
ON public.engine_secrets FOR SELECT USING (true);

CREATE POLICY "Anyone can insert engine secrets"
ON public.engine_secrets FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update engine secrets"
ON public.engine_secrets FOR UPDATE USING (true) WITH CHECK (true);