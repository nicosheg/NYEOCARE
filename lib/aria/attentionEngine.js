
import pool from'../db';
import{getPriorityQueue}from'./priorityQueue';
import{evidence}from'./epistemic';
import{getDirectorBriefing}from'./directorEngine';

const stepFor=signal=>{
 if(signal==='extended_absence')return'ASK';
 if(['emerging_attendance_decline','new_relationship','belonging_opportunity','contribution_opportunity','recognition_opportunity'].includes(signal))return'RECOMMEND';
 if(['active_signal','pending_action'].includes(signal))return'REVIEW';
 return'WATCH';
};

export async function getAttentionSummary(organizationId,{limit=8}={}){
 if(!organizationId)throw new Error('organizationId required');
 const n=Math.min(Math.max(Number(limit)||8,1),20);
 const briefing=await getDirectorBriefing(organizationId,{limit:n});
 const items=[...(briefing.decisions?.human_focus||[]),...(briefing.decisions?.opportunities||[])].slice(0,n).map(x=>({
  person_id:x.person_id,
  person_name:x.name||'Someone',
  signal_type:x.classification||x.type||'signal',
  decision_step:x.action?'RECOMMEND':'WATCH',
  reason:x.reason||'ARIA identified a meaningful signal.',
  relationship_state:'unknown',
  observation_id:x.observation_id||null,
  observation_type:x.observation||null,
  observation_evidence:null,
  observation_detected_at:null,
  action_id:x.action_id||null,
  action_type:x.action||null,
  action_status:null,
  action_metadata:null,
  evidence:evidence({
   kind:'inference',
   status:'inferred',
   source:'aria_director',
   statement:x.reason||'ARIA identified a meaningful signal.',
   confidence:.85
  })
 }));
 const inventory=briefing.intelligence?.observation_inventory||{};
 const activeObservations=Object.values(inventory).reduce((sum,v)=>sum+Number(v||0),0);
 return{
  items,
  counts:{active_observations:activeObservations,high_observations:0,open_actions:Object.values(briefing.intelligence?.action_inventory||{}).reduce((sum,v)=>sum+Number(v||0),0)},
  policy:{ladder:['DO_NOTHING','WATCH','ASK','RECOMMEND','PREPARE','REQUEST_APPROVAL','ACT','ESCALATE'],external_actions:'human_approval_required'},
  generated_at:briefing.generated_at,
  director:briefing
 };
}
