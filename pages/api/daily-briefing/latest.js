// pages/api/daily-briefing/latest.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

const priority=v=>({critical:100,high:80,medium:55,low:25}[String(v||'').toLowerCase()]||10);
const personName=x=>[x.first_name,x.last_name].filter(Boolean).join(' ').replace(/^(sis|sister|bro|brother|mrs|mr|miss|ms|pastor|past|pst|dr|rev|elder|deacon|deaconess)\s+/i,'').trim();
function cleanType(v){return String(v||'').replace(/_/g,' ').replace(/\s+/g,' ').trim().toUpperCase()}

async function handler(req,res){
if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
const orgId=req.org.id;
try{
const org=await pool.query(`SELECT name,aria_instructions,settings FROM organizations WHERE id=$1 LIMIT 1`,[orgId]);
const people=await pool.query(`SELECT COUNT(*)::int count FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active'`,[orgId]);
const latestScan=await pool.query(`SELECT id,created_at,result FROM scan_jobs WHERE organization_id=$1 AND status='complete' AND result IS NOT NULL ORDER BY created_at DESC LIMIT 1`,[orgId]);
const observations=await pool.query(`SELECT o.id,o.person_id,o.type,o.confidence,o.severity,o.urgency,o.attention_score,o.evidence,o.metadata,o.detected_at,p.first_name,p.last_name FROM aria_observations o LEFT JOIN people p ON p.id=o.person_id AND p.organization_id=o.organization_id WHERE o.organization_id=$1 AND o.status='active' AND (o.expires_at IS NULL OR o.expires_at>NOW()) AND COALESCE(o.confidence,0)>=70 AND (COALESCE(o.attention_score,0)>=50 OR o.urgency IN('high','critical')) ORDER BY COALESCE(o.attention_score,0) DESC,o.detected_at DESC LIMIT 20`,[orgId]);
const actions=await pool.query(`SELECT a.id,a.person_id,a.type,a.status,a.priority,a.action_metadata,a.proposed_at,p.first_name,p.last_name FROM aria_actions a LEFT JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.status IN('proposed','approved') ORDER BY CASE a.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,a.proposed_at ASC LIMIT 20`,[orgId]);
const relationships=await pool.query(`SELECT r.person_id,r.score,r.relationship_state,r.evidence,p.first_name,p.last_name FROM relationship_scores r JOIN people p ON p.id=r.person_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND COALESCE(p.status,'active')='active' AND COALESCE(r.score,100)<45 ORDER BY r.score ASC,r.updated_at DESC LIMIT 10`,[orgId]);
const items=[];
const scan=latestScan.rows[0],scanResult=scan?.result||{},reviewCount=Array.isArray(scanResult.needs_review)?scanResult.needs_review.filter(x=>!x?.resolved).length:0;
if(reviewCount)items.push({id:`scan:${scan.id}`,category:'scan',priority:110,label:'SCAN REVIEW',title:`${reviewCount} register row${reviewCount===1?'':'s'} need confirmation`,message:`ARIA found information it could not safely verify. Confirm the name and phone against the original register before saving them.`,action:{type:'review',label:'Fix scan'}});
for(const x of observations.rows){const name=personName(x);if(!name)continue;const message=String(x.evidence?.summary||x.metadata?.summary||'').trim();if(!message)continue;items.push({id:x.id,person_id:x.person_id,category:'care',priority:Math.max(priority(x.urgency),Number(x.attention_score)||0),label:cleanType(x.type)||'FOLLOW-UP',title:name,message,action:{type:'people',label:'Open person',href:'/people'}})}
for(const x of actions.rows){const name=personName(x),message=String(x.action_metadata?.summary||x.action_metadata?.message||'').trim();if(!message)continue;items.push({id:x.id,person_id:x.person_id,category:'care',priority:priority(x.priority),label:cleanType(x.type)||'ACTION',title:name||'Action needed',message,action:{type:'people',label:'Open people',href:'/people'}})}
for(const x of relationships.rows){const name=personName(x);if(!name)continue;const score=Math.max(0,Math.min(100,Number(x.score)||0));items.push({id:`relationship:${x.person_id}`,person_id:x.person_id,category:'relationship',priority:70+(45-score),label:'RELATIONSHIP',title:name,message:`Relationship signal is low at ${Math.round(score)}%. Open this person’s record and decide whether a personal follow-up is needed.`,action:{type:'people',label:'Open person',href:'/people'}})}
const seen=new Set(),top=[];
for(const item of items.sort((a,b)=>b.priority-a.priority)){const key=item.person_id?`${item.category}:${item.person_id}`:item.id;if(seen.has(key))continue;seen.add(key);top.push(item);if(top.length>=5)break}
const settings=org.rows[0]?.settings||{},vocabulary=settings?.aria?.vocabulary||{person:'people',members:'members',leaders:'leaders',care:'care',prayer:'prayer'},now=new Date(),date=now.toISOString().slice(0,10),count=top.length;
return res.status(200).json({date,generatedAt:now.toISOString(),organization:{id:orgId,name:org.rows[0]?.name||'your organization',instructions:org.rows[0]?.aria_instructions||'',vocabulary},notification:{hasSomething:count>0,text:count?'ARIA has concrete things for you today.':'ARIA is keeping watch today.',count},briefing:{headline:count?`Here are ${count} things with a clear next step.`:'Nothing needs your immediate attention today.',items:top},categories:{scan:top.filter(x=>x.category==='scan').slice(0,1),care:top.filter(x=>x.category==='care').slice(0,3),relationship:top.filter(x=>x.category==='relationship').slice(0,2)},peopleCount:people.rows[0]?.count||0,nextRefresh:`${date}T23:59:59.999`});
}catch(err){console.error('[ARIA] Daily briefing error:',err);return res.status(500).json({error:'Unable to build ARIA Today.'})}
}
export default withOrg(handler);
