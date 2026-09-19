// pages/api/home/bootstrap.js
import pool from'../../../lib/db';import{withOrg}from'../../../lib/apiHelpers';import{ARIA_DIRECTOR_VERSION}from'../../../lib/aria/director';

const priority=v=>({critical:100,high:80,medium:55,low:25}[String(v||'').toLowerCase()]||10);
const personName=x=>[x.first_name,x.last_name].filter(Boolean).join(' ').replace(/^(sis|sister|bro|brother|mrs|mr|miss|ms|pastor|past|pst|dr|rev|elder|deacon|deaconess)\s+/i,'').trim();
const cleanType=v=>String(v||'').replace(/_/g,' ').replace(/\s+/g,' ').trim().toUpperCase();

export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 res.setHeader('Cache-Control','private,no-store,max-age=0,must-revalidate');res.setHeader('Pragma','no-cache');
 const orgId=req.org.id;
 try{
  const[base,observations,actions]=await Promise.all([
   pool.query("SELECT name,aria_instructions,settings,(SELECT COUNT(*)::int FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active') people_count,(SELECT COUNT(*)::int FROM scan_review_items WHERE organization_id=$1 AND status='pending') review_count,(SELECT row_to_json(s) FROM(SELECT id,name,status,started_by,started_at,closed_at,aria_processing_status,aria_processing_attempts,aria_processing_started_at,aria_processing_completed_at,aria_processing_error FROM sessions WHERE organization_id=$1 AND(status='active' OR(status='closed' AND aria_processing_status IN('pending','processing','failed'))) ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,started_at DESC LIMIT 1)s) latest_session FROM organizations WHERE id=$1 LIMIT 1",[orgId]),
   pool.query("SELECT o.id,o.person_id,o.type,o.confidence,o.severity,o.urgency,o.attention_score,o.evidence,o.metadata,o.detected_at,p.first_name,p.last_name FROM aria_observations o LEFT JOIN people p ON p.id=o.person_id AND p.organization_id=o.organization_id WHERE o.organization_id=$1 AND o.status='active' AND(o.expires_at IS NULL OR o.expires_at>NOW()) ORDER BY CASE WHEN o.type='UNUSUAL_ABSENCE' THEN 2 ELSE 1 END DESC,COALESCE(o.attention_score,0) DESC,o.detected_at DESC LIMIT 30",[orgId]),
   pool.query("SELECT a.id,a.person_id,a.observation_id,a.type,a.status,a.priority,a.action_metadata,a.proposed_at,p.first_name,p.last_name,p.phone,o.type observation_type,o.evidence,o.confidence FROM aria_actions a LEFT JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id LEFT JOIN aria_observations o ON o.id=a.observation_id AND o.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.status IN('proposed','approved') AND(a.expires_at IS NULL OR a.expires_at>NOW()) ORDER BY CASE WHEN a.action_metadata->>'kind'='first_session_check_in' THEN 5 WHEN a.action_metadata->>'kind'='returned_after_absence' THEN 4 ELSE 0 END DESC,CASE a.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,a.proposed_at ASC LIMIT 30",[orgId])
  ]);
  const items=[];
  for(const x of actions.rows){
   const name=personName(x),m=x.action_metadata||{},firstSession=m.first_session===true||m.kind==='first_session_check_in',observation=x.observation_type||'';
   if(!name&&x.person_id)continue;
   let message=String(m.summary||m.message||'').trim(),knowledge=String(m.knowledge||'').trim(),suggestion=String(m.suggestion||'').trim();
   if(firstSession||observation==='UNUSUAL_ABSENCE'){
    message=String(m.summary||((name||'This person')+" wasn’t recorded at the latest gathering."));
    knowledge=String(m.knowledge||'This is an immediate absence signal. ARIA does not yet know whether anything is wrong.');
    suggestion=String(m.suggestion||'A simple check-in is the next useful step.');
   }else if(!message&&observation){
    message=observation==='LOW_ENGAGEMENT'?(name+" may need a personal check-in."):"ARIA found something worth your attention with "+name+".";
    suggestion='Review this signal and decide what to do.';
   }
   if(!message)continue;
   items.push({id:x.id,person_id:x.person_id,category:'care',priority:firstSession?75:priority(x.priority),label:firstSession?'FOLLOW-UP':cleanType(x.type)||'ACTION',title:name||'Action needed',message,knowledge,suggestion,action:{type:'care',label:firstSession?'Review check-in':'Review action'},action_id:x.id,action_type:x.type,action_status:x.status,metadata:m,observation_id:x.observation_id,confidence:x.confidence,care_session_id:m.session_id||null});
  }
  for(const x of observations.rows){
   const name=personName(x);if(!name)continue;
   const first=String(x.type||'')==='UNUSUAL_ABSENCE',message=first?(name+" wasn’t recorded at the latest gathering."):String(x.evidence?.summary||x.metadata?.summary||'').trim();
   if(!message)continue;
   items.push({id:x.id,person_id:x.person_id,category:'care',priority:first?70:Math.max(priority(x.urgency),Number(x.attention_score)||0),label:first?'FOLLOW-UP':cleanType(x.type)||'ARIA',title:name,message,knowledge:first?'This is an immediate absence signal. ARIA does not yet know whether anything is wrong.':'ARIA found a signal worth your attention.',suggestion:first?'A simple check-in is the next useful step.':'Review the signal and decide what to do.',action:{type:'care',label:first?'Review check-in':'Review signal'},observation_id:x.id,confidence:x.confidence});
  }
  const seen=new Set(),top=[];
  for(const item of items.sort((a,b)=>b.priority-a.priority)){
   const key=item.person_id?(item.category+':'+item.person_id):item.id;
   if(seen.has(key))continue;seen.add(key);top.push(item);if(top.length>=5)break;
  }
  const org=base.rows[0]||{},settings=org.settings||{},vocabulary=settings?.aria?.vocabulary||{person:'people',members:'members',leaders:'leaders',care:'care',prayer:'prayer'},now=new Date(),date=now.toISOString().slice(0,10),count=top.length,s=org.latest_session||null;
  const director={director:'ARIA',version:ARIA_DIRECTOR_VERSION,people:Number(org.people_count)||0,pending_scan_reviews:Number(org.review_count)||0,latest_session:s?{id:s.id,name:s.name,status:s.status,aria_processing_status:s.aria_processing_status,aria_processing_error:s.aria_processing_error}:null,active_observations:observations.rows.length,open_actions:actions.rows.length};
  return res.status(200).json({date,generatedAt:now.toISOString(),director,organization:{id:orgId,name:org.name||'your organization',instructions:org.aria_instructions||'',vocabulary},attendance:s?{active:s.status==='active',recoverable:s.status==='closed',session_id:s.id,name:s.name,status:s.status,started_by:s.started_by,started_at:s.started_at,closed_at:s.closed_at,processing_status:s.aria_processing_status,processing_attempts:Number(s.aria_processing_attempts)||0,processing_started_at:s.aria_processing_started_at,processing_completed_at:s.aria_processing_completed_at,processing_error:s.aria_processing_error}:{active:false,recoverable:false},notification:{hasSomething:count>0,text:count?'ARIA has concrete things for you today.':'ARIA is keeping watch today.',count},briefing:{headline:count?'Here are '+count+' things with a clear next step.':'Nothing needs your immediate attention today.',items:top},categories:{scan:[],care:top.filter(x=>x.category==='care').slice(0,3)},peopleCount:Number(people.rows[0]?.count)||0,reviewCount:Number(review.rows[0]?.count)||0,nextRefresh:date+'T23:59:59.999'});
 }catch(err){console.error('[ARIA] Home bootstrap error:',err);return res.status(500).json({error:'Unable to load NYEOCARE.'})}
});
