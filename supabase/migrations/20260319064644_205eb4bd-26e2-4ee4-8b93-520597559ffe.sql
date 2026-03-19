
CREATE TABLE public.engine_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.engine_secrets ENABLE ROW LEVEL SECURITY;
-- No public policies = only service_role can access (edge functions)
