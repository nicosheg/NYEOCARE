-- NYEOCARE: simple attendance finalization with a server-owned deadline.
-- A session stays live when every browser closes. The database finalizes it at
-- the earlier of 24 hours from start or 23:59 in the organization's local day.
-- Automatically unmarked people are recorded as not present, not as a reason
-- for care follow-up. Attendance-based care interpretation remains disabled.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS auto_close_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_close_reason text,
  ADD COLUMN IF NOT EXISTS closure_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sessions_auto_close_reason_check') THEN
    ALTER TABLE public.sessions ADD CONSTRAINT sessions_auto_close_reason_check
      CHECK (auto_close_reason IS NULL OR auto_close_reason IN ('24h','end_of_day'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sessions_closure_reason_check') THEN
    ALTER TABLE public.sessions ADD CONSTRAINT sessions_closure_reason_check
      CHECK (closure_reason IS NULL OR closure_reason IN ('manual_confirmation','auto_24h','auto_23_59'));
  END IF;
END $$;

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'operator';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='attendance_records_source_check') THEN
    ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_source_check
      CHECK (source IN ('operator','manual_close','auto_close','offline_sync_reconciled','admin_correction'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.attendance_session_roster (
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  person_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'session_start'
    CHECK (source IN ('session_start','attendance_visitor')),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,session_id,person_id),
  FOREIGN KEY (organization_id,session_id)
    REFERENCES public.sessions(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,person_id)
    REFERENCES public.people(organization_id,id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS attendance_session_roster_person_idx
  ON public.attendance_session_roster(organization_id,person_id);
CREATE INDEX IF NOT EXISTS sessions_auto_close_due_idx
  ON public.sessions(auto_close_at,id)
  WHERE status='active' AND auto_close_at IS NOT NULL;

ALTER TABLE public.attendance_session_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_session_roster FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendance_session_roster FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_session_roster TO postgres;
GRANT SELECT, INSERT ON TABLE public.attendance_session_roster TO service_role;

COMMENT ON TABLE public.attendance_session_roster IS
  'Immutable-at-session-start population snapshot plus people added as visitors during the live event. Used only to finalize the event register.';
COMMENT ON COLUMN public.sessions.auto_close_at IS
  'Server-owned deadline: earlier of 24 hours after session start or 23:59 in the organization time zone.';
COMMENT ON COLUMN public.sessions.closure_reason IS
  'How the event register was finalized. Automatic closure is not human verification or a care diagnosis.';
COMMENT ON COLUMN public.attendance_records.source IS
  'Provenance for attendance marks, including automatic deadline finalization and later offline reconciliation.';

CREATE OR REPLACE FUNCTION public.nyeocare_finalize_attendance_session(
  p_session_id uuid,
  p_reason text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pgmq
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_timezone text;
  v_event_date date;
  v_now timestamptz := clock_timestamp();
  v_total integer := 0;
BEGIN
  IF p_reason NOT IN ('manual_confirmation','auto_24h','auto_23_59') THEN
    RAISE EXCEPTION 'Unsupported attendance closure reason';
  END IF;

  SELECT s.*
  INTO v_session
  FROM public.sessions s
  WHERE s.id=p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.status <> 'active' THEN
    RETURN false;
  END IF;

  IF p_reason <> 'manual_confirmation'
     AND (v_session.auto_close_at IS NULL OR v_session.auto_close_at > v_now) THEN
    RETURN false;
  END IF;

  IF p_actor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id=p_actor_id AND u.organization_id=v_session.organization_id
  ) THEN
    RAISE EXCEPTION 'Attendance reviewer does not belong to this organization';
  END IF;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_catalog.pg_timezone_names z
      WHERE z.name=COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos')
    ) THEN COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos')
    ELSE 'Africa/Lagos'
  END
  INTO v_timezone
  FROM public.organizations o
  WHERE o.id=v_session.organization_id;

  v_event_date := (v_session.started_at AT TIME ZONE COALESCE(v_timezone,'Africa/Lagos'))::date;

  -- Existing explicit present/not-present marks become final. A manual
  -- confirmation records the reviewer; a deadline closure does not invent one.
  UPDATE public.attendance_records ar
  SET confirmed=true,
      reviewed_by=CASE WHEN p_actor_id IS NULL THEN ar.reviewed_by ELSE p_actor_id END,
      reviewed_at=CASE WHEN p_actor_id IS NULL THEN ar.reviewed_at ELSE COALESCE(ar.reviewed_at,v_now) END,
      status=CASE WHEN ar.present THEN 'present' ELSE 'not_present' END
  WHERE ar.organization_id=v_session.organization_id
    AND ar.session_id=v_session.id
    AND ar.confirmed=false;

  -- Only the population captured when the session started (plus visitors added
  -- during that session) can receive an automatic not-present record.
  INSERT INTO public.attendance_records(
    organization_id,people_id,attendance_date,present,session_id,
    marked_by,marked_at,status,confirmed,reviewed_by,reviewed_at,source
  )
  SELECT r.organization_id,r.person_id,v_event_date,false,v_session.id,
         NULL,v_now,'not_present',true,p_actor_id,
         CASE WHEN p_actor_id IS NULL THEN NULL ELSE v_now END,
         CASE WHEN p_actor_id IS NULL THEN 'auto_close' ELSE 'manual_close' END
  FROM public.attendance_session_roster r
  WHERE r.organization_id=v_session.organization_id
    AND r.session_id=v_session.id
    AND NOT EXISTS (
      SELECT 1 FROM public.attendance_records ar
      WHERE ar.organization_id=r.organization_id
        AND ar.session_id=r.session_id
        AND ar.people_id=r.person_id
        AND ar.present=true
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.attendance_records ar
      WHERE ar.organization_id=r.organization_id
        AND ar.session_id=r.session_id
        AND ar.people_id=r.person_id
    )
  ON CONFLICT (organization_id,people_id,session_id)
    WHERE session_id IS NOT NULL DO NOTHING;

  SELECT COUNT(*)::int INTO v_total
  FROM public.people p
  WHERE p.organization_id=v_session.organization_id
    AND COALESCE(p.status,'active')='active';

  UPDATE public.sessions
  SET status='closed',
      closed_by=p_actor_id,
      closed_at=v_now,
      closure_reason=p_reason,
      absence_meaningful=false,
      register_completeness=CASE WHEN p_actor_id IS NULL THEN 'unconfirmed' ELSE 'complete' END,
      register_source=CASE WHEN p_actor_id IS NULL THEN NULL ELSE 'digital_roster' END,
      register_reviewed_at=CASE WHEN p_actor_id IS NULL THEN NULL ELSE v_now END,
      register_reviewed_by=p_actor_id,
      register_review_note=CASE
        WHEN p_actor_id IS NULL THEN 'Automatically saved at the attendance deadline. Unmarked entries are recorded as not present; this does not establish why they were not recorded.'
        ELSE 'Operator confirmed that attendance had been fully checked before saving.'
      END,
      aria_processing_status='pending',
      aria_processing_attempts=0,
      aria_processing_stage='persist',
      aria_processing_progress=0,
      aria_processing_processed=0,
      aria_processing_total=v_total,
      aria_processing_completed_at=NULL,
      aria_processing_error=NULL,
      aria_processing_started_at=NULL,
      aria_processing_heartbeat_at=NULL
  WHERE id=v_session.id
    AND organization_id=v_session.organization_id
    AND status='active';

  INSERT INTO public.attendance_register_events(
    organization_id,session_id,register_completeness,register_source,note,actor_id,recorded_at
  )
  VALUES(
    v_session.organization_id,
    v_session.id,
    CASE WHEN p_actor_id IS NULL THEN 'unconfirmed' ELSE 'complete' END,
    CASE WHEN p_actor_id IS NULL THEN NULL ELSE 'digital_roster' END,
    CASE
      WHEN p_actor_id IS NULL THEN 'Automatic deadline finalization; unmarked people were recorded as not present, without an inference about why.'
      ELSE 'Operator confirmed completion of the attendance list.'
    END,
    p_actor_id,
    v_now
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.nyeocare_finalize_attendance_session(uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nyeocare_finalize_attendance_session(uuid,text,uuid) TO postgres;

CREATE OR REPLACE FUNCTION public.nyeocare_auto_close_attendance_sessions(p_limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pgmq
AS $$
DECLARE
  v_session record;
  v_reason text;
  v_closed integer := 0;
BEGIN
  FOR v_session IN
    SELECT s.id,s.organization_id,s.auto_close_reason
    FROM public.sessions s
    WHERE s.status='active'
      AND s.auto_close_at IS NOT NULL
      AND s.auto_close_at <= clock_timestamp()
    ORDER BY s.auto_close_at,s.id
    LIMIT GREATEST(1,LEAST(COALESCE(p_limit,50),200))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_reason := CASE
      WHEN v_session.auto_close_reason='end_of_day' THEN 'auto_23_59'
      ELSE 'auto_24h'
    END;

    IF public.nyeocare_finalize_attendance_session(v_session.id,v_reason,NULL) THEN
      PERFORM pgmq.send(
        'nyeocare-attendance',
        jsonb_build_object(
          'organization_id',v_session.organization_id,
          'session_id',v_session.id,
          'actor_id',NULL,
          'stage','persist',
          'enqueued_at',clock_timestamp()
        )
      );
      v_closed := v_closed + 1;
    END IF;
  END LOOP;

  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.nyeocare_auto_close_attendance_sessions(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nyeocare_auto_close_attendance_sessions(integer) TO postgres;

-- pg_cron executes in the database; no browser or phone needs to remain open.
SELECT cron.schedule(
  'nyeocare-attendance-auto-close',
  '1 second',
  'SELECT public.nyeocare_auto_close_attendance_sessions(50);'
);
