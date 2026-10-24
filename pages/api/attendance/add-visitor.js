// pages/api/attendance/add-visitor.js
// Adds only a Visitor while the authenticated operator is participating in an active session.
// request_id makes retries safe when a weak connection loses the response after commit.
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { normalizePhone } from '../../../lib/phoneUtils';
import { normalizeDisplayName } from '../../../lib/scanValidation';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';
import { directAriaEvent } from '../../../lib/aria/director';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_RE=/^[A-Za-z0-9_-]{20,80}$/;

export default withOrg(async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }

  const sessionId=String(req.body?.session_id||'').trim();
  const requestId=String(req.body?.request_id||'').trim();
  const rawName=String(req.body?.full_name||'').trim();
  const rawPhone=String(req.body?.phone||'').trim();
  const contactConsent=req.body?.contact_consent===true;

  if(!UUID_RE.test(sessionId))return res.status(400).json({error:'A valid active attendance session is required.'});
  if(!REQUEST_ID_RE.test(requestId))return res.status(400).json({error:'A valid visitor request ID is required.'});
  if(!rawName||rawName.length>180)return res.status(400).json({error:'Enter a visitor name of no more than 180 characters.'});
  const normalizedName=normalizeDisplayName(rawName);
  const nameParts=String(normalizedName.core||'').split(/\s+/).filter(Boolean);
  const firstName=nameParts.shift()||'';
  const lastName=nameParts.join(' ');
  if(!firstName||firstName.length>150||lastName.length>150)return res.status(400).json({error:'Please enter a readable visitor name.'});

  const phone=normalizePhone(rawPhone);
  if(rawPhone&&!phone)return res.status(400).json({error:'That phone number could not be validated. Correct it or leave the phone field empty.'});
  if(phone&&!contactConsent)return res.status(400).json({error:'Please confirm that the visitor agreed to the church keeping this phone number for follow-up.'});

  const orgId=req.org.id,userId=req.user.id,client=await pool.connect();
  let person=null,alreadyCreated=false,effectiveSessionId=sessionId;
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['people-bulk-create:'+orgId]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['attendance-add-visitor:'+orgId+':'+userId+':'+requestId]);

    // This lookup deliberately precedes session validation. A retry after the
    // original commit must return the same person even if the service was closed
    // before the phone could receive the first response.
    const prior=(await client.query(
      `SELECT id,first_name,last_name,display_name,phone,phone_numbers,type,status,created_at,metadata
       FROM people
       WHERE organization_id=$1 AND created_by=$3
         AND metadata->>'attendance_add_visitor_request_id'=$2
       LIMIT 1
       FOR UPDATE`,
      [orgId,requestId,userId]
    )).rows[0];

    if(prior){
      person=prior;
      alreadyCreated=true;
      effectiveSessionId=String(prior.metadata?.attendance_add_visitor_session_id||sessionId);
    }else{
      const session=(await client.query(
        "SELECT id FROM sessions WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1 FOR UPDATE",
        [sessionId,orgId]
      )).rows[0];
      if(!session){
        await client.query('ROLLBACK');
        return res.status(409).json({error:'This attendance session is no longer active. Refresh attendance before adding a visitor.'});
      }

      const joined=(await client.query(
        'SELECT 1 FROM session_users WHERE session_id=$1 AND user_id=$2 LIMIT 1',
        [sessionId,userId]
      )).rows[0];
      if(!joined){
        await client.query('ROLLBACK');
        return res.status(403).json({error:'Join this attendance session before adding a visitor.'});
      }

      if(phone){
        const digits=phone.replace(/\D/g,'');
        const localDigits=digits.startsWith('234')?'0'+digits.slice(3):digits;
        const duplicate=(await client.query(
          `SELECT 1
           FROM people p
           WHERE p.organization_id=$1 AND COALESCE(p.status,'active')='active'
             AND (
               regexp_replace(COALESCE(p.phone,''),'\\D','','g')=ANY($2::text[])
               OR EXISTS(
                 SELECT 1 FROM jsonb_array_elements(COALESCE(p.phone_numbers,'[]'::jsonb)) v
                 WHERE regexp_replace(COALESCE(v->>'normalized',''),'\\D','','g')=ANY($2::text[])
                    OR regexp_replace(COALESCE(v->>'raw',''),'\\D','','g')=ANY($2::text[])
               )
             )
           LIMIT 1`,
          [orgId,[digits,localDigits]]
        )).rows[0];
        if(duplicate){
          await client.query('ROLLBACK');
          return res.status(409).json({error:'A person with this phone number already exists in this organization. Search the attendance list and use the existing record.',code:'DUPLICATE_ACTIVE_PERSON'});
        }
      }

      const now=new Date().toISOString();
      const metadata={
        attendance_add_visitor_request_id:requestId,
        attendance_add_visitor_session_id:sessionId,
        ...(phone?{
          contact_consent:{
            phone:true,
            status:'granted',
            source:'attendance_add_visitor',
            recorded_by:userId,
            recorded_at:now
          }
        }:{})
      };
      const phoneNumbers=phone?[{raw:rawPhone,normalized:phone,source:'attendance_add_visitor',verified:false}]:[];
      person=(await client.query(
        `INSERT INTO people(
           organization_id,first_name,last_name,display_name,phone,phone_numbers,
           type,status,source,created_by,metadata,living_truth
         )
         VALUES($1,$2,$3,$4,$5,$6::jsonb,'visitor','active','manual',$7,$8::jsonb,$9::jsonb)
         RETURNING id,first_name,last_name,display_name,phone,phone_numbers,type,status,created_at`,
        [
          orgId,firstName,lastName,normalizedName.display||null,phone,JSON.stringify(phoneNumbers),
          userId,JSON.stringify(metadata),
          JSON.stringify({status:'alive',confidence:90,source:'canonical_record',updated_at:now})
        ]
      )).rows[0];
    }

    await client.query('COMMIT');
  }catch(err){
    try{await client.query('ROLLBACK')}catch{}
    console.error('[ATTENDANCE] Add visitor error:',err);
    return res.status(500).json({error:'Could not add this visitor yet. Attendance has not been changed.'});
  }finally{
    client.release();
  }

  try{
    const context=(await pool.query(
      `SELECT
         CASE WHEN lower(BTRIM(COALESCE(p.type,'')))='visitor'
           AND NOT EXISTS(
             SELECT 1 FROM participation_records previous
             WHERE previous.organization_id=p.organization_id
               AND previous.person_id=p.id
               AND previous.participation_type='attendance'
               AND previous.session_id IS DISTINCT FROM s.id
               AND previous.occurred_at<s.started_at
           )
           AND NOT EXISTS(
             SELECT 1
             FROM attendance_records prior
             LEFT JOIN sessions prior_session
               ON prior_session.id=prior.session_id
              AND prior_session.organization_id=prior.organization_id
             WHERE prior.organization_id=p.organization_id
               AND prior.people_id=p.id
               AND prior.present=true
               AND prior.confirmed=true
               AND prior.session_id IS DISTINCT FROM s.id
               AND COALESCE(prior_session.started_at,prior.attendance_date::timestamptz,prior.marked_at)<s.started_at
           ) THEN true ELSE false END AS first_visit_candidate,
         EXISTS(
           SELECT 1 FROM care_feedback wf
           WHERE wf.organization_id=p.organization_id
             AND wf.person_id=p.id
             AND wf.context->>'source'='first_visit_welcome_during_attendance'
             AND wf.context->>'session_id'=s.id::text
             AND wf.context->>'outcome'='met_in_person'
             AND wf.verification_status='reported'
         ) AS first_visit_welcome_recorded
       FROM people p
       JOIN sessions s ON s.id=$2 AND s.organization_id=p.organization_id
       WHERE p.id=$1 AND p.organization_id=$3
       LIMIT 1`,
      [person.id,effectiveSessionId,orgId]
    )).rows[0];
    const publicPerson={...person};
    delete publicPerson.metadata;
    person={...publicPerson,
      first_visit_candidate:context?.first_visit_candidate===true,
      first_visit_welcome_recorded:context?.first_visit_welcome_recorded===true
    };
    const event=await emitAriaEvent({
      organizationId:orgId,personId:person.id,type:'PERSON_CREATED',source:'manual',
      actorId:userId,actorRole:req.user.role,evidenceKind:'human_report',verificationStatus:'reported',confidence:1,
      metadata:{source:'attendance_add_visitor',session_id:effectiveSessionId,type:'visitor',contact_consent:Boolean(phone),request_id:requestId},
      eventKey:'attendance-add-visitor:'+orgId+':'+userId+':'+requestId
    });
    if(event)await directAriaEvent(event);
  }catch(err){console.error('[ATTENDANCE] Visitor created but ARIA event processing was deferred:',err)}

  return res.status(alreadyCreated?200:201).json({success:true,person,already_exists:alreadyCreated});
});
