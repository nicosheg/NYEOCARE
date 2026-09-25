-- NYEOCARE ARIA memory versioning v1
ALTER TABLE person_memory
  ADD COLUMN IF NOT EXISTS memory_key text,
  ADD COLUMN IF NOT EXISTS source_event_id uuid,
  ADD COLUMN IF NOT EXISTS scope_level text NOT NULL DEFAULT 'person';

UPDATE person_memory
SET memory_key=COALESCE(NULLIF(memory_key,''),lower(regexp_replace(memory_type,'[^a-z0-9]+','_','g')))
WHERE memory_key IS NULL OR memory_key='';

ALTER TABLE person_memory DROP CONSTRAINT IF EXISTS person_memory_org_person_type_key;
DROP INDEX IF EXISTS person_memory_org_person_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS person_memory_current_key_unique
  ON person_memory(organization_id,person_id,memory_type,memory_key)
  WHERE is_current=true;

ALTER TABLE person_relationships DROP CONSTRAINT IF EXISTS person_relationships_organization_id_person_id_related_pers_key;
DROP INDEX IF EXISTS person_relationships_organization_id_person_id_related_pers_key;
CREATE UNIQUE INDEX IF NOT EXISTS person_relationships_current_unique
  ON person_relationships(organization_id,person_id,related_person_id,relationship_type)
  WHERE is_current=true;

CREATE INDEX IF NOT EXISTS person_memory_source_event_idx
  ON person_memory(organization_id,person_id,source_event_id,updated_at DESC);
