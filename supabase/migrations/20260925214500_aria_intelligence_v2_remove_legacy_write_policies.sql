-- Remove legacy browser write policies left by earlier ARIA migrations.
DROP POLICY IF EXISTS person_memory_org_delete ON public.person_memory;
DROP POLICY IF EXISTS person_memory_org_insert ON public.person_memory;
DROP POLICY IF EXISTS person_memory_org_update ON public.person_memory;
DROP POLICY IF EXISTS person_relationships_org_delete ON public.person_relationships;
DROP POLICY IF EXISTS person_relationships_org_insert ON public.person_relationships;
DROP POLICY IF EXISTS person_relationships_org_update ON public.person_relationships;
DROP POLICY IF EXISTS intelligence_outcomes_org_delete ON public.intelligence_outcomes;
DROP POLICY IF EXISTS intelligence_outcomes_org_insert ON public.intelligence_outcomes;
DROP POLICY IF EXISTS intelligence_outcomes_org_update ON public.intelligence_outcomes;

-- Browser clients must not mutate server-owned intelligence.
