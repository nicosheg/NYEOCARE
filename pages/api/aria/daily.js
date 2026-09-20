// pages/api/aria/daily.js
// ARIA Daily Intelligence — organization-level briefing, patterns and next actions.
// Uses only tables that exist in the current database.
// FACT = observed database fact.
// PATTERN = repeated/meaningful behavior detected from history.
// HYPOTHESIS = cautious interpretation; never presented as certainty.
// UNKNOWN = insufficient evidence.

import pool from '../../../lib/db';
import {withOrg} from '../../../lib/apiHelpers';

function pct(value){
  return Math.round(Number(value)||0);
}

async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});

  const orgId=req.org.id;

  try{
    const overview=await pool.query(`
      WITH active_people AS(
        SELECT id
        FROM people
        WHERE organization_id=$1 AND status='active'
      ),
      recent_sessions AS(
        SELECT id,started_at
        FROM sessions
        WHERE organization_id=$1
          AND started_at>=NOW()-INTERVAL '30 days'
      ),
      recent_attendance AS(
        SELECT ar.people_id,ar.attendance_date,ar.present
        FROM attendance_records ar
        WHERE ar.organization_id=$1
          AND ar.attendance_date>=CURRENT_DATE-INTERVAL '30 days'
          AND ar.present=true
      )
      SELECT
        (SELECT COUNT(*) FROM active_people)::int AS people_count,
        (SELECT COUNT(*) FROM recent_sessions)::int AS sessions_30d,
        (SELECT COUNT(DISTINCT people_id) FROM recent_attendance)::int AS active_attendees_30d
    `,[orgId]);

    const stats=overview.rows[0]||{people_count:0,sessions_30d:0,active_attendees_30d:0};

    // Detect people whose attendance pattern is weakening.
    // This is a PATTERN signal, not a prediction of future behavior.
    const patterns=await pool.query(`
      WITH recent_session_total AS(
        SELECT COUNT(*)::int AS total_sessions
        FROM sessions
        WHERE organization_id=$1 AND started_at>=NOW()-INTERVAL '8 weeks'
      ),
      attendance_by_person AS(
        SELECT ar.people_id AS id,COUNT(DISTINCT ar.session_id)::int AS attended_sessions,MAX(ar.attendance_date) AS last_attendance
        FROM attendance_records ar
        WHERE ar.organization_id=$1 AND ar.attendance_date>=CURRENT_DATE-INTERVAL '8 weeks' AND ar.present=true
        GROUP BY ar.people_id
      ),
      person_sessions AS(
        SELECT p.id,p.first_name,p.last_name,rst.total_sessions,COALESCE(abp.attended_sessions,0)::int AS attended_sessions,abp.last_attendance
        FROM people p CROSS JOIN recent_session_total rst
        LEFT JOIN attendance_by_person abp ON abp.id=p.id
        WHERE p.organization_id=$1 AND p.status='active'
      ),
      scored AS(
        SELECT *,CASE
          WHEN total_sessions>=4 AND attended_sessions<=1 THEN 'slipping_pattern'
          WHEN total_sessions>=5 AND attended_sessions::numeric/NULLIF(total_sessions,0)<0.5 THEN 'weakening_pattern'
          WHEN total_sessions>=4 AND attended_sessions::numeric/NULLIF(total_sessions,0)>=0.75 THEN 'regular_pattern'
          ELSE 'insufficient_evidence' END AS pattern
        FROM person_sessions
      )
      SELECT * FROM scored WHERE pattern IN('slipping_pattern','weakening_pattern')
      ORDER BY CASE pattern WHEN 'slipping_pattern' THEN 2 ELSE 1 END DESC,last_attendance ASC NULLS FIRST
      LIMIT 10
    `,[orgId]);;

    // Active ARIA observations provide the strongest existing signals.
    const observations=await pool.query(`
      SELECT
        o.id,o.person_id,o.type,o.confidence,o.severity,o.urgency,
        o.attention_score,o.evidence,o.detected_at,
        p.first_name,p.last_name
      FROM aria_observations o
      LEFT JOIN people p
        ON p.id=o.person_id
       AND p.organization_id=o.organization_id
      WHERE o.organization_id=$1
        AND o.status='active'
        AND(o.expires_at IS NULL OR o.expires_at>NOW())
      ORDER BY o.attention_score DESC,o.detected_at DESC
      LIMIT 10
    `,[orgId]);

    // Existing proposed/approved actions are surfaced as concrete next steps.
    const actions=await pool.query(`
      SELECT
        a.id,a.person_id,a.type,a.status,a.priority,
        a.action_metadata,a.proposed_at,
        p.first_name,p.last_name
      FROM aria_actions a
      LEFT JOIN people p
        ON p.id=a.person_id
       AND p.organization_id=a.organization_id
      WHERE a.organization_id=$1
        AND a.status IN('proposed','approved')
      ORDER BY
        CASE a.priority
          WHEN 'critical' THEN 4
          WHEN 'high' THEN 3
          WHEN 'medium' THEN 2
          ELSE 1
        END DESC,
        a.proposed_at ASC
      LIMIT 10
    `,[orgId]);

    const patternItems=patterns.rows.map(p=>({
      personId:p.id,
      name:[p.first_name,p.last_name].filter(Boolean).join(' '),
      type:'PATTERN',
      pattern:p.pattern,
      evidence:{
        sessionsObserved:p.total_sessions,
        sessionsAttended:p.attended_sessions,
        attendanceRate:p.total_sessions
          ? pct((p.attended_sessions/p.total_sessions)*100)
          : 0,
        lastAttendance:p.last_attendance
      },
      message:p.pattern==='slipping_pattern'
        ?`${p.first_name||'This person'} shows a slipping attendance pattern across recent sessions.`
        :`${p.first_name||'This person'} shows weakening attendance across recent sessions.`,
      nextAction:'Review their recent history and consider a personal check-in.'
    }));

    const observationItems=observations.rows.map(o=>({
      id:o.id,
      personId:o.person_id,
      name:[o.first_name,o.last_name].filter(Boolean).join(' ')||null,
      type:'OBSERVATION',
      observationType:o.type,
      severity:o.severity,
      urgency:o.urgency,
      confidence:Number(o.confidence)||0,
      attentionScore:Number(o.attention_score)||0,
      evidence:o.evidence||{},
      detectedAt:o.detected_at,
      nextAction:'Review this signal before taking action.'
    }));

    const actionItems=actions.rows.map(a=>({
      id:a.id,
      personId:a.person_id,
      name:[a.first_name,a.last_name].filter(Boolean).join(' ')||null,
      type:'NEXT_ACTION',
      actionType:a.type,
      priority:a.priority,
      status:a.status,
      metadata:a.action_metadata||{},
      nextAction:a.type==='SEND_MESSAGE'
        ?'Review and approve the suggested message.'
        :a.type==='REQUEST_REVIEW'
        ?'Open the person and review their record.'
        :a.type==='ESCALATE'
        ?'Review the escalation and decide who should respond.'
        :'Review this recommended action.'
    }));

    // ARIA's daily briefing is generated from real signals.
    let summary='ARIA is ready. There are no significant care signals requiring attention right now.';

    if(patternItems.length){
      summary=`ARIA found ${patternItems.length} person${patternItems.length===1?'':'s'} showing a possible weakening attendance pattern.`;
    }else if(observationItems.length){
      summary=`ARIA found ${observationItems.length} active signal${observationItems.length===1?'':'s'} worth reviewing today.`;
    }else if(actionItems.length){
      summary=`ARIA has ${actionItems.length} pending action${actionItems.length===1?'':'s'} for review today.`;
    }

    const nextAction=
      actionItems[0]?.nextAction||
      patternItems[0]?.nextAction||
      observationItems[0]?.nextAction||
      'No action is required right now. Keep observing.';

    return res.status(200).json({
      summary,
      nextAction,
      generatedAt:new Date().toISOString(),
      organization:{
        peopleCount:Number(stats.people_count)||0,
        sessionsLast30Days:Number(stats.sessions_30d)||0,
        activeAttendeesLast30Days:Number(stats.active_attendees_30d)||0
      },
      signals:{
        observations:observationItems,
        patterns:patternItems,
        actions:actionItems
      }
    });
  }catch(err){
    console.error('[ARIA] Daily intelligence error:',err);
    return res.status(500).json({error:'Unable to load ARIA daily intelligence.'});
  }
}

export default withOrg(handler);
