// pages/api/aria/action/context.js
import pool from'../../../../lib/db';
import{withOrg}from'../../../../lib/apiHelpers';
import{createCareDraft}from'../../../../lib/aria/draftEngine';import{refreshAttendanceIntelligence}from'../../../../lib/aria/attendanceIntelligence';

const clean=v=>String(v??'').trim().slice(0,1000);

export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const{actionId,attendance,note=''}=req.body||{};
 if(!actionId)return res.status(400).json({error:'actionId is required'});
 if(!['present','absent'].includes(String(attendance)))return res.status(400).json({error:'attendance must be present or absent'});

 try{
  const a=(await pool.query(
   `SELECT a.*,p.display_name,p.first_name,p.last_name,
           s.id session_id,s.status session_status,s.started_at,s.name session_name,s.service_type
    FROM aria_actions a
    JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id
    LEFT JOIN sessions s ON s.id=(a.action_metadata->>'session_id')::uuid AND s.organization_id=a.organization_id
    WHERE a.id=$1 AND a.organization_id=$2 AND a.status IN('proposed','approved')
    LIMIT 1`,
   [String(actionId),req.org.id]
  )).rows[0]||null;

  if(!a)return res.status(409).json({error:'That ARIA review is no longer waiting for a decision.'});
  if(!['attendance_absence_check_in','first_session_check_in'].includes(String(a.action_metadata?.kind||''))||!a.session_id){
   return res.status(409).json({error:'This ARIA review is not an attendance clarification.'});
  }
  if(!a.session_status)return res.status(404).json({error:'The attendance session could not be found.'});

  if(!['owner','admin'].includes(req.user.role)){
   const member=await pool.query('SELECT 1 FROM session_users WHERE session_id=$1 AND user_id=$2 LIMIT 1',[a.session_id,req.user.id]);
   if(!member.rows.length)return res.status(403).json({error:'Only a person who participated in this attendance session can correct this ARIA review.'});
  }

  const present=attendance==='present';
  const humanNote=clean(note);
  const client=await pool.connect();
  let attendanceRow=null;
  try{
   await client.query('BEGIN');
   const existing=(await client.query(
    'SELECT id FROM attendance_records WHERE organization_id=$1 AND people_id=$2 AND session_id=$3 LIMIT 1',
    [req.org.id,a.person_id,a.session_id]
   )).rows[0]||null;

   if(existing){
    attendanceRow=(await client.query(
     `UPDATE attendance_records
      SET present=$1,status=$2,confirmed=true,marked_by=$3,marked_at=NOW(),reviewed_by=$3,reviewed_at=NOW()
      WHERE id=$4 RETURNING id,attendance_date,present,confirmed,marked_at`,
     [present,present?'present':'not_present',req.user.id,existing.id]
    )).rows[0];
   }else{
    attendanceRow=(await client.query(
     `INSERT INTO attendance_records(
       people_id,attendance_date,present,session_id,marked_by,marked_at,status,confirmed,reviewed_by,reviewed_at,organization_id
      ) VALUES($1,$2,$3,$4,$5,NOW(),$6,true,$5,NOW(),$7)
      RETURNING id,attendance_date,present,confirmed,marked_at`,
     [a.person_id,new Date(a.started_at||Date.now()).toISOString().slice(0,10),present,a.session_id,req.user.id,present?'present':'not_present',req.org.id]
    )).rows[0];
   }

   if(present){
    await client.query(
     `INSERT INTO participation_records(
       organization_id,person_id,session_id,participation_type,value,occurred_at
      )
      VALUES($1,$2,$3,'attendance',jsonb_build_object('present',true,'source','aria_human_correction'),COALESCE($4,NOW()))
      ON CONFLICT(organization_id,person_id,session_id,participation_type)
        WHERE participation_type='attendance' DO NOTHING`,
     [req.org.id,a.person_id,a.session_id,a.started_at]
    );
   }else{
    await client.query(
     `DELETE FROM participation_records
      WHERE organization_id=$1 AND person_id=$2 AND session_id=$3 AND participation_type='attendance'`,
     [req.org.id,a.person_id,a.session_id]
    );
   }

   if(!present){
    await client.query(
     `INSERT INTO aria_attendance_contexts(
       organization_id,person_id,session_id,reason_code,reason_note,expected_service_type,
       expected_return_known,source,created_by,updated_at
      ) VALUES($1,$2,$3,'not_attending',$4,$5,false,'human',$6,NOW())
      ON CONFLICT(organization_id,session_id,person_id) DO UPDATE SET
       reason_code='not_attending',reason_note=EXCLUDED.reason_note,
       expected_service_type=EXCLUDED.expected_service_type,expected_return_known=false,
       source='human',created_by=EXCLUDED.created_by,updated_at=NOW(),
       resolved_at=NULL,resolved_by=NULL`,
     [req.org.id,a.person_id,a.session_id,humanNote||'Person confirmed they did not attend this session.',a.service_type||null,req.user.id]
    );
   }

   await client.query(
    `INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source,occurred_at,created_at)
     VALUES($1,'attendance_clarified','Attendance clarified',$2,$3,'human',NOW(),NOW())`,
    [a.person_id,present?'Person confirmed they attended '+(a.session_name||'this session')+'.':'Person confirmed they did not attend '+(a.session_name||'this session')+'.',
     {action_id:a.id,session_id:a.session_id,attendance:present?'present':'absent',note:humanNote||null}]
   );

   if(a.observation_id){
    await client.query(
     `UPDATE aria_observations SET status='resolved',resolved_at=NOW()
      WHERE id=$1 AND organization_id=$2 AND person_id=$3 AND type='UNUSUAL_ABSENCE' AND status='active'`,
     [a.observation_id,req.org.id,a.person_id]
    );
   }

   await client.query(
    `UPDATE aria_actions SET status='handled',
      outcome=COALESCE(outcome,'{}'::jsonb)||$1::jsonb,
      action_metadata=COALESCE(action_metadata,'{}'::jsonb)||$2::jsonb,
      failure_reason=NULL,updated_at=NOW()
     WHERE id=$3 AND organization_id=$4 AND status IN('proposed','approved')`,
    [JSON.stringify({resolution:present?'attendance_confirmed':'absence_confirmed',handled_by:req.user.id}),
     JSON.stringify({human_attendance:present?'present':'absent',human_note:humanNote||null,handled_by_human:true}),
     a.id,req.org.id]
   );

   await client.query('COMMIT');
  }catch(e){
   await client.query('ROLLBACK').catch(()=>{});
   throw e;
  }finally{client.release()}

  // Recompute the affected person's attendance-derived intelligence from the corrected canonical record.
  // The linked absence observation remains present until this refresh so the affected person is in the refresh target.
  await refreshAttendanceIntelligence(a.session_id,req.org.id);
  if(a.observation_id){
   await pool.query(
    `UPDATE aria_observations SET status='resolved',resolved_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND person_id=$3 AND status='active'`,
    [a.observation_id,req.org.id,a.person_id]
   );
  }

  let draft=null;
  if(!present){
   draft=await createCareDraft({
    organizationId:req.org.id,
    personId:a.person_id,
    actionId:a.id,
    actionType:'thoughtful_check_in',
    actorId:req.user.id
   });

   const updated=(await pool.query(
    `UPDATE aria_actions
     SET outcome=COALESCE(outcome,'{}'::jsonb)||$1::jsonb,updated_at=NOW()
     WHERE id=$2 AND organization_id=$3
     RETURNING id,status,person_id,type,priority,action_metadata,outcome,updated_at`,
    [JSON.stringify({draft_prepared:true}),a.id,req.org.id]
   )).rows[0]||null;
   return res.status(200).json({success:true,resolution:'absent',attendance:attendanceRow,action:updated,draft,session:{id:a.session_id,name:a.session_name}});
  }

  const handled=(await pool.query(
   'SELECT id,status,person_id,type,priority,action_metadata,outcome,updated_at FROM aria_actions WHERE id=$1 AND organization_id=$2 LIMIT 1',
   [a.id,req.org.id]
  )).rows[0]||null;

  return res.status(200).json({success:true,resolution:'present',attendance:attendanceRow,action:handled,draft:null,session:{id:a.session_id,name:a.session_name}});
 });
