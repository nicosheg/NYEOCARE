BEGIN;

-- The incremental attendance feed relies on updated_at to discover edits made
-- through any code path (manual edits, scans, ARIA, or future features).
-- Keep this at the database layer so callers cannot forget to bump the cursor.
DROP TRIGGER IF EXISTS people_set_updated_at ON public.people;
CREATE TRIGGER people_set_updated_at
  BEFORE UPDATE ON public.people
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMIT;
