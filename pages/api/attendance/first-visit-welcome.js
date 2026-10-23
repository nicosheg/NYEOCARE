// pages/api/attendance/first-visit-welcome.js
// Records a human, in-person first-visit welcome during live attendance.
// This is a disposition record only: it never sends a message.
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';
import { processAriaEvent } from '../../../lib/aria/eventProcessor';
import { learnFromFeedback } from '../../../lib/aria/learningEngine';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default withOrg(async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }
  const sessionId=String(req.body?.session_id||'').trim();
  const personId=String(req.body?.people_id||'').trim();
  if(!UUID_RE.test(sessionId)||!UUID_RE.test(personId)){
    return res.status(400).json({error:'A valid attendance session and person are required.'});
  }

  const orgId=req.org.id,userId=req.user.id,client=await pool.connect();
  let event=null,feedback=null;
  try{
    await client.query('BEGIN');
    // Match close-session's organization lock. The welcome either commits before
    // session processing starts, or is refused after the session has closed.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))',[orgId]);

    const access=await client.query(
      `SELECT s.id session_id,s.name session_name,s.status session_status,s.started_at,
              p.id person_id,p.type person_type,
              EXISTS(
                SELECT 1 FROM attendance_records ar
                WHERE ar.organization_id=$1 AND ar.session_id=s.id AND ar.people_id=p.id
                  AND ar.present=true
              ) marked_present
       FROM sessions s
       JOIN session_users su ON su.session_id=s.id AND su.user_id=$4
       JOIN people p ON p.id=$3 AND p.organization_id=s.organization_id
       WHERE s.id=$2 AND s.organization_id=$1
       LIMIT 1
       FOR UPDATE OF s,p`,
      [orgId,sessionId,personId,userId]
    );
    const current=access.rows[0];
    if(!current){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'This person or attendance session is not available in your organization.'});
    }

    const existing=(await client.query(
      `SELECT id FROM care_feedback
       WHERE organization_id=$1 AND person_id=$2
         AND context->>'source'='first_visit_welcome_during_attendance'
         AND context->>'session_id'=$3
         AND context->>'outcome'='met_in_person'
         AND verification_status='reported'
       ORDER BY created_at DESC LIMIT 1`,
      [orgId,personId,sessionId]
    )).rows[0];
    if(existing){
      await client.query('COMMIT');
      return res.status(200).json({success:true,recorded:true,already_recorded:true,feedback_id:existing.id});
    }

    if(current.session_status!=='active'){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'This attendance session has closed. Record the welcome outcome in ARIA Today instead.'});
    }
    if(String(current.person_type||'').toLowerCase().trim()!=='visitor'||current.marked_present!==true){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Mark this visitor present first. Only a present visitor with no earlier recorded attendance can receive this first-visit disposition.'});
    }

    const previous=(await client.query(
      `SELECT 1 FROM participation_records
       WHERE organization_id=$1 AND person_id=$2
         AND participation_type='attendance'
         AND session_id<>$3
         AND occurred_at<$4
       LIMIT 1`,
      [orgId,personId,sessionId,current.started_at]
    )).rows[0];
    if(previous){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'NYEOCARE has earlier attendance recorded for this person. Keep this as a normal welcome, not a first-visit disposition.'});
    }

    const doNotContact=(await client.query(
      `SELECT 1 FROM aria_care_contexts
       WHERE organization_id=$1 AND person_id=$2
         AND kind='other' AND metadata->>'do_not_contact'='true'
         AND starts_on<=$3::date AND (ends_on IS NULL OR ends_on>=$3::date)
       LIMIT 1`,
      [orgId,personId,current.started_at]
    )).rows[0];
    if(doNotContact){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'This person has a recorded no-contact preference. Do not initiate outreach.'});
    }

    const context={
      source:'first_visit_welcome_during_attendance',
      outcome:'met_in_person',
      outcome_label:'Welcomed in person',
      session_id:sessionId,
      session_name:current.session_name,
      recorded_by:userId,
      recorded_by_role:req.user.role,
      disposition_timing:'during_attendance',
      human_reported:true
    };
    feedback=(await client.query(
      `INSERT INTO care_feedback(
        organization_id,person_id,action_id,actor_id,feedback_type,sentiment,note,context,
        observed_at,evidence_kind,verification_status,confidence,created_at,updated_at
       ) VALUES($1,$2,NULL,$3,'other','positive',$4,$5::jsonb,NOW(),'human_report','reported',1,NOW(),NOW())
       RETURNING id,feedback_type,sentiment,observed_at`,
      [orgId,personId,userId,'Welcomed in person during attendance.',JSON.stringify(context)]
    )).rows[0];

    await client.query(
      `INSERT INTO intelligence_outcomes(
        organization_id,person_id,action_id,action_type,outcome,outcome_score,evidence,actor_id,
        feedback_id,observed_at,evidence_kind,verification_status,confidence,created_at
       ) VALUES($1,$2,NULL,'follow_up','met_in_person',NULL,$3::jsonb,$4,$5,NOW(),'human_report','reported',1,NOW())`,
      [orgId,personId,JSON.stringify(context),userId,feedback.id]
    );

    await client.query(
      `INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source,occurred_at,created_at)
       VALUES($1,'first_visit_welcome','Welcomed in person','Welcomed in person during attendance.',$2::jsonb,'human',NOW(),NOW())`,
      [personId,JSON.stringify(context)]
    );

    event=await emitAriaEvent({
      organizationId:orgId,
      personId,
      type:'CARE_FEEDBACK',
      source:'human',
      actorId:userId,
      actorRole:req.user.role,
      evidenceKind:'human_report',
      verificationStatus:'reported',
      confidence:1,
      metadata:{
        feedback_id:feedback.id,
        feedback_type:'other',
        sentiment:'positive',
        statement:'Welcomed in person during attendance.',
        outcome:{outcome:'met_in_person',feedback_id:feedback.id},
        follow_up_context:context
      },
      eventKey:'first-visit-welcome-during-attendance:'+sessionId+':'+personId
    },client);

    await client.query('COMMIT');

    if(event){
      try{await processAriaEvent(event)}catch(error){
        console.error('[ARIA] In-attendance first-visit event processing failed:',error?.message||error);
      }
    }
    try{
      await learnFromFeedback({
        organizationId:orgId,
        personId,
        feedbackId:feedback.id,
        actionId:null,
        feedbackType:'other',
        sentiment:'positive',
        context,
        actorId:userId
      });
    }catch(error){
      console.error('[ARIA] In-attendance welcome learning failed:',error?.message||error);
    }
    return res.status(200).json({success:true,recorded:true,already_recorded:false,feedback_id:feedback.id});
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[ATTENDANCE] First-visit welcome could not be saved:',error?.message||error);
    return res.status(500).json({error:'The welcome could not be recorded safely. Attendance remains unchanged.'});
  }finally{
    client.release();
  }
});
