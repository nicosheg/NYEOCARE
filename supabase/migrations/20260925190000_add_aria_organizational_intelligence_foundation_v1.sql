-- NYEOCARE ARIA organizational intelligence foundation v1
ALTER TABLE aria_events
  ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'observation',
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'observed',
  ADD COLUMN IF NOT EXISTS scope_level text NOT NULL DEFAULT 'organization',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS supersedes_event_id uuid,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_processing_error text;

UPDATE aria_events
SET processing_status='completed',processed_at=COALESCE(processed_at,created_at)
WHERE processing_status='pending';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aria_events_evidence_kind_check') THEN
    ALTER TABLE aria_events ADD CONSTRAINT aria_events_evidence_kind_check CHECK (evidence_kind IN ('fact','observation','human_report','inference','uncertainty'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aria_events_confidence_check') THEN
    ALTER TABLE aria_events ADD CONSTRAINT aria_events_confidence_check CHECK (confidence>=0 AND confidence<=1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aria_events_verification_status_check') THEN
    ALTER TABLE aria_events ADD CONSTRAINT aria_events_verification_status_check CHECK (verification_status IN ('verified','observed','reported','inferred','conflicted','unknown','stale'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aria_events_processing_status_check') THEN
    ALTER TABLE aria_events ADD CONSTRAINT aria_events_processing_status_check CHECK (processing_status IN ('pending','processing','completed','failed','skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS aria_events_processing_queue_idx ON aria_events (organization_id, processing_status, occurred_at ASC);
CREATE INDEX IF NOT EXISTS aria_events_org_scope_idx ON aria_events (organization_id, scope_level, occurred_at DESC);
CREATE INDEX IF NOT EXISTS aria_events_person_evidence_idx ON aria_events (organization_id, person_id, verification_status, occurred_at DESC);

ALTER TABLE organization_memory
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'human_report',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'reported',
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS source_event_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organization_memory_evidence_kind_check') THEN
    ALTER TABLE organization_memory ADD CONSTRAINT organization_memory_evidence_kind_check CHECK (evidence_kind IN ('fact','observation','human_report','inference','uncertainty'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organization_memory_verification_status_check') THEN
    ALTER TABLE organization_memory ADD CONSTRAINT organization_memory_verification_status_check CHECK (verification_status IN ('verified','observed','reported','inferred','conflicted','unknown','stale'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organization_memory_confidence_check') THEN
    ALTER TABLE organization_memory ADD CONSTRAINT organization_memory_confidence_check CHECK (confidence>=0 AND confidence<=1);
  END IF;
END $$;

ALTER TABLE organization_memory DROP CONSTRAINT IF EXISTS organization_memory_organization_id_memory_type_memory_key_key;
DROP INDEX IF EXISTS organization_memory_organization_id_memory_type_memory_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS organization_memory_current_key_unique ON organization_memory (organization_id,memory_type,memory_key) WHERE is_current=true;
CREATE INDEX IF NOT EXISTS organization_memory_validity_idx ON organization_memory (organization_id,is_current,valid_until,updated_at DESC);

ALTER TABLE person_memory
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'human_report',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'reported',
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid;

ALTER TABLE person_relationships
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'observation',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'observed',
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS source_event_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_relationships_confidence_check') THEN
    ALTER TABLE person_relationships ADD CONSTRAINT person_relationships_confidence_check CHECK (confidence>=0 AND confidence<=1);
  END IF;
END $$;

ALTER TABLE care_feedback
  ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'human_report',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'reported',
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_event_id uuid,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE intelligence_outcomes
  ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'observation',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'observed',
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_event_id uuid;

ALTER TABLE aria_learning
  ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'inference',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'reported',
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS actor_id uuid;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS event_kind text NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS event_scope text NOT NULL DEFAULT 'organization',
  ADD COLUMN IF NOT EXISTS group_id uuid,
  ADD COLUMN IF NOT EXISTS event_semantics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_population_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attendance_interpretation text NOT NULL DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS participation_expected boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS optional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS absence_meaningful boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sessions_event_scope_check') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_event_scope_check CHECK (event_scope IN ('organization','department','group','team','private'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sessions_attendance_interpretation_check') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_attendance_interpretation_check CHECK (attendance_interpretation IN ('neutral','participation','expected','optional','not_meaningful'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sessions_org_event_semantics_idx ON sessions (organization_id,event_kind,event_scope,started_at DESC);
CREATE INDEX IF NOT EXISTS person_memory_validity_idx ON person_memory (organization_id,person_id,is_current,valid_until,updated_at DESC);
CREATE INDEX IF NOT EXISTS person_relationships_current_idx ON person_relationships (organization_id,person_id,is_current,confidence DESC,updated_at DESC);
CREATE INDEX IF NOT EXISTS care_feedback_provenance_idx ON care_feedback (organization_id,person_id,evidence_kind,observed_at DESC);
CREATE INDEX IF NOT EXISTS intelligence_outcomes_provenance_idx ON intelligence_outcomes (organization_id,person_id,evidence_kind,observed_at DESC);
CREATE INDEX IF NOT EXISTS aria_learning_validity_idx ON aria_learning (organization_id,active,valid_until,updated_at DESC);
