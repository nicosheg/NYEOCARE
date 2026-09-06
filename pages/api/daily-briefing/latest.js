// pages/api/daily-briefing/latest.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

const priority=v=>({critical:100,high:80,medium:55,low:25}[v]||10);

async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const orgId=req.org.id;
 try{
  const org=await pool.query(`SELECT name,aria_instructions,settings FROM organizations WHERE id=$1 LIMIT 1`,[orgId]);
  const people=await pool.query(`SELECT COUNT(*)::int count FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active'`,[orgId]);
  const observations=await pool.query(`SELECT o.id,o.person_id,o.type,o.confidence,o.severity,o.urgency,o.attention_score,o.evidence,o.metadata,o.detected_at,p.first_name,p.last_name FROM aria_observations o LEFT JOIN people p ON p.id=o.person_id AND p.organization_id=o.organization_id WHERE o.organization_id=$1 AND o.status='active' AND (o.expires_at IS NULL OR o.expires_at>NOW()) ORDER BY COALESCE(o.attention_score,0) DESC,o.detected_at DESC LIMIT 50`,[orgId]);
  const actions=await pool.query(`SELECT a.id,a.person_id,a.type,a.status,a.priority,a.action_metadata,a.proposed_at,p.first_name,p.last_name FROM aria_actions a LEFT JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.status IN('proposed','approved') ORDER BY CASE a.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,a.proposed_at ASC LIMIT 30`,[orgId]);
  const relationships=await pool.query(`SELECT r.person_id,r.score,r.relationship_state,r.evidence,p.first_name,p.last_name FROM relationship_scores r JOIN people p ON p.id=r.person_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND COALESCE(p.status,'active')='active' ORDER BY r.score ASC,r.updated_at DESC LIMIT 20`,[orgId]);
  const birthdays=await pool.query(`SELECT id,first_name,last_name,birthday FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active' AND birthday IS NOT NULL ORDER BY EXTRACT(DOY FROM birthday-((CURRENT_DATE-birthday)%365)) LIMIT 20`,[orgId]);
  const obs=observations.rows.map(x=>({...x,category:/CARE|FOLLOW|MESSAGE|ABSEN|CONTACT/i.test(`${x.type} ${JSON.stringify(x.metadata||{})}`)?'care':/RELATION|RELATIONSHIP/i.test(`${x.type} ${JSON.stringify(x.metadata||{})}`)?'relationship':'people',priority:Math.max(priority(x.urgency),Number(x.attention_score)||0)}));
  const acts=actions.rows.map(x=>({...x,category:/MESSAGE|CARE|FOLLOW/i.test(x.type)?'care':'people',priority:priority(x.priority)}));
  const rel=relationships.rows.map(x=>({...x,category:'relationship',priority:Math.max(0,100-(Number(x.score)||0))}));
  const all=[...obs,...acts,...rel].sort((a,b)=>b.priority-a.priority);
  const seen=new Set(),queue=[];
  for(const item of all){
   const key=item.person_id?`${item.category}:${item.person_id}`:`${item.category}:${item.id}`;
   if(seen.has(key))continue;
   seen.add(key);
   queue.push(item);
   if(queue.length>=9)break;
  }
  const top=queue.slice(0,6);
  const daily={
   people:top.filter(x=>x.category==='people').slice(0,3),
   care:top.filter(x=>x.category==='care').slice(0,3),
   relationship:top.filter(x=>x.category==='relationship').slice(0,3)
  };
  const instructions=org.rows[0]?.aria_instructions||'';
  const settings=org.rows[0]?.settings||{};
  const vocabulary=settings?.aria?.vocabulary||{person:'people',members:'members',leaders:'leaders',care:'care',prayer:'prayer'};
  const date=new Date().toISOString().slice(0,10);
  const count=Object.values(daily).reduce((n,a)=>n+a.length,0);
  return res.status(200).json({
   date,
   organization:{id:orgId,name:org.rows[0]?.name||'your organization',instructions,vocabulary},
   notification:{hasSomething:count>0,text:count?`ARIA has something for you today.`:`ARIA is keeping watch today.`,count},
   briefing:{headline:count?`Here are the ${Math.min(count,6)} things I think matter most today.`:`Nothing needs your immediate attention today.`,items:top},
   categories:daily,
   peopleCount:people.rows[0].count,
   nextRefresh:`${date}T23:59:59.999`,
   birthdays:birthdays.rows.slice(0,5)
  });
 }catch(err){
  console.error('[ARIA] Daily briefing error:',err);
  return res.status(500).json({error:'Unable to build ARIA Today.'});
 }
}
export default withOrg(handler);
