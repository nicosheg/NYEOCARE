-- Attendance scale and idempotency indexes
-- Applied to production Supabase on 2026-09-20.

CREATE UNIQUE INDEX IF NOT EXISTS aria_observations_source_event_unique_idx
ON aria_observations (organization_id, (metadata->>'source_event_id'))
WHERE metadata ? 'source_event_id';

DROP INDEX IF EXISTS aria_observations_source_event_idx;

CREATE INDEX IF NOT EXISTS aria_observations_attendance_session_idx
ON aria_observations (organization_id, (metadata->>'session_id'))
WHERE metadata ? 'session_id';

CREATE INDEX IF NOT EXISTS aria_actions_attendance_session_idx
ON aria_actions (organization_id, (action_metadata->>'session_id'))
WHERE action_metadata ? 'session_id';

CREATE INDEX IF NOT EXISTS attendance_records_org_session_person_confirmed_idx
ON attendance_records (organization_id, session_id, people_id)
WHERE present = true AND confirmed = true;

CREATE INDEX IF NOT EXISTS people_org_status_name_trgm_active_idx
ON people USING gin ((coalesce(nullif(display_name, ''), coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) gin_trgm_ops)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS people_org_status_phone_trgm_active_idx
ON people USING gin ((coalesce(phone, '')) gin_trgm_ops)
WHERE status = 'active';


-- Large-organization query planning indexes
CREATE INDEX IF NOT EXISTS people_org_status_idx
ON people (organization_id,status,id);

CREATE INDEX IF NOT EXISTS people_active_name_order_idx
ON people (
 organization_id,
 (coalesce(nullif(display_name,''),coalesce(first_name,'')||' '||coalesce(last_name,''))),
 id
)
WHERE status='active';

CREATE INDEX IF NOT EXISTS participation_org_time_person_idx
ON participation_records (organization_id,occurred_at,person_id);

CREATE INDEX IF NOT EXISTS participation_org_person_time_idx
ON participation_records (organization_id,person_id,occurred_at);

CREATE INDEX IF NOT EXISTS care_context_org_person_kind_end_idx
ON aria_care_contexts (organization_id,person_id,kind,ends_on);

CREATE INDEX IF NOT EXISTS attendance_context_org_session_person_idx
ON aria_attendance_contexts (organization_id,session_id,person_id);
