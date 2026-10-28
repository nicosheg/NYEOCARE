-- Ensure the remaining RLS-enabled tables with no tenant column also
-- enforce their existing policies when accessed by their table owner.
BEGIN;
ALTER TABLE public.ai_provider_admission FORCE ROW LEVEL SECURITY;
ALTER TABLE public.aria_global_learning FORCE ROW LEVEL SECURITY;
ALTER TABLE public.aria_messages FORCE ROW LEVEL SECURITY;
COMMIT;
