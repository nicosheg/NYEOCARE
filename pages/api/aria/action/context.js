// pages/api/aria/action/context.js
import pool from'../../../../lib/db';
import{withOrg}from'../../../../lib/apiHelpers';
import{createCareDraft}from'../../../../lib/aria/draftEngine';

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);

async function resolveAction(req,actionId){
  const r=await pool.query(
    `SELECT a.*,p.first_name,p.last_name,p.display_name,p.phone
     FROM aria_actions a
     JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id
     WHERE a.id=$1 AND a.organization_id=$2 AND a.person_id IS NOT NULL
       AND a.status IN('proposed','approved')
     LIMIT 1`,
    [actionId,req.org.id]
  );
  return r.rows[0]||null;
}

async function assertAttendanceAuthority(req,sessionId){
  const s=await pool.query(
    'SELECT id,status,started_at,service_type,name FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1',
    [sessionId,req.org.id]
  );
  if(!s.rows.length)throw Object.assign(new Error('The attendance session could not be found.'),{status:404});
  const session=s.rows[0];
  if(['owner','admin'].includes(req.user.role))return session;
  if(session.status!=='active')throw Object.assign(new Error('This correction is historical. An owner or admin must confirm it.'),{status:403});
  const member=await pool.query('SELECT 1 FROM session_users WHERE session_id=$1 AND user_id=$2 LIMIT 1',[sessionId,req.user.id]);
  if(!member.rows.length)throw Object.assign(new Error('Join the attendance session before correcting this record.'),{status:403});
  return session;
}

async function upsertAttendance(client,{orgId,personId,sessionId,present,userId}){
  const existing=await client.query(
    'SELECT id FROM attendance_records WHERE organization_id=$1 AND people_id=$2 AND session_id=$3 LIMIT 1',
    [orgId,personId,sessionId]
  );
  if(existing.rows.length){
    const updated=await client.query(
      `UPDATE attendance_records
       SET present=$1,status=$2,confirmed=true,marked_by=$3,marked_at=NOW(),reviewed_by=$3,reviewed_at=NOW()
       WHERE id=$4
       RETURNING id,attendance_date,present,confirmed,marked_at`,
      [present,present?'present':'not_present',userId,existing.rows[0].id]
    );
    return updated.rows[0];
  }
  const session=await client.query('SELECT started_at FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1',[sessionId,orgId]);
  const attendanceDate=new Date(session.rows[0]?.started_at||Date.now()).toISOString().slice(0,10);
  const inserted=await client.query(
    `INSERT INTO attendance_records(
      people_id,attendance_date,present,session_id,marked_by,marked_at,status,confirmed,reviewed_by,reviewed_at,organization_id
     ) VALUES($1,$2,$3,$4,$5,NOW(),$6,true,$5,NOW(),$7)
     RETURNING id,attendance_date,present,confirmed,marked_at`,
    [personId,attendanceDate,present,sessionId,userId,present?'present':'not_present',orgId]
  );
  return inserted.rows[0];
}

export default withOrg(async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const{actionId,attendance,note=''}=req.body||{};
  if(!actionId)return res.status(400).json({error:'actionId is required'});
  if(!['present','absent'].includes(String(attendance)))return res.status(400).json({error:'attendance must be present or absent'});

  try{
    const action=await resolveAction(req,String(actionId));
    if(!action)return res.status(409).json({error:'That ARIA review is no longer waiting for a decision.'});

    const kind=String(action.action_metadata?.kind||'');
    if(!['attendance_absence_check_in','first_session_check_in'].includes(kind)){
      return res.status(409).json({error:'This ARIA review is not an attendance clarification.'});
    }

    const sessionId=String(action.action_metadata?.session_id||'').trim();
    if(!sessionId)return res.status(409).json({error:'This review does not have a specific attendance session to correct.'});

    const session=await assertAttendanceAuthority(req,sessionId);
    const orgId=req.org.id,personId=action.person_id,present=attendance==='present',humanNote=clean(note);
    const client=await pool.connect();
    let attendanceRow=null;
    try{
      await client.query('BEGIN');
      attendanceRow=await upsertAttendance(client,{orgId,personId,sessionId,present,userId:req.user.id});

      if(!present){
        await client.query(
          `INSERT INTO aria_attendance_contexts(
            organization_id,person_id,session_id,reason_code,reason_note,expected_return_date,
            expected_service_type,expected_return_known,source,created_by,updated_at,resolved_at,resolved_by
           ) VALUES($1,$2,$3,'not_attending',$4,NULL,$5,false,'human',$6,NOW(),NULL,NULL)
           ON CONFLICT(organization_id,session_id,person_id) DO UPDATE SET
             reason_code='not_attending',
             reason_note=EXCLUDED.reason_note,
             expected_return_date=NULL,
             expected_service_type=EXCLUDED.expected_service_type,
             expected_return_known=false,
             source='human',
             created_by=EXCLUDED.created_by,
             updated_at=NOW(),
             resolved_at=NULL,
             resolved_by=NULL`,
          [orgId,personId,sessionId,humanNote||'Person confirmed they did not attend this session.',session.service_type||null,req.user.id]
        );
      }

      await client.query(
        `INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source,occurred_at,created_at)
         VALUES($1,'attendance_clarified','Attendance clarified',$2,$3,'human',NOW(),NOW())`,
        [personId,
         present
           ?`Human confirmation: the person said they attended ${session.name||'this session'}.`
           :`Human confirmation: the person said they did not attend ${session.name||'this session'}.`,
         {action_id:action.id,session_id:sessionId,attendance:present?'present':'absent',note:humanNote||null,source:'review_context'}]
      );

      if(action.observation_id){
        await client.query(
          `UPDATE aria_observations
           SET status='resolved',resolved_at=NOW()
           WHERE id=$1 AND organization_id=$2 AND person_id=$3 AND type='UNUSUAL_ABSENCE' AND status='active'`,
          [action.observation_id,orgId,personId]
        );
      }

      await client.query(
        `UPDATE aria_actions SET status='handled',
          outcome=$2::jsonb,
          failure_reason=NULL,
          action_metadata=COALESCE(action_metadata,'{}'::jsonb)||$3::jsonb,
          updated_at=NOW()
         WHERE id=$1 AND organization_id=$4 AND status IN('proposed','approved')`,
        [action.id,
         JSON.stringify({resolution:present?'attendance_confirmed':'absence_confirmed',handled_by:req.user.id,at:new Date().toISOString()}),
         JSON.stringify({human_attendance:present?'present':'absent',human_note:humanNote||null,handled_by_human:true}),
         orgId]
      );

      await client.query('COMMIT');
    }catch(e){
      await client.query('ROLLBACK').catch(()=>{});
      throw e;
    }finally{
      client.release();
    }

    let draft=null;
    if(!present){
      try{
        const existingDraft=await pool.query(
          `SELECT id,person_id,channel,direction,status,content,metadata,occurred_at,created_at
           FROM person_communications
           WHERE organization_id=$1 AND person_id=$2 AND status='draft' AND metadata->>'action_id'=$3
           ORDER BY created_at DESC LIMIT 1`,
          [orgId,personId,action.id]
        );
        if(existingDraft.rows[0]){
          const raw=action.phone||'';
          const digits=String(raw).replace(/\D/g,'');
          const whatsappPhone=digits.startsWith('00')?digits.slice(2):digits.startsWith('234')?digits:digits.startsWith('0')&&digits.length===11?'234'+digits.slice(1):/^[789]\d{9}$/.test(digits)?'234'+digits:digits;
          draft={message:existingDraft.rows[0].content,communication:existingDraft.rows[0],requiresHumanApproval:true,requiresHumanSend:true,whatsappUrl:whatsappPhone?\`https://wa.me/\${whatsappPhone}?text=\${encodeURIComponent(existingDraft.rows[0].content||'')}\`:null};
        }else{
          draft=await createCareDraft({organizationId:orgId,personId,actionId:action.id,actionType:'thoughtful_check_in',actorId:req.user.id});
        }
      }catch(e){
        await pool.query(
          `UPDATE aria_actions SET status='proposed',
            failure_reason=$1,
            updated_at=NOW()
           WHERE id=$2 AND organization_id=$3 AND status='handled'`,
          ['Attendance was confirmed as absent, but the message draft could not be prepared automatically.',action.id,orgId]
        ).catch(()=>{});
        throw Object.assign(new Error('Attendance was updated, but ARIA could not prepare the message yet. The review is available again.'),{status:502});
      }

      const handled=await pool.query(
        `UPDATE aria_actions SET status='handled',
          outcome=COALESCE(outcome,'{}'::jsonb)||$1::jsonb,
          updated_at=NOW()
         WHERE id=$2 AND organization_id=$3
         RETURNING id,status,person_id,type,priority,action_metadata,outcome,updated_at`,
        [JSON.stringify({draft_prepared:true}),action.id,orgId]
      );
      return res.status(200).json({success:true,resolution:'absent',attendance:attendanceRow,action:handled.rows[0]||null,draft,session:{id:session.id,name:session.name}});
    }

    const handled=await pool.query(
      `SELECT id,status,person_id,type,priority,action_metadata,outcome,updated_at
       FROM aria_actions WHERE id=$1 AND organization_id=$2 LIMIT 1`,
      [action.id,orgId]
    );
    return res.status(200).json({success:true,resolution:'present',attendance:attendanceRow,action:handled.rows[0]||null,draft:null,session:{id:session.id,name:session.name}});
  }catch(e){
    console.error('[ARIA] attendance context',e);
    return res.status(e.status||500).json({error:e.message||'ARIA could not apply that context.'});
  }
});
