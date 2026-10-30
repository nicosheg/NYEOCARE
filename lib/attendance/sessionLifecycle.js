// lib/attendance/sessionLifecycle.js
import { emitAriaEvent } from '../aria/eventEmitter';
import { enqueueAttendanceProcessing } from '../aria/attendanceQueue';

const objectValue = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const cleanName = value => String(value ?? '').trim().slice(0, 200);

function normalizeSections(value) {
  const sections = Array.isArray(value)
    ? [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
    : [];
  if (!sections.length) sections.push('All');
  return sections;
}

export async function createAttendanceSession({ db, organizationId, actorId, actorRole, parameters = {} }) {
  const name = cleanName(parameters.name || parameters.title || '');
  if (!name) throw Object.assign(new Error('Event name is required.'), { status: 400 });

  const sections = normalizeSections(parameters.sections);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [organizationId]);

  const active = await db.query(
    `SELECT id,name,status,started_by,started_at,auto_close_at,auto_close_reason
     FROM sessions
     WHERE organization_id=$1 AND status='active'
     LIMIT 1
     FOR UPDATE`,
    [organizationId]
  );
  if (active.rows.length) {
    throw Object.assign(new Error('An attendance session is already active.'), {
      status: 409,
      code: 'ATTENDANCE_SESSION_ACTIVE',
      session: active.rows[0]
    });
  }

  const timing = (await db.query(
    `WITH configured AS (
       SELECT CASE
         WHEN EXISTS(
           SELECT 1 FROM pg_timezone_names z
           WHERE z.name=COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos')
         ) THEN COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos')
         ELSE 'Africa/Lagos'
       END AS time_zone
       FROM organizations o WHERE o.id=$1
     ), started AS (
       SELECT clock_timestamp() AS started_at,time_zone FROM configured
     ), deadlines AS (
       SELECT started_at,time_zone,
              ((started_at AT TIME ZONE time_zone)::date + TIME '23:59') AT TIME ZONE time_zone AS end_of_day
       FROM started
     )
     SELECT started_at,time_zone AS organization_timezone,
            CASE WHEN end_of_day>started_at
                 THEN LEAST(started_at+INTERVAL '24 hours',end_of_day)
                 ELSE started_at+INTERVAL '24 hours' END AS auto_close_at,
            CASE WHEN end_of_day>started_at AND end_of_day<=started_at+INTERVAL '24 hours'
                 THEN 'end_of_day' ELSE '24h' END AS auto_close_reason
     FROM deadlines`,
    [organizationId]
  )).rows[0];
  if (!timing) throw Object.assign(new Error('Organization attendance time zone is unavailable.'), { status: 409 });

  const eventKind = parameters.event_kind || 'service';
  const eventScope = parameters.event_scope || 'organization';
  const serviceType = parameters.service_type || null;
  const groupId = parameters.group_id || null;
  const eventSemantics = objectValue(parameters.event_semantics);
  const expectedPopulationRule = objectValue(parameters.expected_population_rule);
  const attendanceInterpretation = parameters.attendance_interpretation || 'neutral';
  const participationExpected = parameters.participation_expected !== false;
  const optional = parameters.optional === true;
  const absenceMeaningful = false;

  const created = await db.query(
    `INSERT INTO sessions(
       organization_id,name,status,service_type,started_by,started_at,auto_close_at,auto_close_reason,
       event_kind,event_scope,group_id,event_semantics,expected_population_rule,attendance_interpretation,
       participation_expected,optional,absence_meaningful,aria_processing_status,aria_processing_stage,
       aria_processing_progress,aria_processing_processed,aria_processing_total
     )
     VALUES($1,$2,'active',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,'idle','idle',0,0,0)
     RETURNING id,name,status,service_type,started_by,started_at,auto_close_at,auto_close_reason,
               event_kind,event_scope,group_id,event_semantics,expected_population_rule,attendance_interpretation,
               participation_expected,optional,absence_meaningful,aria_processing_status,aria_processing_stage,
               aria_processing_progress,aria_processing_processed,aria_processing_total`,
    [
      organizationId,name,serviceType,actorId,timing.started_at,timing.auto_close_at,timing.auto_close_reason,
      eventKind,eventScope,groupId,JSON.stringify(eventSemantics),JSON.stringify(expectedPopulationRule),
      attendanceInterpretation,participationExpected,optional,absenceMeaningful
    ]
  );
  const session = created.rows[0];

  await db.query(
    'INSERT INTO session_users(session_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [session.id, actorId]
  );
  await db.query(
    `INSERT INTO session_sections(session_id,name,organization_id)
     SELECT $1,x,$2 FROM unnest($3::text[]) AS t(x) ON CONFLICT DO NOTHING`,
    [session.id, organizationId, sections]
  );
  await db.query(
    `INSERT INTO attendance_session_roster(organization_id,session_id,person_id,source)
     SELECT p.organization_id,$2,p.id,'session_start'
     FROM people p
     WHERE p.organization_id=$1 AND COALESCE(p.status,'active')='active'
     ON CONFLICT DO NOTHING`,
    [organizationId, session.id]
  );

  session.organization_timezone = timing.organization_timezone;
  await emitAriaEvent({
    organizationId,
    type: 'SERVICE_CREATED',
    source: 'attendance',
    actorId,
    actorRole,
    evidenceKind: 'fact',
    verificationStatus: 'verified',
    confidence: 1,
    metadata: {
      session_id: session.id,
      name: session.name,
      service_type: session.service_type,
      event_kind: session.event_kind,
      event_scope: session.event_scope,
      group_id: session.group_id,
      event_semantics: session.event_semantics,
      expected_population_rule: session.expected_population_rule,
      attendance_interpretation: session.attendance_interpretation,
      participation_expected: session.participation_expected,
      optional: session.optional,
      absence_meaningful: false,
      auto_close_at: session.auto_close_at,
      auto_close_reason: session.auto_close_reason,
      memory: {
        type: 'event_semantics',
        key: 'session:' + session.id,
        value: {
          session_id: session.id,
          name: session.name,
          service_type: session.service_type,
          event_kind: session.event_kind,
          event_scope: session.event_scope,
          group_id: session.group_id,
          event_semantics: session.event_semantics,
          expected_population_rule: session.expected_population_rule,
          attendance_interpretation: session.attendance_interpretation,
          participation_expected: session.participation_expected,
          optional: session.optional,
          absence_meaningful: false
        },
        importance: 'important'
      }
    },
    eventKey: 'service:' + session.id + ':created'
  }, db);

  return { session, sections, joined: true };
}

export async function finalizeAttendanceSession({ db, organizationId, actorId, sessionId }) {
  if (!sessionId) throw Object.assign(new Error('session_id is required.'), { status: 400 });

  await db.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [organizationId]);
  const current = (await db.query(
    `SELECT id,name,status,started_at,closed_at,auto_close_at,auto_close_reason,closure_reason,
            register_completeness,register_source,register_reviewed_at,register_reviewed_by,
            aria_processing_status,aria_processing_attempts,aria_processing_started_at,
            aria_processing_completed_at,aria_processing_error,aria_processing_stage,
            aria_processing_progress,aria_processing_processed,aria_processing_total
     FROM sessions
     WHERE id=$1 AND organization_id=$2
     LIMIT 1
     FOR UPDATE`,
    [sessionId, organizationId]
  )).rows[0];

  if (!current) throw Object.assign(new Error('Attendance session not found.'), { status: 404 });
  if (current.status !== 'active') {
    return {
      alreadySaved: true,
      processing_pending: ['pending','processing'].includes(String(current.aria_processing_status || '')),
      queued: true,
      session: current
    };
  }

  const finalized = await db.query(
    'SELECT public.nyeocare_finalize_attendance_session($1,$2,$3) AS finalized',
    [sessionId, 'manual_confirmation', actorId]
  );
  if (finalized.rows[0]?.finalized !== true) {
    throw Object.assign(new Error('This attendance session changed before it could be saved.'), { status: 409 });
  }

  const closed = (await db.query(
    `SELECT id,name,status,started_at,closed_at,auto_close_at,auto_close_reason,closure_reason,
            register_completeness,register_source,register_reviewed_at,register_reviewed_by,
            aria_processing_status,aria_processing_attempts,aria_processing_started_at,
            aria_processing_completed_at,aria_processing_error,aria_processing_stage,
            aria_processing_progress,aria_processing_processed,aria_processing_total
     FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1`,
    [sessionId, organizationId]
  )).rows[0];

  const queued = await enqueueAttendanceProcessing({
    organizationId,
    sessionId,
    actorId,
    stage: 'persist',
    db
  });

  return {
    alreadySaved: false,
    processing_pending: true,
    queued: true,
    queue_message_id: queued.messageId,
    session: closed
  };
}
