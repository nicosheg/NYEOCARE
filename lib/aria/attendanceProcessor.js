// lib/aria/attendanceProcessor.js
import pool from '../db';
import { refreshAttendanceIntelligence } from './attendanceIntelligence';

const ABSENCE_ACTION_LIMIT = 50;

async function getSession(sessionId, orgId, db = pool) {
  const r = await db.query(
    `SELECT id,name,service_type,started_at,status,event_kind,event_scope,group_id,event_semantics,expected_population_rule,attendance_interpretation,participation_expected,optional,absence_meaningful,aria_processing_status
     FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1`,
    [sessionId, orgId]
  );
  return r.rows[0] || null;
}

export class AttendanceProcessingBusyError extends Error {
  constructor(message='ARIA is already processing this attendance.') {
    super(message);
    this.code='ATTENDANCE_PROCESSING_BUSY';
  }
}

export async function claimAttendanceProcessing(sessionId, orgId) {
  const r = await pool.query(
    `UPDATE sessions
       SET aria_processing_status='processing',
           aria_processing_attempts=aria_processing_attempts+1,
           aria_processing_started_at=NOW(),
           aria_processing_completed_at=NULL,
           aria_processing_error=NULL
     WHERE id=$1 AND organization_id=$2 AND status='closed'
       AND (
         aria_processing_status='pending'
         OR aria_processing_status='failed'
         OR (
           aria_processing_status='processing'
           AND aria_processing_started_at IS NOT NULL
           AND aria_processing_started_at<NOW()-INTERVAL '5 minutes'
         )
       )
     RETURNING id`,
    [sessionId, orgId]
  );
  if (r.rows.length) return true;

  const current = await getSession(sessionId, orgId);
  if (!current) throw new Error('Attendance session not found.');
  if (current.status!=='closed') throw new Error('Attendance session is not closed.');
  if (current.aria_processing_status==='completed') return false;
  if (current.aria_processing_status==='processing') throw new AttendanceProcessingBusyError();
  throw new Error(`Cannot claim ARIA processing from status: ${current.aria_processing_status || 'unknown'}`);
}

async function insertParticipationAndEvents(sessionId, orgId) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const session=await getSession(sessionId,orgId,client);
    if(!session)throw new Error('Attendance session not found.');
    await client.query(
      `UPDATE attendance_records
       SET confirmed=true
       WHERE organization_id=$1 AND session_id=$2 AND present=true AND confirmed=false`,
      [orgId,sessionId]
    );
    const inserted=await client.query(
      `INSERT INTO participation_records(
        organization_id,person_id,session_id,participation_type,value,occurred_at
      )
      SELECT $1,ar.people_id,$2,'attendance',
             jsonb_build_object('present',true,'source','attendance_confirmation'),
             COALESCE(ar.marked_at,s.started_at,ar.attendance_date::timestamptz)
      FROM attendance_records ar
      JOIN sessions s ON s.id=ar.session_id AND s.organization_id=ar.organization_id
      JOIN people p ON p.id=ar.people_id AND p.organization_id=ar.organization_id
      WHERE ar.organization_id=$1 AND ar.session_id=$2
        AND ar.confirmed=true AND ar.present=true
        AND COALESCE(p.status,'active')<>'merged'
      ON CONFLICT(organization_id,person_id,session_id,participation_type)
        WHERE participation_type='attendance' DO NOTHING
      RETURNING id,person_id`,
      [orgId,sessionId]
    );
    await client.query(
      `INSERT INTO aria_events(
        organization_id,person_id,type,actor_id,source,event_key,metadata,occurred_at
      )
      SELECT $1,pr.person_id,'PARTICIPATION_CONFIRMED',NULL,'attendance',
             'participation:'||pr.id||':confirmed',
             jsonb_build_object('session_id',$2::uuid,'participation_id',pr.id),
             NOW()
      FROM participation_records pr
      WHERE pr.organization_id=$1 AND pr.session_id=$2
        AND pr.participation_type='attendance'
      ON CONFLICT(organization_id,event_key) DO NOTHING`,
      [orgId,sessionId]
    );
    await client.query('COMMIT');
    return {inserted:inserted.rowCount};
  } catch(e) {
    try{await client.query('ROLLBACK')}catch{}
    throw e;
  } finally {client.release();}
}

async function createAbsenceSignals(sessionId,orgId,session) {
  const sourcePrefix=`attendance:${sessionId}:absence:`;
  const candidateSql=`
WITH history AS (
  SELECT pr.person_id,
    COUNT(*) FILTER (WHERE pr.occurred_at>=s.started_at-INTERVAL '84 days' AND pr.occurred_at<s.started_at)::int prior_84,
    COUNT(*) FILTER (WHERE pr.occurred_at>=s.started_at-INTERVAL '28 days' AND pr.occurred_at<s.started_at)::int prior_28,
    MAX(pr.occurred_at) FILTER (WHERE pr.occurred_at<s.started_at) prior_last
  FROM participation_records pr
  CROSS JOIN (SELECT started_at FROM sessions WHERE id=$2 AND organization_id=$1) s
  WHERE pr.organization_id=$1
    AND pr.occurred_at>=s.started_at-INTERVAL '84 days'
    AND pr.occurred_at<s.started_at
  GROUP BY pr.person_id
),
latest AS (
 SELECT s.id,s.name,s.service_type,s.started_at,s.event_kind,s.event_scope,s.attendance_interpretation,s.participation_expected,s.optional,s.absence_meaningful,
   COALESCE(NULLIF(s.service_type,''),'weekday:'||EXTRACT(ISODOW FROM s.started_at)::int::text) service_key
 FROM sessions s WHERE s.id=$2 AND s.organization_id=$1 LIMIT 1
),
candidates AS (
 SELECT p.id person_id,p.first_name,p.last_name,p.display_name,p.phone,h.prior_84,h.prior_28,h.prior_last,
   COALESCE(rs.score,0)::numeric relationship_score,
   (h.prior_28*20+LEAST(h.prior_84,8)*5+COALESCE(rs.score,0)*.4)::numeric priority_score,
   latest.id session_id,latest.name session_name,latest.service_type,latest.event_kind,latest.event_scope,latest.attendance_interpretation,latest.participation_expected,latest.optional,latest.absence_meaningful
 FROM people p
 JOIN history h ON h.person_id=p.id
 CROSS JOIN latest
 LEFT JOIN relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id
 WHERE p.organization_id=$1 AND p.status='active'
   AND h.prior_84>=2 AND h.prior_28>=1
   AND COALESCE(latest.participation_expected,true)=true
   AND COALESCE(latest.optional,false)=false
   AND COALESCE(latest.absence_meaningful,true)=true
   AND NOT EXISTS(
     SELECT 1 FROM attendance_records ar
     WHERE ar.organization_id=$1 AND ar.people_id=p.id AND ar.session_id=$2
       AND ar.present=true AND ar.confirmed=true
   )
   AND NOT EXISTS(
     SELECT 1 FROM aria_attendance_contexts ac
     WHERE ac.organization_id=$1 AND ac.person_id=p.id AND ac.session_id=$2
   )
   AND NOT EXISTS(
     SELECT 1 FROM aria_care_contexts c
     WHERE c.organization_id=$1 AND c.person_id=p.id
       AND c.kind IN('travel','temporary_unavailable','not_attending')
       AND(c.ends_on IS NULL OR c.ends_on>CURRENT_DATE)
   )
   AND NOT EXISTS(
     SELECT 1 FROM aria_care_contexts c
     WHERE c.organization_id=$1 AND c.person_id=p.id
       AND c.kind='preferred_service' AND c.ends_on IS NULL
       AND c.service_type IS NOT NULL AND c.service_type<>latest.service_key
   )
 ORDER BY priority_score DESC,prior_last DESC NULLS LAST,p.id
 LIMIT ${ABSENCE_ACTION_LIMIT}
)
SELECT * FROM candidates`;

  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const candidates=await client.query(candidateSql,[orgId,sessionId]);

    if(candidates.rows.length){
      await client.query(
        `INSERT INTO aria_events(
          organization_id,person_id,type,actor_id,source,event_key,metadata,occurred_at,evidence_kind,confidence,verification_status,scope_level
        )
        SELECT $1,c.person_id,'PERSON_NOT_OBSERVED',NULL,'attendance',
          'attendance:non_observation:'||c.session_id::text||':'||c.person_id::text,
          jsonb_build_object(
            'session_id',c.session_id,
            'session_name',c.session_name,
            'service_type',c.service_type,
            'observation_type','UNUSUAL_ABSENCE',
            'event_kind',c.event_kind,
            'event_scope',c.event_scope,
            'attendance_interpretation',c.attendance_interpretation,
            'absence_is_not_explanation',true,
            'care_posture','care_first',
            'prior_attendance_84d',c.prior_84,
            'recent_attendance_28d',c.prior_28,
            'last_attended_at',c.prior_last,
            'absence_is_not_explanation',true,
            'care_posture','care_first'
          ),
          (SELECT started_at FROM sessions WHERE id=c.session_id AND organization_id=$1),
          'observation',1,'observed','organization'
        FROM (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
          person_id uuid,session_id uuid,session_name text,service_type text,event_kind text,event_scope text,
          attendance_interpretation text,participation_expected boolean,optional boolean,absence_meaningful boolean,
          prior_84 integer,prior_28 integer,prior_last timestamptz,
          relationship_score numeric,priority_score numeric,first_name text,last_name text,display_name text,phone text
        )) c
        ON CONFLICT(organization_id,event_key) DO NOTHING`,
        [orgId,JSON.stringify(candidates.rows)]
      );
      await client.query(
        `INSERT INTO aria_observations(
          organization_id,person_id,type,confidence,severity,urgency,attention_score,
          evidence,metadata,detected_at,expires_at,status
        )
        SELECT $1,c.person_id,'UNUSUAL_ABSENCE',1,'low','low',16,
          jsonb_build_object(
            'sources',jsonb_build_array('attendance'),
            'facts',jsonb_build_array('Person was not recorded as present in this completed session.'),
            'inference','This is an attendance-change signal grounded in the person\'s recent confirmed history, not a claim that anything is wrong.',
            'session_id',c.session_id,
            'session_name',c.session_name,
            'service_type',c.service_type,
            'prior_attendance_84d',c.prior_84,
            'recent_attendance_28d',c.prior_28,
            'last_attended_at',c.prior_last
          ),
          jsonb_build_object(
            'source_event_id',$3::text||c.person_id::text,
            'session_id',c.session_id::text
          ),
          NOW(),NOW()+INTERVAL '14 days','active'
        FROM (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
          person_id uuid,session_id uuid,session_name text,service_type text,
          prior_84 integer,prior_28 integer,prior_last timestamptz,
          relationship_score numeric,priority_score numeric,first_name text,last_name text,display_name text,phone text
        )) c
        ON CONFLICT DO NOTHING`,
        [orgId,JSON.stringify(candidates.rows),sourcePrefix]
      );

      await client.query(
        `INSERT INTO aria_actions(
          organization_id,person_id,observation_id,type,status,priority,action_metadata,action_key,proposed_at
        )
        SELECT o.organization_id,o.person_id,o.id,'SEND_MESSAGE','proposed','medium',
          jsonb_build_object(
            'kind','care_first_check_in',
            'reason','ARIA noticed a change in this person’s recent participation. It does not know why.',
            'summary',COALESCE(NULLIF(p.first_name,''),'This person')||' wasn’t recorded at '||o.evidence->>'session_name',
            'knowledge','Non-observation is evidence of what was seen, not an explanation for why it happened.',
            'suggestion','Review a simple personal check-in focused on how they are doing, not on attendance.',
            'requires_human_approval',true,'draft_required',true,'channel','whatsapp',
            'pattern_claim',false,'session_id',o.metadata->>'session_id',
            'session_name',o.evidence->>'session_name',
            'service_type',o.evidence->>'service_type',
            'prior_attendance_84d',(o.evidence->>'prior_attendance_84d')::int,
            'recent_attendance_28d',(o.evidence->>'recent_attendance_28d')::int,
            'last_attended_at',o.evidence->>'last_attended_at'
          ),
          'attendance:absence_check_in:'||o.metadata->>'session_id'||':'||o.person_id
        FROM aria_observations o
        JOIN people p ON p.id=o.person_id AND p.organization_id=o.organization_id
        WHERE o.organization_id=$1 AND o.type='UNUSUAL_ABSENCE'
          AND o.metadata->>'session_id'=$2
          AND o.metadata->>'source_event_id' LIKE $3::text||'%'
        ON CONFLICT(organization_id,action_key) DO NOTHING`,
        [orgId,sessionId,sourcePrefix]
      );
    }

    await client.query('COMMIT');
    return {candidates:candidates.rows.length,actions:candidates.rows.length};
  } catch(e) {
    try{await client.query('ROLLBACK')}catch{}
    throw e;
  } finally {client.release();}
}

async function createReturnSignals(sessionId,orgId) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const returners=await client.query(
      `SELECT DISTINCT pr.person_id,
         p.first_name,p.last_name,
         EXISTS(
           SELECT 1 FROM aria_attendance_contexts ac
           WHERE ac.organization_id=$1 AND ac.person_id=pr.person_id
             AND ac.session_id<>$2 AND ac.resolved_at IS NULL
         ) personalized
       FROM participation_records pr
       JOIN people p ON p.id=pr.person_id AND p.organization_id=pr.organization_id
       WHERE pr.organization_id=$1 AND pr.session_id=$2
         AND pr.participation_type='attendance'
         AND (
           EXISTS(
             SELECT 1 FROM aria_observations o
             WHERE o.organization_id=$1 AND o.person_id=pr.person_id
               AND o.type='UNUSUAL_ABSENCE' AND o.status='active'
               AND COALESCE(o.metadata->>'session_id','')<>$2
           )
           OR EXISTS(
             SELECT 1 FROM aria_actions a
             WHERE a.organization_id=$1 AND a.person_id=pr.person_id
               AND a.status IN('proposed','approved')
               AND a.action_metadata->>'kind' IN('care_first_check_in','attendance_absence_check_in','first_session_check_in')
               AND COALESCE(a.action_metadata->>'session_id','')<>$2
           )
         )`,
      [orgId,sessionId]
    );

    if(returners.rows.length){
      await client.query(
        `INSERT INTO aria_observations(
          organization_id,person_id,type,confidence,severity,urgency,attention_score,
          evidence,metadata,detected_at,status
        )
        SELECT $1,r.person_id,'RETURNED_AFTER_ABSENCE',1,'low','low',16,
          jsonb_build_object(
            'sources',jsonb_build_array('attendance'),
            'facts',jsonb_build_array('Person was recorded as present after a previous absence signal.'),
            'inference','The person returned after previously being absent; no reason for the earlier absence is assumed.',
            'session_id',$2::text
          ),
          jsonb_build_object(
            'source_event_id','attendance:'||$2||':return:'||r.person_id,
            'session_id',$2::text
          ),
          NOW(),'active'
        FROM (SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(
          person_id uuid,first_name text,last_name text,personalized boolean
        )) r
        ON CONFLICT DO NOTHING`,
        [orgId,sessionId,JSON.stringify(returners.rows)]
      );

      await client.query(
        `UPDATE aria_attendance_contexts ac
         SET resolved_at=NOW()
         WHERE ac.organization_id=$1
           AND ac.person_id IN (SELECT person_id FROM jsonb_to_recordset($3::jsonb) AS x(person_id uuid))
           AND ac.session_id<>$2 AND ac.resolved_at IS NULL`,
        [orgId,sessionId,JSON.stringify(returners.rows)]
      );

      await client.query(
        `UPDATE aria_observations o SET status='resolved',resolved_at=NOW()
         WHERE o.organization_id=$1
           AND o.person_id IN (SELECT person_id FROM jsonb_to_recordset($3::jsonb) AS x(person_id uuid))
           AND o.type='UNUSUAL_ABSENCE' AND o.status='active'
           AND COALESCE(o.metadata->>'session_id','')<>$2`,
        [orgId,sessionId,JSON.stringify(returners.rows)]
      );

      await client.query(
        `UPDATE aria_actions a SET status='cancelled',
           failure_reason='Person returned; previous attendance follow-up is no longer current.',
           updated_at=NOW()
         WHERE a.organization_id=$1
           AND a.person_id IN (SELECT person_id FROM jsonb_to_recordset($3::jsonb) AS x(person_id uuid))
           AND a.status IN('proposed','approved')
           AND a.action_metadata->>'kind' IN('care_first_check_in','attendance_absence_check_in','first_session_check_in')
           AND COALESCE(a.action_metadata->>'session_id','')<>$2`,
        [orgId,sessionId,JSON.stringify(returners.rows)]
      );

      await client.query(
        `INSERT INTO aria_actions(
          organization_id,person_id,observation_id,type,status,priority,action_metadata,action_key,proposed_at
        )
        SELECT o.organization_id,o.person_id,o.id,'SEND_MESSAGE','proposed','low',
          jsonb_build_object(
            'kind','returned_after_absence',
            'channel','whatsapp',
            'summary',COALESCE(NULLIF(p.first_name,''),'This person')||' is back after being away.',
            'knowledge','ARIA knows only that the person returned after a previous absence signal.',
            'suggestion','Review the suggested personal welcome-back message.',
            'personalized',false,'draft_required',true,
            'requires_human_approval',true,'notify_organization',true,
            'draft_message','Welcome back, '||COALESCE(NULLIF(TRIM(p.first_name||' '||p.last_name),''), 'there')||'. It is good to see you today. Hope you had a good week.',
            'session_id',o.metadata->>'session_id'
          ),
          'attendance:return_after_absence:'||o.metadata->>'session_id'||':'||o.person_id
        FROM aria_observations o
        JOIN people p ON p.id=o.person_id AND p.organization_id=o.organization_id
        WHERE o.organization_id=$1 AND o.type='RETURNED_AFTER_ABSENCE'
          AND o.metadata->>'session_id'=$2
        ON CONFLICT(organization_id,action_key) DO NOTHING`,
        [orgId,sessionId]
      );
    }

    await client.query('COMMIT');
    return {returning:returners.rows.length};
  } catch(e) {
    try{await client.query('ROLLBACK')}catch{}
    throw e;
  } finally {client.release();}
}

export async function generateParticipationFromSession(sessionId,orgId) {
  if(!sessionId||!orgId)throw new Error('sessionId and orgId are required');
  const started=Date.now();
  const session=await getSession(sessionId,orgId);
  if(!session)throw new Error('Attendance session not found.');
  if(session.status!=='closed')throw new Error('Attendance session must be closed before ARIA processing.');

  const persisted=await insertParticipationAndEvents(sessionId,orgId);
  const returning=await createReturnSignals(sessionId,orgId);
  const absence=await createAbsenceSignals(sessionId,orgId,session);
  const intelligence=await refreshAttendanceIntelligence(sessionId,orgId);

  const timings={
    totalMs:Date.now()-started,
    persistedParticipation: persisted.inserted,
    returning: returning.returning,
    absenceCandidates: absence.candidates,
    absenceActions: absence.actions,
    intelligence
  };
  console.info('[ARIA] scalable attendance pipeline',JSON.stringify({session_id:sessionId,...timings}));
  return {session_id:sessionId,processed: persisted.inserted, ...timings};
}

export async function processAttendanceSession(sessionId,orgId) {
  const claimed=await claimAttendanceProcessing(sessionId,orgId);
  if(!claimed)return {session_id:sessionId,alreadyProcessed:true};
  return generateParticipationFromSession(sessionId,orgId);
}
