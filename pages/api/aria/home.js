// pages/api/aria/home.js
// ARIA Today — production home intelligence.
// Uses only tables that exist in the current FIDUCIA CARE schema.
// FACTS → OBSERVATIONS → PATTERNS → NEXT ACTION.
// Never invents urgency when there is insufficient evidence.

import pool from '../../../lib/db';
import {withOrg} from '../../../lib/apiHelpers';

async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});

  const orgId=req.org.id;

  try{
    const peopleRes=await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM people
       WHERE organization_id=$1
         AND status='active'`,
      [orgId]
    );

    const sessionsRes=await pool.query(
      `SELECT COUNT(*)::int AS count,
              COUNT(*) FILTER(
                WHERE started_at>=NOW()-INTERVAL '30 days'
              )::int AS last_30_days
       FROM sessions
       WHERE organization_id=$1`,
      [orgId]
    );

    const attendanceRes=await pool.query(
      `SELECT
         COUNT(*) FILTER(WHERE present=true)::int AS present_count,
         COUNT(DISTINCT people_id) FILTER(
           WHERE present=true
         )::int AS active_attendees,
         COUNT(DISTINCT attendance_date)::int AS attendance_days,
         COUNT(DISTINCT people_id) FILTER(
           WHERE present=true
           AND attendance_date>=CURRENT_DATE-INTERVAL '30 days'
         )::int AS active_attendees_30d
       FROM attendance_records
       WHERE organization_id=$1`,
      [orgId]
    );

    const observationRes=await pool.query(
      `SELECT
         id,
         person_id,
         type,
         confidence,
         severity,
         urgency,
         attention_score,
         evidence,
         detected_at
       FROM aria_observations
       WHERE organization_id=$1
         AND status='active'
         AND(
           expires_at IS NULL
           OR expires_at>NOW()
         )
       ORDER BY attention_score DESC,detected_at DESC
       LIMIT 10`,
      [orgId]
    );

    const actionRes=await pool.query(
      `SELECT
         a.id,
         a.person_id,
         a.observation_id,
         a.type,
         a.status,
         a.priority,
         a.action_metadata,
         a.proposed_at,
         p.first_name,
         p.last_name,
         p.phone
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
           WHEN 'low' THEN 1
           ELSE 0
         END DESC,
         a.proposed_at ASC
       LIMIT 10`,
      [orgId]
    );

    const people=Number(peopleRes.rows[0]?.count)||0;
    const sessions=Number(sessionsRes.rows[0]?.count)||0;
    const sessions30=Number(sessionsRes.rows[0]?.last_30_days)||0;
    const attendance=attendanceRes.rows[0]||{};
    const presentCount=Number(attendance.present_count)||0;
    const activeAttendees=Number(attendance.active_attendees)||0;
    const attendanceDays=Number(attendance.attendance_days)||0;
    const activeAttendees30=Number(attendance.active_attendees_30d)||0;
    const observations=observationRes.rows;
    const actions=actionRes.rows;

    const critical=observations.filter(o=>o.severity==='critical');
    const high=observations.filter(o=>o.severity==='high');
    const meaningful=observations.filter(
      o=>Number(o.attention_score)>=40
    );

    // PATTERN: repeated absence among people with recorded attendance history.
    const absencePatternRes=await pool.query(
      `WITH person_attendance AS(
         SELECT
           people_id,
           COUNT(DISTINCT attendance_date) FILTER(
             WHERE present=true
           )::int AS present_days,
           COUNT(DISTINCT attendance_date)::int AS recorded_days,
           MAX(attendance_date) FILTER(
             WHERE present=true
           ) AS last_present
         FROM attendance_records
         WHERE organization_id=$1
         GROUP BY people_id
       )
       SELECT COUNT(*)::int AS count
       FROM person_attendance
       WHERE recorded_days>=3
         AND present_days>0
         AND last_present<CURRENT_DATE-INTERVAL '21 days'`,
      [orgId]
    );

    const slippingPeople=Number(
      absencePatternRes.rows[0]?.count
    )||0;

    let state='observing';
    let title='ARIA is watching for meaningful changes.';
    let summary='Your people are being remembered. ARIA will surface patterns when there is enough evidence.';
    let nextAction={
      type:'NONE',
      title:'Keep observing',
      description:'No action is required right now.'
    };

    if(people===0){
      state='empty';
      title="You're just getting started.";
      summary='Begin with your people. Scan your first register and ARIA will start building the memory needed to notice meaningful changes over time.';
      nextAction={
        type:'SCAN',
        title:'Scan your first register',
        description:'Add your people so ARIA can begin learning the organization.'
      };
    }else if(meaningful.length===0&&actions.length===0&&sessions===0){
      state='starting';
      title='Your people are here. Now ARIA can begin learning.';
      summary=`ARIA remembers ${people} active ${people===1?'person':'people'}. The next step is to record your first session so patterns can emerge over time.`;
      nextAction={
        type:'SCAN_OR_SESSION',
        title:'Record your first session',
        description:'Capture attendance and participation so ARIA can begin detecting meaningful changes.'
      };
    }else if(critical.length>0){
      state='critical';
      const o=critical[0];
      title='Something important needs attention.';
      summary=o.evidence?.inference||'ARIA found a signal that deserves human attention.';
      nextAction={
        type:'REVIEW',
        title:'Review the highest-priority signal',
        description:'ARIA recommends checking this situation before taking further action.',
        observationId:o.id,
        personId:o.person_id
      };
    }else if(high.length>0){
      state='attention';
      const o=high[0];
      title='ARIA noticed something worth checking.';
      summary=o.evidence?.inference||'A meaningful change has appeared in your organization.';
      nextAction={
        type:'REVIEW',
        title:'Review this signal',
        description:'Look at the evidence before deciding what to do next.',
        observationId:o.id,
        personId:o.person_id
      };
    }else if(actions.length>0){
      state='action';
      const a=actions[0];
      title='ARIA has a next step for you.';
      summary=a.first_name
        ? `${a.first_name} has a situation that may deserve your attention.`
        :'ARIA has identified a possible next step.';
      nextAction={
        type:a.type,
        title:a.type==='REQUEST_REVIEW'
          ?'Review the recommendation'
          :a.type==='SEND_MESSAGE'
          ?'Review the suggested message'
          :a.type==='ESCALATE'
          ?'Review the escalation'
          :'Review the next action',
        description:'ARIA recommends reviewing this before taking action.',
        actionId:a.id,
        personId:a.person_id
      };
    }else if(slippingPeople>0){
      state='pattern';
      title='ARIA is seeing a pattern worth watching.';
      summary=`${slippingPeople} ${slippingPeople===1?'person has':'people have'} a recorded attendance pattern that may indicate they are becoming less present. This is a pattern, not a prediction.`;
      nextAction={
        type:'REVIEW_PATTERN',
        title:'Review the attendance pattern',
        description:'Look at the people involved and decide whether anyone needs personal attention.'
      };
    }else{
      title='ARIA is watching for meaningful changes.';
      summary='Nothing significant requires your attention right now. ARIA will continue watching the patterns.';
      nextAction={
        type:'NONE',
        title:'Keep observing',
        description:'No action is required right now.'
      };
    }

    return res.status(200).json({
      state,
      title,
      summary,
      nextAction,
      stats:{
        people,
        sessions,
        sessions30,
        activeAttendees,
        activeAttendees30,
        attendanceDays
      },
      signals:{
        activeObservations:observations.length,
        meaningfulObservations:meaningful.length,
        critical:critical.length,
        high:high.length,
        slippingPeople
      },
      observations,
      actions
    });
  }catch(err){
    console.error('[ARIA] Home intelligence error:',err);
    return res.status(500).json({
      error:'Unable to load ARIA Today.'
    });
  }
}

export default withOrg(handler);
