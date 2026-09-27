// pages/api/daily-briefing/latest.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { getDirectorState } from '../../../lib/aria/director';
import { getDailyQueue } from '../../../lib/dailyQueue';

export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 res.setHeader('Cache-Control','private, no-store, max-age=0, must-revalidate');
 res.setHeader('Pragma','no-cache');
 const orgId=req.org.id,userId=req.user.id;
 try{
  const [org,people,director,queue]=await Promise.all([
   pool.query(`SELECT name,aria_instructions,settings FROM organizations WHERE id=$1 LIMIT 1`,[orgId]),
   pool.query(`SELECT COUNT(*)::int count FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active'`,[orgId]),
   getDirectorState(orgId),
   getDailyQueue(orgId,userId)
  ]);
  const items=queue.items.map(row=>{
   const p=row.payload&&typeof row.payload==='object'?row.payload:{};
   return{...p,queue_item_id:row.id,queue_date:String(row.queue_date),assigned_user_id:row.assigned_user_id,task_kind:row.task_kind,priority:row.priority,defer_count:row.defer_count||0};
  });
  const groupedCounts={scan:0,follow_up:0,care:0};
  for(const item of items){if(item.category==='scan')groupedCounts.scan++;else if(item.task_kind==='follow_up'||item.label==='FOLLOW-UP')groupedCounts.follow_up++;else groupedCounts.care++}
  const todayCount=items.length,laterCount=Number(queue.later_count)||0,openCount=Number(queue.openCount)||0;
  const settings=org.rows[0]?.settings||{},vocabulary=settings?.aria?.vocabulary||{person:'people',members:'members',leaders:'leaders',care:'care',prayer:'prayer'};
  const headline=todayCount
   ? `Your ARIA queue has ${todayCount} thing${todayCount===1?'':'s'} lined up for today.`
   : laterCount
     ? `Nothing needs your attention today. ARIA has already scheduled the next work.`
     : `Nothing needs your attention today.`;
  return res.status(200).json({
   date:queue.today,
   generatedAt:new Date().toISOString(),
   director,
   organization:{id:orgId,name:org.rows[0]?.name||'your organization',instructions:org.rows[0]?.aria_instructions||'',vocabulary},
   notification:{hasSomething:todayCount>0,text:headline,count:todayCount,laterCount,openCount},
   briefing:{headline,items,todayCount,laterCount,openCount,operatorCount:queue.operators.length,assignedTo:{id:userId,name:req.user?.name||null,role:req.user?.role||null},capacityPerOperator:5},
   queue:{today:queue.today,todayCount,laterCount,openCount,operatorCount:queue.operators.length,capacityPerOperator:5,categories:groupedCounts},
   categories:{
    scan:items.filter(x=>x.category==='scan'),
    follow_up:items.filter(x=>x.task_kind==='follow_up'||x.label==='FOLLOW-UP'),
    care:items.filter(x=>x.category!=='scan'&&x.task_kind!=='follow_up'&&x.label!=='FOLLOW-UP')
   },
   peopleCount:people.rows[0]?.count||0,
   nextRefresh:`${queue.today}T23:59:59.999`
  });
 }catch(err){
  console.error('[ARIA] Daily briefing error:',err);
  return res.status(500).json({error:'Unable to build ARIA Today.'});
 }
});