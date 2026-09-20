-- Run independent attendance jobs concurrently while serializing each session.
CREATE OR REPLACE FUNCTION public.nyeocare_process_attendance_queue(p_batch_size integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SET search_path=public,pg_catalog
AS $function$
DECLARE
  v_message record;
  v_msg jsonb;
  v_session uuid;
  v_org text;
  v_stage text;
  v_next text;
  v_processed integer := 0;
  v_delay integer;
  v_attempt integer;
  v_locked boolean;
BEGIN
  FOR v_message IN
    SELECT * FROM pgmq.read(
      'nyeocare-attendance',
      300,
      GREATEST(1,LEAST(2,p_batch_size))
    )
  LOOP
    v_msg:=v_message.message;
    v_session:=NULLIF(v_msg->>'session_id','')::uuid;
    v_org:=NULLIF(v_msg->>'organization_id','');
    v_stage:=COALESCE(NULLIF(v_msg->>'stage',''),'persist');
    v_attempt:=GREATEST(1,COALESCE(v_message.read_ct,1));

    BEGIN
      IF v_session IS NULL OR v_org IS NULL THEN
        PERFORM pgmq.delete('nyeocare-attendance',v_message.msg_id);
        CONTINUE;
      END IF;

      v_locked:=pg_try_advisory_xact_lock(hashtextextended(v_session::text,0));
      IF NOT v_locked THEN
        PERFORM pgmq.set_vt('nyeocare-attendance',v_message.msg_id,10);
        CONTINUE;
      END IF;

      UPDATE public.sessions
      SET aria_processing_started_at=COALESCE(aria_processing_started_at,NOW()),
          aria_processing_status='processing',
          aria_processing_stage=v_stage,
          aria_processing_attempts=v_attempt,
          aria_processing_heartbeat_at=NOW(),
          aria_processing_error=NULL
      WHERE id=v_session AND organization_id=v_org AND status='closed';

      IF v_stage='persist' THEN v_next:='return_signals';
      ELSIF v_stage='return_signals' THEN v_next:='absence_signals';
      ELSIF v_stage='absence_signals' THEN v_next:='engagement';
      ELSIF v_stage='engagement' THEN v_next:='relationship';
      ELSIF v_stage='relationship' THEN v_next:='people_intelligence';
      ELSIF v_stage='people_intelligence' THEN v_next:='person_state';
      ELSIF v_stage='person_state' THEN v_next:='complete';
      ELSIF v_stage='complete' THEN v_next:=NULL;
      ELSE RAISE EXCEPTION 'Invalid attendance processing stage: %',v_stage;
      END IF;

      PERFORM public.nyeocare_attendance_stage(v_session,v_org,v_stage);

      IF v_next IS NULL THEN
        PERFORM pgmq.archive('nyeocare-attendance',v_message.msg_id);
      ELSE
        PERFORM pgmq.send(
          'nyeocare-attendance',
          jsonb_build_object(
            'organization_id',v_org,
            'session_id',v_session::text,
            'actor_id',v_msg->>'actor_id',
            'stage',v_next,
            'enqueued_at',NOW()
          )
        );
        PERFORM pgmq.archive('nyeocare-attendance',v_message.msg_id);
      END IF;

      v_processed:=v_processed+1;

    EXCEPTION WHEN OTHERS THEN
      IF v_attempt>=8 THEN
        UPDATE public.sessions
        SET aria_processing_status='needs_attention',
            aria_processing_error='ARIA paused after automatic recovery attempts. Attendance is safe; the intelligence update needs engineering attention.',
            aria_processing_stage=v_stage,
            aria_processing_attempts=v_attempt,
            aria_processing_heartbeat_at=NOW()
        WHERE id=v_session AND organization_id=v_org AND status='closed';

        PERFORM pgmq.archive('nyeocare-attendance',v_message.msg_id);
        v_processed:=v_processed+1;
      ELSE
        v_delay:=LEAST(
          300,
          GREATEST(
            10,
            (30*power(2,LEAST(GREATEST(v_attempt-1,0),4)))::int
          )
        );

        UPDATE public.sessions
        SET aria_processing_status='processing',
            aria_processing_error='ARIA is continuing automatically in the background.',
            aria_processing_stage=v_stage,
            aria_processing_attempts=v_attempt,
            aria_processing_heartbeat_at=NOW()
        WHERE id=v_session AND organization_id=v_org AND status='closed';

        PERFORM pgmq.set_vt('nyeocare-attendance',v_message.msg_id,v_delay);
      END IF;
    END;
  END LOOP;

  RETURN v_processed;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.nyeocare_process_attendance_queue(integer) FROM PUBLIC,anon,authenticated;

DO $cron$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname LIKE 'nyeocare-attendance-worker%'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;

  FOR j IN
    SELECT generate_series(1,4) AS worker
  LOOP
    PERFORM cron.schedule(
      'nyeocare-attendance-worker-'||j.worker::text,
      '2 seconds',
      $$SELECT public.nyeocare_process_attendance_queue(1);$$
    );
  END LOOP;
END
$cron$;
