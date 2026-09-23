
import pool from'../db';
import{getPriorityQueue}from'./priorityQueue';
import{evidence}from'./epistemic';

const stepFor=signal=>{
 if(signal==='extended_absence')return'ASK';
 if(['emerging_attendance_decline','new_relationship','belonging_opportunity','contribution_opportunity','recognition_opportunity'].includes(signal))return'RECOMMEND';
 if(['active_signal','pending_action'].includes(signal))return'REVIEW';
 return'WATCH';
};

export async function getAttentionSummary(organizationId,{limit=8}={}){
 if(!organizationId)throw new Error('organizationId required');
 const n=Math.min(Math.max(Number(limit)||8,1),20);
 const[queue,obsCount,actionCount]=await Promise.all([
  getPriorityQueue(organizationId,Math.min(n*2,40)),
  pool.query("SELECT COUNT(*)::int count,COUNT(*) FILTER(WHERE severity IN('high','critical'))::int high_count FROM aria_observations WHERE organization_id=$1 AND status='active' AND(expires_at IS NULL OR expires_at>NOW())",[organizationId]),
  pool.query("SELECT COUNT(*)::int count FROM aria_actions WHERE organization_id=$1 AND status IN('proposed','approved') AND(expires_at IS NULL OR expires_at>NOW())",[organizationId])
 ]);
 return{
  items:queue.slice(0,n).map(x=>({
   person_id:x.person_id,
   person_name:[x.first_name,x.last_name].filter(Boolean).join(' ').trim()||'Someone',
   signal_type:x.signal_type,
   decision_step:stepFor(x.signal_type),
   reason:x.reason,
   relationship_state:x.relationship_state||'unknown',
   evidence:evidence({kind:'inference',status:'inferred',source:'attention_engine',statement:x.reason||'ARIA identified a meaningful signal.',occurredAt:x.last_attendance||null,confidence:.7,metadata:{signal_type:x.signal_type}})
  })),
  counts:{active_observations:Number(obsCount.rows[0]?.count)||0,high_observations:Number(obsCount.rows[0]?.high_count)||0,open_actions:Number(actionCount.rows[0]?.count)||0},
  policy:{ladder:['DO_NOTHING','WATCH','ASK','RECOMMEND','PREPARE','REQUEST_APPROVAL','ACT','ESCALATE'],external_actions:'human_approval_required'},
  generated_at:new Date().toISOString()
 };
}
