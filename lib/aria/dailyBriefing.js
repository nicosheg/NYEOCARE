import pool from'../db';
import{runCareCycle}from'./careCycle';
import{getPriorityQueue}from'./priorityQueue';

export async function getDailyBriefingSnapshot(orgId){
 if(!orgId)throw new Error('orgId required');
 const[metricsRes,priority,latest]=await Promise.all([
  pool.query("SELECT COUNT(*)::int AS total_people,COUNT(*) FILTER(WHERE participation_count>0)::int AS participants,COUNT(*) FILTER(WHERE participation_count=1)::int AS new_people,COUNT(*) FILTER(WHERE inactivity_streak=0)::int AS active_people,COUNT(*) FILTER(WHERE inactivity_streak>=4)::int AS inactive_people FROM engagement_metrics WHERE organization_id=$1",[orgId]),
  getPriorityQueue(orgId,5),
  pool.query("SELECT id,summary,metrics,recommendations,generated_at FROM daily_briefings WHERE organization_id=$1 ORDER BY generated_at DESC LIMIT 1",[orgId])
 ]);
 const metrics=metricsRes.rows[0]||{};
 const recommendations=priority.map(p=>({personId:p.person_id,name:[p.first_name,p.last_name].filter(Boolean).join(' '),type:p.signal_type,reason:p.reason}));
 const summary=recommendations.length?'ARIA has '+recommendations.length+' current signal'+(recommendations.length===1?'':'s')+' worth reviewing.':Number(metrics.total_people)?'ARIA is keeping relationship context current for your people.':'ARIA is ready. Your organization is just getting started.';
 return{...latest.rows[0],summary,metrics,recommendations,readOnly:true,generated_at:latest.rows[0]?.generated_at||new Date().toISOString()};
}

export async function generateDailyBriefing(orgId){
 if(!orgId)throw new Error('orgId required');
 await runCareCycle(orgId);
 const snapshot=await getDailyBriefingSnapshot(orgId);
 const result=await pool.query("INSERT INTO daily_briefings(organization_id,summary,metrics,recommendations,generated_at,created_at)VALUES($1,$2,$3,$4,NOW(),NOW()) RETURNING id,generated_at",[orgId,snapshot.summary,snapshot.metrics,snapshot.recommendations]);
 return{...snapshot,id:result.rows[0].id,generated_at:result.rows[0].generated_at,readOnly:false};
}
