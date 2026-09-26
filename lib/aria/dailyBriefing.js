import pool from'../db';
import{runCareCycle}from'./careCycle';
import{getPriorityQueue}from'./priorityQueue';
import{getDirectorBriefing}from'./directorEngine';

export async function getDailyBriefingSnapshot(orgId){
 if(!orgId)throw new Error('orgId required');
 const[briefing,latest]=await Promise.all([
  getDirectorBriefing(orgId,{limit:8}),
  pool.query("SELECT id,summary,metrics,recommendations,generated_at FROM daily_briefings WHERE organization_id=$1 ORDER BY generated_at DESC LIMIT 1",[orgId])
 ]);
 const focus=briefing.decisions?.human_focus||[];
 return{
  ...(latest.rows[0]||{}),
  id:latest.rows[0]?.id||null,
  summary:briefing.primary_focus?.title||'ARIA is keeping watch.',
  metrics:briefing.state||{},
  recommendations:focus.map(x=>({personId:x.person_id,name:x.name,type:x.classification,reason:x.reason})),
  director:briefing,
  readOnly:true,
  generated_at:briefing.generated_at
 };
}

export async function generateDailyBriefing(orgId){
 if(!orgId)throw new Error('orgId required');
 await runCareCycle(orgId);
 const snapshot=await getDailyBriefingSnapshot(orgId);
 const result=await pool.query("INSERT INTO daily_briefings(organization_id,summary,metrics,recommendations,generated_at,created_at)VALUES($1,$2,$3,$4,NOW(),NOW()) RETURNING id,generated_at",[orgId,snapshot.summary,snapshot.metrics,snapshot.recommendations]);
 return{...snapshot,id:result.rows[0].id,generated_at:result.rows[0].generated_at,readOnly:false};
}
