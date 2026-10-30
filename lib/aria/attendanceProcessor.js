// lib/aria/attendanceProcessor.js
import pool from '../db';
import { refreshAttendanceIntelligence } from './attendanceIntelligence';
import { serviceKeySql } from './serviceIdentity';
import { normalizeFollowUpPolicy } from './followUpPolicy';

const ABSENCE_ACTION_LIMIT = 50;



async function getSession(sessionId, orgId, db = pool) {
  const r = await db.query(
    `SELECT id,name,service_type,started_at,status,event_kind,event_scope,group_id,event_semantics,expected_population_rule,attendance_interpretation,participation_expected,optional,absence_meaningful,register_completeness,register_source,register_reviewed_at,register_reviewed_by,register_review_note,aria_processing_status
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
             COALESCE(s.started_at,ar.attendance_date::timestamptz,ar.marked_at)
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
  const sourcePrefix=`attendance:${sessionId}:non-observation:`;
  const registerVerified=session?.register_completeness==='complete'&&Boolean(session.register_source)&&Boolean(session.register_reviewed_at)&&Boolean(session.register_reviewed_by);
  if(!registerVerified)return {candidates:0,actions:0,skipped:'register_not_confirmed_complete'};
  if(session.absence_meaningful!==true||session.participation_expected!==true||session.optional===true)return {candidates:0,actions:0,skipped:'event_not_enabled_for_non_observation'};
  const settings=await pool.query('SELECT settings FROM organizations WHERE id=$1 LIMIT 1',[orgId]);
  const followUpPolicy=normalizeFollowUpPolicy(settings.rows[0]?.settings?.aria?.follow_up_policy);
  if(!followUpPolicy.attendancePatternFollowUpEnabled)return {candidates:0,actions:0,skipped:'organization_policy_disabled'};
  const candidateSql=`
WITH latest AS (
 SELECT s.id,s.name,s.service_type,s.started_at,s.event_kind,s.event_scope,s.group_id,s.attendance_interpretation,s.participation_expected,s.optional,s.absence_meaningful,
    s.register_completeness,s.register_source,s.register_reviewed_at,s.register_reviewed_by,
    ${serviceKeySql('s')} service_key
  FROM sessions s WHERE s.id=$2 AND s.organization_id=$1 LIMIT 1
),
service_frequency AS (
  SELECT
    COUNT(*) FILTER (WHERE hs.started_at>=s.started_at-INTERVAL '84 days')::int expected_84,
    COUNT(*) FILTER (WHERE hs.started_at>=s.started_at-INTERVAL '28 days')::int expected_28
  FROM sessions hs
  CROSS JOIN latest s
  WHERE hs.organization_id=$1
    AND hs.id<>s.id
    AND hs.status='closed'
    AND hs.started_at>=s.started_at-INTERVAL '84 days'
    AND hs.started_at<s.started_at
    AND COALESCE(hs.event_kind,'service')=COALESCE(s.event_kind,'service')
    AND COALESCE(hs.event_scope,'organization')=COALESCE(s.event_scope,'organization')
    AND COALESCE(hs.group_id::text,'')=COALESCE(s.group_id::text,'')
    AND COALESCE(hs.participation_expected,true)=true
    AND COALESCE(hs.optional,false)=false
    AND hs.absence_meaningful=true
    AND hs.register_completeness='complete'
    AND hs.register_source IS NOT NULL
    AND hs.register_reviewed_at IS NOT NULL
    AND hs.register_reviewed_by IS NOT NULL
    AND ${serviceKeySql('hs')}=s.service_key
),
history AS (
  SELECT pr.person_id,
    COUNT(*) FILTER (WHERE pr.occurred_at>=s.started_at-INTERVAL '84 days' AND pr.occurred_at<s.started_at)::int prior_84,
    COUNT(*) FILTER (WHERE pr.occurred_at>=s.started_at-INTERVAL '28 days' AND pr.occurred_at<s.started_at)::int prior_28,
    MAX(pr.occurred_at) FILTER (WHERE pr.occurred_at<s.started_at) prior_last
  FROM participation_records pr
  JOIN sessions hs ON hs.id=pr.session_id AND hs.organization_id=pr.organization_id
  CROSS JOIN latest s
  WHERE pr.organization_id=$1
    AND pr.occurred_at>=s.started_at-INTERVAL '84 days'
    AND pr.occurred_at<s.started_at
    AND ${serviceKeySql('hs')}=s.service_key
    AND COALESCE(hs.event_kind,'service')=COALESCE(s.event_kind,'service')
    AND COALESCE(hs.event_scope,'organization')=COALESCE(s.event_scope,'organization')
    AND COALESCE(hs.group_id::text,'')=COALESCE(s.group_id::text,'')
    AND hs.status='closed'
    AND COALESCE(hs.participation_expected,true)=true
    AND COALESCE(hs.optional,false)=false
    AND hs.absence_meaningful=true
    AND hs.register_completeness='complete'
    AND hs.register_source IS NOT NULL
    AND hs.register_reviewed_at IS NOT NULL
    AND hs.register_reviewed_by IS NOT NULL
  GROUP BY pr.person_id
),candidates AS (
 SELECT p.id person_id,p.first_name,p.last_name,p.display_name,p.phone,h.prior_84,h.prior_28,h.prior_last,
   COALESCE(rs.score,0)::numeric relationship_score,
   (h.prior_28*20+LEAST(h.prior_84,8)*5+COALESCE(rs.score,0)*.4)::numeric priority_score,
   latest.id session_id,latest.name session_name,latest.service_type,latest.service_key,latest.event_kind,latest.event_scope,latest.attendance_interpretation,latest.participation_expected,latest.optional,latest.absence_meaningful,latest.register_completeness,latest.register_source,latest.register_reviewed_at,latest.register_reviewed_by,
   f.expected_84,f.expected_28,
   ROUND(h.prior_84::numeric/GREATEST(f.expected_84,1),3) prior_attendance_rate
 FROM people p
 JOIN history h ON h.person_id=p.id
 CROSS JOIN latest
 CROSS JOIN service_frequency f
 LEFT JOIN relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id
 WHERE p.organization_id=$1 AND p.status='active'
   AND latest.absence_meaningful=true
   AND latest.register_completeness='complete'
   AND latest.register_source IS NOT NULL
   AND latest.register_reviewed_at IS NOT NULL
   AND latest.register_reviewed_by IS NOT NULL
   AND latest.participation_expected=true
   AND latest.optional=false
   AND (latest.event_scope='organization' OR (latest.event_scope='group' AND latest.group_id IS NOT NULL AND EXISTS(
     SELECT 1 FROM person_memberships pm
     WHERE pm.organization_id=$1 AND pm.person_id=p.id AND pm.group_id=latest.group_id AND pm.status='active'
       AND (pm.start_date IS NULL OR pm.start_date<=CURRENT_DATE)
       AND (pm.end_date IS NULL OR pm.end_date>=CURRENT_DATE)
   )))
   AND h.prior_84>=2
   AND h.prior_84::numeric/GREATEST(f.expected_84,1)>=0.5
   AND h.prior_28>=GREATEST(1,CEIL(f.expected_28::numeric*0.4)::int)
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
   AND NOT EXISTS(
     SELECT 1 FROM aria_care_contexts c
     WHERE c.organization_id=$1 AND c.person_id=p.id
       AND c.kind='other' AND c.metadata->>'do_not_contact'='true'
       AND (c.ends_on IS NULL OR c.ends_on>=latest.started_at::date)
   )
   AND NOT EXISTS(
     SELECT 1 FROM person_communications pc
     WHERE pc.organization_id=$1 AND pc.person_id=p.id
       AND (
         (pc.direction='outbound' AND pc.status IN('sent','delivered','completed'))
         OR (pc.direction='inbound' AND pc.status IN('received','completed','sent','delivered'))
       )
       AND pc.occurred_at>=latest.started_at-($3::int*INTERVAL '1 day')
       AND pc.occurred_at<latest.started_at
   )
   AND NOT EXISTS(
     SELECT 1 FROM timeline_events te
     WHERE te.people_id=p.id
       AND te.source IN('human','conversation_import')
       AND te.event_type NOT IN('identity_review','aria_draft','scan_review')
       AND te.occurred_at>=latest.started_at-($3::int*INTERVAL '1 day')
       AND te.occurred_at<latest.started_at
   )
   AND NOT EXISTS(
     SELECT 1 FROM care_feedback fb
     WHERE fb.organization_id=$1 AND fb.person_id=p.id
       AND fb.feedback_type='no_response'
       AND fb.observed_at>=latest.started_at-($4::int*INTERVAL '1 day')
       AND fb.observed_at<latest.started_at
   )
   AND (
     SELECT COUNT(*)::int FROM person_communications pc
     WHERE pc.organization_id=$1 AND pc.person_id=p.id
       AND pc.direction='outbound' AND pc.status IN('sent','delivered','completed')
       AND pc.occurred_at>=latest.started_at-INTERVAL '30 days'
       AND pc.occurred_at<latest.started_at
   ) < $5
 ORDER BY priority_score DESC,prior_last DESC NULLS LAST,p.id
 LIMIT ${ABSENCE_ACTION_LIMIT}
)
SELECT * FROM candidates`;

  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const candidates=await client.query(candidateSql,[orgId,sessionId,followUpPolicy.routineCooldownDays,followUpPolicy.noResponseCooldownDays,followUpPolicy.maxRoutineContactsPer30Days]);

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
            'service_key',c.service_key,
            'observation_type','ATTENDANCE_NOT_OBSERVED',
            'register_completeness',c.register_completeness,
            'register_source',c.register_source,
            'register_reviewed_at',c.register_reviewed_at,
            'register_reviewed_by',c.register_reviewed_by,
            'event_kind',c.event_kind,
            'event_scope',c.event_scope,
            'attendance_interpretation',c.attendance_interpretation,
            'absence_is_not_explanation',true,
            'care_posture','care_first',
            'prior_attendance_84d',c.prior_84,
            'recent_attendance_28d',c.prior_28,
            'expected_sessions_84d',c.expected_84,
            'expected_sessions_28d',c.expected_28,
            'attendance_rate_84d',c.prior_attendance_rate,
            'last_attended_at',c.prior_last,
            'absence_is_not_explanation',true,
            'care_posture','care_first'
          ),
          (SELECT started_at FROM sessions WHERE id=c.session_id AND organization_id=$1),
          'observation',1,'observed','organization'
        FROM (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
          person_id uuid,session_id uuid,session_name text,service_type text,service_key text,event_kind text,event_scope text,
          attendance_interpretation text,participation_expected boolean,optional boolean,absence_meaningful boolean,
          register_completeness text,register_source text,register_reviewed_at timestamptz,register_reviewed_by uuid,
          prior_84 integer,prior_28 integer,prior_last timestamptz,
          expected_84 integer,expected_28 integer,prior_attendance_rate numeric,
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
        SELECT $1,c.person_id,'ATTENDANCE_NOT_OBSERVED',1,'low','low',16,
          jsonb_build_object(
            'sources',jsonb_build_array('attendance'),
            'facts',jsonb_build_array('No confirmed attendance mark was found for this person in the operator-reconciled complete register for this named event.'),
            'inference','This is evidence of non-observation in a register declared complete by an authorized operator. It does not prove why the person was not recorded or establish a personal circumstance; review corrections before deciding whether to reach out.',
            'register_completeness',c.register_completeness,
            'register_source',c.register_source,
            'register_reviewed_at',c.register_reviewed_at,
            'register_reviewed_by',c.register_reviewed_by,
            'session_id',c.session_id,
            'session_name',c.session_name,
            'service_type',c.service_type,
            'service_key',c.service_key,
            'prior_attendance_84d',c.prior_84,
            'recent_attendance_28d',c.prior_28,
            'expected_sessions_84d',c.expected_84,
            'expected_sessions_28d',c.expected_28,
            'attendance_rate_84d',c.prior_attendance_rate,
            'last_attended_at',c.prior_last
          ),
          jsonb_build_object(
            'source_event_id',$3::text||c.person_id::text,
            'session_id',c.session_id::text,
            'register_completeness',c.register_completeness,
            'register_source',c.register_source,
            'register_reviewed_at',c.register_reviewed_at,
            'register_reviewed_by',c.register_reviewed_by
          ),
          NOW(),NOW()+INTERVAL '14 days','active'
        FROM (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
          person_id uuid,session_id uuid,session_name text,service_type text,service_key text,
          register_completeness text,register_source text,register_reviewed_at timestamptz,register_reviewed_by uuid,
          prior_84 integer,prior_28 integer,prior_last timestamptz,
          expected_84 integer,expected_28 integer,prior_attendance_rate numeric,
          relationship_score numeric,priority_score numeric,first_name text,last_name text,display_name text,phone text
        )) c
        ON CONFLICT DO NOTHING`,
        [orgId,JSON.stringify(candidates.rows),sourcePrefix]
      );

      await client.query(
        `INSERT INTO aria_actions(
          organization_id,person_id,observation_id,type,status,priority,action_metadata,action_key,proposed_at
        )
        SELECT o.organization_id,o.person_id,o.id,'REQUEST_REVIEW','proposed','low',
          jsonb_build_object(
            'kind','attendance_register_review',
            'reason','A verified register contains no confirmed attendance mark for this person at this event. No reason is known.',
            'summary',COALESCE(NULLIF(p.first_name,''),'This person')||' has no confirmed attendance mark in the reconciled register for '||(o.evidence->>'session_name'),
            'knowledge','The register supports a non-observation only. It does not prove physical absence or explain a person\'s circumstances.',
            'suggestion','Review the reconciled register and any corrections first. Decide separately whether a personal check-in is appropriate.',
            'requires_human_approval',true,'draft_required',false,'channel',NULL,
            'pattern_claim',false,'session_id',o.metadata->>'session_id',
            'session_name',o.evidence->>'session_name',
            'service_type',o.evidence->>'service_type',
             'service_key',o.evidence->>'service_key',
            'prior_attendance_84d',(o.evidence->>'prior_attendance_84d')::int,
            'recent_attendance_28d',(o.evidence->>'recent_attendance_28d')::int,
            'expected_sessions_84d',(o.evidence->>'expected_sessions_84d')::int,
            'expected_sessions_28d',(o.evidence->>'expected_sessions_28d')::int,
            'attendance_rate_84d',(o.evidence->>'attendance_rate_84d')::numeric,
            'last_attended_at',o.evidence->>'last_attended_at'
          ),
          'attendance:register_review:'||(o.metadata->>'session_id')||':'||o.person_id,NOW()
        FROM aria_observations o
        JOIN people p ON p.id=o.person_id AND p.organization_id=o.organization_id
        WHERE o.organization_id=$1 AND o.type='ATTENDANCE_NOT_OBSERVED'
          AND o.metadata->>'session_id'=$2::text
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
  const settings=await pool.query('SELECT settings FROM organizations WHERE id=$1 LIMIT 1',[orgId]);
  const followUpPolicy=normalizeFollowUpPolicy(settings.rows[0]?.settings?.aria?.follow_up_policy);
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
         AND NOT EXISTS(
           SELECT 1 FROM aria_care_contexts suppress
           WHERE suppress.organization_id=$1 AND suppress.person_id=pr.person_id
             AND suppress.kind='other' AND suppress.metadata->>'do_not_contact'='true'
             AND (suppress.ends_on IS NULL OR suppress.ends_on>=CURRENT_DATE)
         )
         AND (
           EXISTS(
             SELECT 1 FROM aria_observations o
             WHERE o.organization_id=$1 AND o.person_id=pr.person_id
               AND o.type IN('UNUSUAL_ABSENCE','ATTENDANCE_NOT_OBSERVED') AND o.status='active'
               AND COALESCE(o.metadata->>'session_id','')<>$2::text
               AND o.evidence->>'service_key'=(SELECT ${serviceKeySql('cs')} FROM sessions cs WHERE cs.id=$2 AND cs.organization_id=$1)
           )
           OR EXISTS(
             SELECT 1 FROM aria_actions a
             WHERE a.organization_id=$1 AND a.person_id=pr.person_id
               AND a.status IN('proposed','approved')
               AND a.action_metadata->>'kind' IN('care_first_check_in','attendance_absence_check_in','attendance_register_review','first_session_check_in')
               AND COALESCE(a.action_metadata->>'first_visit_required','false')<>'true'
               AND COALESCE(a.action_metadata->>'session_id','')<>$2::text
               AND a.action_metadata->>'service_key'=(SELECT ${serviceKeySql('cs')} FROM sessions cs WHERE cs.id=$2 AND cs.organization_id=$1)
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
            'facts',jsonb_build_array('A confirmed attendance record now exists after an earlier non-observation in a reconciled register.'),
            'inference','A later positive record is confirmed. The earlier missing register mark does not establish why the person was not recorded.',
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
           AND ac.session_id<>$2 AND ac.resolved_at IS NULL
            AND ac.session_id IN (SELECT ps.id FROM sessions ps WHERE ps.organization_id=$1 AND ${serviceKeySql('ps')}=(SELECT ${serviceKeySql('cs')} FROM sessions cs WHERE cs.id=$2 AND cs.organization_id=$1))`,
        [orgId,sessionId,JSON.stringify(returners.rows)]
      );

      await client.query(
        `UPDATE aria_observations o SET status='resolved',resolved_at=NOW()
         WHERE o.organization_id=$1
           AND o.person_id IN (SELECT person_id FROM jsonb_to_recordset($3::jsonb) AS x(person_id uuid))
           AND o.type IN('UNUSUAL_ABSENCE','ATTENDANCE_NOT_OBSERVED') AND o.status='active'
           AND COALESCE(o.metadata->>'session_id','')<>$2
           AND o.evidence->>'service_key'=(SELECT ${serviceKeySql('cs')} FROM sessions cs WHERE cs.id=$2 AND cs.organization_id=$1)`,
        [orgId,sessionId,JSON.stringify(returners.rows)]
      );

      await client.query(
        `UPDATE aria_actions a SET status='cancelled',
           failure_reason='Person returned; previous attendance follow-up is no longer current.',
           updated_at=NOW()
         WHERE a.organization_id=$1
           AND a.person_id IN (SELECT person_id FROM jsonb_to_recordset($3::jsonb) AS x(person_id uuid))
           AND a.status IN('proposed','approved')
           AND a.action_metadata->>'kind' IN('care_first_check_in','attendance_absence_check_in','attendance_register_review','first_session_check_in')
           AND COALESCE(a.action_metadata->>'first_visit_required','false')<>'true'
           AND COALESCE(a.action_metadata->>'session_id','')<>$2
           AND a.action_metadata->>'service_key'=(SELECT ${serviceKeySql('cs')} FROM sessions cs WHERE cs.id=$2 AND cs.organization_id=$1)`,
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
            'summary',COALESCE(NULLIF(p.first_name,''),'This person')||' has a new confirmed attendance record after an earlier register gap.',
            'knowledge','ARIA knows a later attendance record exists; it does not know why the earlier register lacked a mark.',
            'suggestion','Review the suggested personal welcome-back message.',
            'personalized',false,'draft_required',true,
            'requires_human_approval',true,'notify_organization',true,
            'draft_message','Good to see you today, '||COALESCE(NULLIF(TRIM(p.first_name||' '||p.last_name),''), 'there')||'. Hope you have been well.',
            'session_id',o.metadata->>'session_id'
          ),
          'attendance:return_after_absence:'||(o.metadata->>'session_id')||':'||o.person_id,NOW()
        FROM aria_observations o
        JOIN people p ON p.id=o.person_id AND p.organization_id=o.organization_id
        WHERE o.organization_id=$1 AND o.type='RETURNED_AFTER_ABSENCE'
          AND o.metadata->>'session_id'=$2::text
          AND NOT EXISTS(
            SELECT 1 FROM person_communications pc
            WHERE pc.organization_id=$1 AND pc.person_id=o.person_id
              AND (
                (pc.direction='outbound' AND pc.status IN('sent','delivered','completed'))
                OR (pc.direction='inbound' AND pc.status IN('received','completed','sent','delivered'))
              )
              AND pc.occurred_at>=(
                SELECT s.started_at FROM sessions s WHERE s.id=$2 AND s.organization_id=$1
              )-($3::int*INTERVAL '1 day')
              AND pc.occurred_at<(
                SELECT s.started_at FROM sessions s WHERE s.id=$2 AND s.organization_id=$1
              )
          )
          AND NOT EXISTS(
            SELECT 1 FROM care_feedback fb
            WHERE fb.organization_id=$1 AND fb.person_id=o.person_id
              AND fb.feedback_type='no_response'
              AND fb.observed_at>=(
                SELECT s.started_at FROM sessions s WHERE s.id=$2 AND s.organization_id=$1
              )-($4::int*INTERVAL '1 day')
              AND fb.observed_at<(
                SELECT s.started_at FROM sessions s WHERE s.id=$2 AND s.organization_id=$1
              )
          )
          AND NOT EXISTS(
            SELECT 1 FROM timeline_events te
            WHERE te.people_id=o.person_id
              AND te.source IN('human','conversation_import')
              AND te.event_type NOT IN('identity_review','aria_draft','scan_review')
              AND te.occurred_at>=(
                SELECT s.started_at FROM sessions s WHERE s.id=$2 AND s.organization_id=$1
              )-($3::int*INTERVAL '1 day')
              AND te.occurred_at<(
                SELECT s.started_at FROM sessions s WHERE s.id=$2 AND s.organization_id=$1
              )
          )
          AND (
            SELECT COUNT(*)::int FROM person_communications pc
            WHERE pc.organization_id=$1 AND pc.person_id=o.person_id
              AND pc.direction='outbound' AND pc.status IN('sent','delivered','completed')
              AND pc.occurred_at>=(
                SELECT s.started_at FROM sessions s WHERE s.id=$2 AND s.organization_id=$1
              )-INTERVAL '30 days'
              AND pc.occurred_at<(
                SELECT s.started_at FROM sessions s WHERE s.id=$2 AND s.organization_id=$1
              )
          ) < $5
        ON CONFLICT(organization_id,action_key) DO NOTHING`,
        [orgId,sessionId,followUpPolicy.routineCooldownDays,followUpPolicy.noResponseCooldownDays,followUpPolicy.maxRoutineContactsPer30Days]
      );
    }

    await client.query('COMMIT');
    return {returning:returners.rows.length};
  } catch(e) {
    try{await client.query('ROLLBACK')}catch{}
    throw e;
  } finally {client.release();}
}


async function createFirstVisitFollowUps(sessionId,orgId) {
  const settings=await pool.query('SELECT settings FROM organizations WHERE id=$1 LIMIT 1',[orgId]);
  const policy=normalizeFollowUpPolicy(settings.rows[0]?.settings?.aria?.follow_up_policy);
  if(!policy.firstVisitFollowUpRequired)return {created:0};

  // A visitor's first recorded attendance creates one required human disposition.
  // It does not assume that this is their first-ever visit and never sends a message automatically.
  const created=await pool.query(
    `WITH target AS (
       SELECT s.id,s.name,s.service_type,s.started_at,${serviceKeySql('s')} service_key
       FROM sessions s
       WHERE s.organization_id=$1 AND s.id=$2 AND s.status='closed'
     )
     INSERT INTO aria_actions(
       organization_id,person_id,observation_id,type,status,priority,action_metadata,action_key,proposed_at
     )
     SELECT $1,p.id,NULL,'SEND_MESSAGE','proposed','high',
       jsonb_build_object(
         'kind','first_session_check_in',
         'first_visit_required',true,
         'first_visit_status','verify_first_visit_or_existing_connection',
         'first_visit_due_at',t.started_at+($3::int*INTERVAL '1 hour'),
         'due_at',t.started_at+($3::int*INTERVAL '1 hour'),
         'first_visit_due_hours',$3::int,
         'session_id',t.id::text,
         'session_name',t.name,
         'service_key',t.service_key,
         'reason','The first recorded visitor attendance requires one human care disposition.',
         'summary',COALESCE(NULLIF(p.display_name,''),NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),'This visitor')||' needs a first-visit care check within '||$3::text||' hours.',
         'knowledge','This is the first attendance currently recorded for this visitor in NYEOCARE. That does not prove it was their first-ever visit or that nobody has already welcomed them.',
         'suggestion','Confirm whether they are visiting for the first time or returning, and whether someone already connected with them. If a follow-up is appropriate, ask how they experienced the gathering without pressure. Record what happened; no message is sent automatically.',
         'requires_human_approval',true,
         'draft_required',true,
         'channel','in_person_or_preferred',
         'follow_up_policy_revision','v1'
       ),
       'attendance:first_visit_check_in:'||t.id::text||':'||p.id::text,
       NOW()
     FROM participation_records pr
     JOIN target t ON t.id=pr.session_id
     JOIN people p ON p.id=pr.person_id AND p.organization_id=pr.organization_id
     WHERE pr.organization_id=$1
       AND pr.session_id=$2
       AND pr.participation_type='attendance'
       AND lower(BTRIM(COALESCE(p.type,'')))='visitor'
       AND COALESCE(p.status,'active')='active'
       AND NOT EXISTS(
         SELECT 1
         FROM participation_records previous
         WHERE previous.organization_id=pr.organization_id
           AND previous.person_id=pr.person_id
           AND previous.participation_type='attendance'
           AND previous.session_id<>t.id
           AND previous.occurred_at<t.started_at
       )
       AND NOT EXISTS(
         SELECT 1 FROM aria_care_contexts cc
         WHERE cc.organization_id=$1 AND cc.person_id=p.id
           AND cc.kind='other'
           AND cc.metadata->>'do_not_contact'='true'
           AND (cc.ends_on IS NULL OR cc.ends_on>=t.started_at::date)
       )
       AND NOT EXISTS(
         SELECT 1 FROM care_feedback welcomed
         WHERE welcomed.organization_id=$1
           AND welcomed.person_id=p.id
           AND welcomed.context->>'source'='first_visit_welcome_during_attendance'
           AND welcomed.context->>'session_id'=t.id::text
           AND welcomed.context->>'outcome'='met_in_person'
           AND welcomed.verification_status='reported'
       )
     ON CONFLICT(organization_id,action_key) DO NOTHING
     RETURNING id`,
    [orgId,sessionId,policy.firstVisitDueHours]
  );
  return {created:created.rowCount};
}

export async function generateParticipationFromSession(sessionId,orgId) {
  if(!sessionId||!orgId)throw new Error('sessionId and orgId are required');
  const started=Date.now();
  const session=await getSession(sessionId,orgId);
  if(!session)throw new Error('Attendance session not found.');
  if(session.status!=='closed')throw new Error('Attendance session must be closed before ARIA processing.');

  const persisted=await insertParticipationAndEvents(sessionId,orgId);
  const firstVisit=await createFirstVisitFollowUps(sessionId,orgId);
  const returning=await createReturnSignals(sessionId,orgId);
  const absence=await createAbsenceSignals(sessionId,orgId,session);
  const intelligence=await refreshAttendanceIntelligence(sessionId,orgId);

  const timings={
    totalMs:Date.now()-started,
    persistedParticipation: persisted.inserted,
    firstVisitFollowUps: firstVisit.created,
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
