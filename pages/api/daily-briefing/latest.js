// pages/api/daily-briefing/latest.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

const priority=v=>({critical:100,high:80,medium:55,low:25}[v]||10);
const personName=x=>[x.first_name,x.last_name].filter(Boolean).join(' ').replace(/^(sis|bro|mrs|mr|miss|pastor|past)\s+/i,'').trim();

function buildRelationshipMessage(x){
const e=x.evidence||{},name=personName(x)||'This person',rate=Number(e.participation_rate),streak=Number(e.participation_streak);
if(streak>=3)return{title:name,label:`${streak} sessions attended`,message:'Keep the relationship warm. Open their record and add a meaningful note or check-in.',action:{type:'people',label:'Open person',href:'/people'}};
if(Number.isFinite(rate)&&rate<60&&rate>=0)return{title:name,label:`${Math.round(rate)}% participation`,message:'Their recent participation is falling. Open their record and check whether they need a personal follow-up.',action:{type:'people',label:'Open person',href:'/people'}};
return null;
}

async function handler(req,res){
if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
const orgId=req.org.id;
try{
const org=await pool.query(`SELECT name,aria_instructions,settings FROM organizations WHERE id=$1 LIMIT 1`,[orgId]);
const people=await pool.query(`SELECT COUNT(*)::int count FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active'`,[orgId]);
const latestScan=await pool.query(`SELECT id,created_at,result FROM scan_jobs WHERE organization_id=$1 AND status='complete' AND result IS NOT NULL ORDER BY created_at DESC LIMIT 1`,[orgId]);
const observations=await pool.query(`SELECT o.id,o.person_id,o.type,o.confidence,o.severity,o.urgency,o.attention_score,o.evidence,o.metadata,o.detected_at,p.first_name,p.last_name FROM aria_observations o LEFT JOIN people p ON p.id=o.person_id AND p.organization_id=o.organization_id WHERE o.organization_id=$1 AND o.status='active' AND (o.expires_at IS NULL OR o.expires_at>NOW()) AND COALESCE(o.confidence,0)>=70 ORDER BY COALESCE(o.attention_score,0) DESC,o.detected_at DESC LIMIT 30`,[orgId]);
const actions=await pool.query(`SELECT a.id,a.person_id,a.type,a.status,a.priority,a.action_metadata,a.proposed_at,p.first_name,p.last_name FROM aria_actions a LEFT JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.status IN('proposed','approved') ORDER BY CASE a.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,a.proposed_at ASC LIMIT 20`,[orgId]);
const relationships=await pool.query(`SELECT r.person_id,r.score,r.relationship_state,r.evidence,p.first_name,p.last_name FROM relationship_scores r JOIN people p ON p.id=r.person_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND COALESCE(p.status,'active')='active' ORDER BY r.score ASC,r.updated_at DESC LIMIT 20`,[orgId]);

const items=[];
const scanResult=latestScan.rows[0]?.result||{};
const reviewCount=Array.isArray(scanResult.needs_review)?scanResult.needs_review.filter(x=>!x?.resolved).length:0;
if(reviewCount){
items.push({
id:`scan:${latestScan.rows[0].id}`,
category:'scan',
priority:110,
label:'SCAN NEEDS REVIEW',
title:`${reviewCount} register row${reviewCount===1?'':'s'} need${reviewCount===1?'s':''} confirmation`,
message:`ARIA refused to guess ${reviewCount} uncertain row${reviewCount===1?'':'s'}. Check the original register and confirm or correct them before they become part of your community.`,
action:{type:'review',label:'Fix scan'}
});
}

for(const x of observations.rows){
const name=personName(x);
if(!name)continue;
const message=x.evidence?.summary||x.metadata?.summary;
if(!message)continue;
items.push({id:x.id,category:/CARE|FOLLOW|MESSAGE|ABSEN|CONTACT/i.test(`${x.type} ${JSON.stringify(x.metadata||{})}`)?'care':'people',priority:Math.max(priority(x.urgency),Number(x.attention_score)||0),label:x.type?String(x.type).replace(/_/g,' ').toUpperCase():'ATTENTION',title:name,message,action:{type:'people',label:'Open person',href:'/people'}});
}

for(const x of actions.rows){
const name=personName(x);
const message=x.action_metadata?.summary||x.action_metadata?.message;
if(!message)continue;
items.push({id:x.id,category:/MESSAGE|CARE|FOLLOW/i.test(x.type)?'care':'people',priority:priority(x.priority),label:String(x.type||'ACTION').replace(/_/g,' ').toUpperCase(),title:name||'Action needed',message,action:{type:'people',label:'Open people',href:'/people'}});
}

for(const x of relationships.rows){
const item=buildRelationshipMessage(x);
if(item)items.push({id:`relationship:${x.person_id}`,category:'relationship',priority:Math.max(0,100-(Number(x.score)||0)),...item});
}

const seen=new Set(),top=[];
for(const item of items.sort((a,b)=>b.priority-a.priority)){
const key=item.person_id||item.id;
if(seen.has(key))continue;
seen.add(key);
top.push(item);
if(top.length>=6)break;
}

const daily={people:top.filter(x=>x.category==='people').slice(0,3),care:top.filter(x=>x.category==='care').slice(0,3),relationship:top.filter(x=>x.category==='relationship').slice(0,3),scan:top.filter(x=>x.category==='scan').slice(0,1)};
const instructions=org.rows[0]?.aria_instructions||'';
const settings=org.rows[0]?.settings||{};
const vocabulary=settings?.aria?.vocabulary||{person:'people',members:'members',leaders:'leaders',care:'care',prayer:'prayer'};
const date=new Date().toISOString().slice(0,10);
const count=top.length;

return res.status(200).json({
date,
organization:{id:orgId,name:org.rows[0]?.name||'your organization',instructions,vocabulary},
notification:{hasSomething:count>0,text:count?'ARIA has a few concrete things for you today.':'ARIA is keeping watch today.',count},
briefing:{headline:count?`Here are the ${count} things that have a clear next step today.`:'Nothing needs your immediate attention today.',items:top},
categories:daily,
peopleCount:people.rows[0].count,
nextRefresh:`${date}T23:59:59.999`
});
}catch(err){
console.error('[ARIA] Daily briefing error:',err);
return res.status(500).json({error:'Unable to build ARIA Today.'});
}
}
export default withOrg(handler);
