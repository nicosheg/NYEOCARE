// lib/aria/careEngine.js
import pool from'../db';

const TYPES={
 welcome_and_onboard:{type:'SEND_MESSAGE',priority:'medium',template:'welcome'},
 continue_onboarding:{type:'SEND_MESSAGE',priority:'medium',template:'onboarding'},
 thoughtful_check_in:{type:'SEND_MESSAGE',priority:'low',template:'thoughtful_check_in'},
 strengthen_relationship:{type:'SEND_MESSAGE',priority:'low',template:'strengthen_relationship'},
 adjust_care_approach:{type:'SEND_MESSAGE',priority:'medium',template:'adjust_approach'}
};

export async function generateCareRecommendations(orgId){
 if(!orgId)throw new Error('orgId required');
 const r=await pool.query(`SELECT p.id person_id,p.first_name,p.last_name,p.display_name,p.phone,pi.lifecycle_state,pi.next_best_action,pi.action_reason,pi.attention_level,pi.attention_score FROM people p JOIN people_intelligence pi ON pi.organization_id=p.organization_id AND pi.person_id=p.id WHERE p.organization_id=$1 AND p.status='active' AND pi.next_best_action IS NOT NULL`,[orgId]);
 if(!r.rows.length)return[];
 const open=await pool.query(`SELECT DISTINCT person_id FROM aria_actions WHERE organization_id=$1 AND status IN('proposed','approved','executing') AND person_id=ANY($2::uuid[])`,[orgId,r.rows.map(x=>x.person_id)]);
 const openPeople=new Set(open.rows.map(x=>String(x.person_id)));
 const payload=r.rows.map(row=>{
  const spec=TYPES[row.next_best_action];
  if(!spec||openPeople.has(String(row.person_id)))return null;
  return{person_id:row.person_id,action_type:spec.type,priority:spec.priority,template:spec.template,reason:row.action_reason||'ARIA identified a meaningful opportunity to care.',action_key:`care:${orgId}:${row.person_id}:${row.next_best_action}`};
 }).filter(Boolean);
 if(!payload.length)return[];
 const inserted=await pool.query(`INSERT INTO aria_actions(organization_id,person_id,type,status,priority,action_metadata,action_key,proposed_at)
 SELECT $1,x.person_id,x.action_type,'proposed',x.priority,jsonb_build_object('kind','care','template',x.template,'reason',x.reason,'requires_human_approval',true,'draft_required',true,'channel','whatsapp'),x.action_key,NOW()
 FROM jsonb_to_recordset($2::jsonb) AS x(person_id uuid,action_type text,priority text,template text,reason text,action_key text)
 ON CONFLICT(organization_id,action_key) DO NOTHING
 RETURNING id,person_id,type,priority,action_metadata`,[orgId,JSON.stringify(payload)]);
 return inserted.rows.map(action=>({actionId:action.id,personId:action.person_id,actionType:action.type,priority:action.priority,reason:action.action_metadata?.reason||null}));
}

export async function getCareOpportunities(orgId,limit=50){
 if(!orgId)throw new Error('orgId required');
 const n=Math.min(Math.max(Number(limit)||50,1),100);
 const r=await pool.query(`SELECT ps.*,p.first_name,p.last_name,p.display_name,p.phone,p.email,pi.next_best_action,pi.action_reason,pi.evidence FROM aria_person_state ps JOIN people p ON p.id=ps.person_id AND p.organization_id=ps.organization_id LEFT JOIN people_intelligence pi ON pi.person_id=ps.person_id AND pi.organization_id=ps.organization_id WHERE ps.organization_id=$1 AND ps.followup_state='recommended' AND p.status='active' ORDER BY CASE ps.attention_level WHEN'critical'then 4 WHEN'high'then 3 WHEN'medium'then 2 ELSE 1 END DESC,ps.updated_at DESC LIMIT $2`,[orgId,n]);
 return r.rows;
}
