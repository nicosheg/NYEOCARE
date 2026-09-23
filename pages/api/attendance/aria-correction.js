// pages/api/attendance/aria-correction.js
import pool from'../../../lib/db';
import{withAdmin}from'../../../lib/apiHelpers';
import{updateEngagementMetricsForPerson}from'../../../lib/aria/engagementIntelligence';
import{computeRelationshipScore}from'../../../lib/aria/relationshipScore';
import{updatePeopleIntelligence}from'../../../lib/aria/peopleIntelligence';
import{updatePersonState}from'../../../lib/aria/stateManager';
import{createCareDraft}from'../../../lib/aria/draftEngine';

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);

export default withAdmin(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const{session_id,people_id,present,note='',action_id=null}=req.body||{};
 if(!session_id||!people_id||typeof present!=='boolean')return res.status(400).json({error:'session_id, people_id and present are required.'});
 const orgId=req.org.id,userId=req.user.id,db=await pool.connect();
 try{
  await db.query('BEGIN');
  const session=(await db.query(`SELECT id,name,status,started_at,service_type FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1`,[session_id,orgId])).rows[0];
  if(!session){await db.query('ROLLBACK');return res.status(404).json({error:'Attendance session not found.'})}
  if(session.status!=='closed'){await db.query('ROLLBACK');return res.status(409).json({error:'Only a saved attendance session can be corrected from here.'})}
  const person=(await db.query(`SELECT id,first_name,last_name,display_name FROM people WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1`,[people_id,orgId])).rows[0];
  if(!person){await db.query('ROLLBACK');return res.status(404).json({error:'Person not found.'})}

  const existing=(await db.query(`SELECT id FROM attendance_records WHERE organization_id=$1 AND session_id=$2 AND people_id=$3 LIMIT 1 FOR UPDATE`,[orgId,session_id,people_id])).rows[0];
  if(existing){
   await db.query(`UPDATE attendance_records
     SET present=$1,status=$2,confirmed=true,marked_by=$3,marked_at=NOW(),reviewed_by=$3,reviewed_at=NOW()
     WHERE id=$4 AND organization_id=$5`,[present,present?'present':'not_present',userId,existing.id,orgId]);
  }else{
   await db.query(`INSERT INTO attendance_records(people_id,attendance_date,present,session_id,marked_by,marked_at,status,confirmed,reviewed_by,reviewed_at,organization_id)
     VALUES($1,$2,$3,$4,$5,NOW(),$6,true,$5,NOW(),$7)`,[
      people_id,
      new Date(session.started_at||Date.now()).toISOString().slice(0,10),
      present,
      session_id,
      userId,
      present?'present':'not_present',
      orgId
   ]);
  }

  if(present){
   await db.query(`INSERT INTO participation_records(organization_id,person_id,session_id,participation_type,value,occurred_at)
     VALUES($1,$2,$3,'attendance',$4,$5)
     ON CONFLICT(organization_id,person_id,session_id,participation_type)
       WHERE participation_type='attendance'
     DO UPDATE SET value=EXCLUDED.value,occurred_at=EXCLUDED.occurred_at`,[
      orgId,people_id,session_id,JSON.stringify({present:true,source:'human_attendance_correction'}),session.started_at||new Date().toISOString()
   ]);
   await db.query(`UPDATE aria_attendance_contexts SET resolved_at=NOW(),resolved_by=$1,updated_at=NOW()
     WHERE organization_id=$2 AND person_id=$3 AND session_id=$4 AND resolved_at IS NULL`,[userId,orgId,people_id,session_id]);
  }else{
   await db.query(`DELETE FROM participation_records
     WHERE organization_id=$1 AND person_id=$2 AND session_id=$3 AND participation_type='attendance'`,[orgId,people_id,session_id]);
   await db.query(`INSERT INTO aria_attendance_contexts(organization_id,person_id,session_id,reason_code,reason_note,expected_return_date,expected_service_type,expected_return_known,source,created_by,updated_at,resolved_at,resolved_by)
     VALUES($1,$2,$3,'not_attending',$4,NULL,$5,false,'human',$6,NOW(),NULL,NULL)
     ON CONFLICT(organization_id,session_id,person_id) DO UPDATE SET
       reason_code='not_attending',reason_note=EXCLUDED.reason_note,expected_return_date=NULL,expected_service_type=EXCLUDED.expected_service_type,
       expected_return_known=false,source='human',created_by=EXCLUDED.created_by,updated_at=NOW(),resolved_at=NULL,resolved_by=NULL`,[
        orgId,people_id,session_id,clean(note),session.service_type||null,userId
   ]);
  }

  if(action_id){
   await db.query(`UPDATE aria_actions SET status='cancelled',failure_reason=$1,updated_at=NOW()
     WHERE id=$2 AND organization_id=$3 AND person_id=$4 AND status IN('proposed','approved')`,[
      present?'Resolved by human confirmation: person attended.':'Resolved by human confirmation: person did not attend; follow-up moved to person draft.',action_id,orgId,people_id
   ]);
  }
  await db.query(`UPDATE aria_actions SET status='cancelled',failure_reason=$1,updated_at=NOW()
    WHERE organization_id=$2 AND person_id=$3 AND status IN('proposed','approved')
      AND(
        action_metadata->>'session_id'=$4
        OR action_metadata->>'care_session_id'=$4
        OR action_metadata->>'attendance_session_id'=$4
      )`,[
       present?'Resolved by human attendance correction.':'Attendance context corrected by a human; review action no longer applies.',orgId,people_id,session_id
  ]);
  await db.query(`INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source,occurred_at,created_at)
    VALUES($1,'attendance_correction','Attendance corrected',$2,$3,'human',COALESCE($4::timestamptz,NOW()),NOW())`,[
     people_id,
     present?`Human confirmed ${person.display_name||person.first_name||'this person'} attended ${session.name||'the gathering'}.`:`Human confirmed ${person.display_name||person.first_name||'this person'} did not attend ${session.name||'the gathering'}.`,
     {session_id,service_type:session.service_type||null,present,note:clean(note)},
     session.started_at||null
  ]);
  await db.query('COMMIT');

  await updateEngagementMetricsForPerson(people_id,orgId);
  await computeRelationshipScore(orgId,[people_id]);
  await updatePeopleIntelligence(people_id,orgId);
  await updatePersonState(people_id,orgId);

  let draft=null;
  if(!present){
   try{
    draft=await createCareDraft({
      organizationId:orgId,
      personId:people_id,
      actionType:'attendance_check_in',
      actorId:userId
    });
   }catch(e){console.warn('[ATTENDANCE] follow-up draft skipped:',e?.message||e)}
  }
  return res.status(200).json({success:true,present,session_id,person_id:people_id,resolved:true,draft});
 }catch(e){
  await db.query('ROLLBACK').catch(()=>{});
  console.error('[ATTENDANCE] ARIA correction error:',e);
  return res.status(e.status||500).json({error:e.message||'Could not correct attendance safely.'});
 }finally{db.release()}
});
