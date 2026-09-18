-- Harden trigger function against search_path hijacking.
ALTER FUNCTION public.classify_aria_learning() SET search_path TO pg_catalog;
