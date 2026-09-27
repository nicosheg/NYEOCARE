// pages/api/home/bootstrap.js
import pool from '../../../lib/db';
import {withOrg} from '../../../lib/apiHelpers';
import {getDirectorBriefing} from '../../../lib/aria/directorEngine';
import {ARIA_DIRECTOR_VERSION} from '../../../lib/aria/director';
import {getDailyQueue} from '../../../lib/dailyQueue';

const priority=v=>({critical:100,high:80,medium:55,low:25}[String(v||'').toLowerCase()]||10);
const proactiveLabels={recognition:'RECOGNITION',belonging:'BELONGING',serve_discovery:'CONTRIBUTION'};
const proactiveActions={recognition:'Review recognition',belonging:'Review belonging opportunity',serve_discovery:'Review contribution opportunity'};
const personName=x=>[x.first_name,x.last_name].filter(Boolean).join(' ').replace(/^(sis|sister|bro|brother|mrs|mr|miss|ms|pastor|past|pst|dr|rev|elder|deacon|deaconess)\s+/i,'').trim();
const cleanType=v=>String(v||'').replace(/_/g,' ').replace(/\s+/g,' ').trim().toUpperCase();

export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 res.setHeader('Cache-Control','private,no-store,max-age=0,must-revalidate');
 res.setHeader('Pragma','no-cache');
 const orgId=req.org.id;

 try{
  const[base,directorData,dailyQueue]=await Promise.all([
    pool.query(`SELECT
     name,aria_instructions,settings,
     (SELECT COUNT(*)::int FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active') people_count,
     (SELECT COUNT(*)::int FROM scan_review_items WHERE organization_id=$1 AND status='pending') review_count,
     (SELECT row_to_json(s) FROM(
       SELECT id,name,status,started_by,started_at,closed_at,aria_processing_status,
         aria_processing_attempts,aria_processing_started_at,aria_processing_completed_at,aria_processing_error,
         aria_processing_stage,aria_processing_progress,aria_processing_processed,aria_processing_total
       FROM sessions
       WHERE organization_id=$1 AND status='active'
       ORDER BY started_at DESC
       LIMIT 1
     )s) latest_session,
     (SELECT row_to_json(b) FROM(
       SELECT id,name,status,closed_at,aria_processing_status,aria_processing_attempts,
         aria_processing_started_at,aria_processing_completed_at,aria_processing_error,
         aria_processing_stage,aria_processing_progress,aria_processing_processed,aria_processing_total
       FROM sessions
       WHERE organization_id=$1 AND status='closed'
         AND aria_processing_status IN('pending','processing','needs_attention')
       ORDER BY closed_at DESC
       LIMIT 1
     )b) latest_background_session,
     (SELECT row_to_json(c) FROM(
       SELECT id,name,status,closed_at,aria_processing_status
       FROM sessions
       WHERE organization_id=$1 AND status='closed' AND aria_processing_status='completed'
       ORDER BY closed_at DESC LIMIT 1
     )c) latest_completed_session
   FROM organizations WHERE id=$1 LIMIT 1`,[orgId]),
   getDirectorBriefing(orgId,{limit:8}).catch(error=>{
     console.error('[ARIA] Director briefing degraded on Home bootstrap:',error);
     return null;
   }),
   getDailyQueue(orgId,req.user.id).catch(error=>{
     console.error('[ARIA] Daily queue degraded on Home bootstrap:',error);
     return{today:null,items:[],later_count:0,open_count:0,operators:[],timeZone:'Africa/Lagos'};
   })
  ]);

  const queueItems=(dailyQueue.items||[]).map(row=>({
    ...(row.payload||{}),
    id:(row.payload&&row.payload.id)||String(row.source_id||row.id),
    source_id:String(row.source_id||''),
    queue_item_id:String(row.id||''),
    task_kind:String(row.task_kind||row.payload?.task_kind||'action'),
    queue_date:row.queue_date,
    defer_count:Number(row.defer_count)||0,
    assigned_user_id:row.assigned_user_id||null
  })).filter(item=>item.title||item.message);
  const top=queueItems.slice(0,5);

  const org=base.rows[0]||{},settings=org.settings||{},
    vocabulary=settings?.aria?.vocabulary||{person:'people',members:'members',leaders:'leaders',care:'care',prayer:'prayer'},
    now=new Date(),date=now.toISOString().slice(0,10),count=top.length,s=org.latest_session||null,c=org.latest_completed_session||null;

  const director={...directorData,legacy_version:ARIA_DIRECTOR_VERSION,pending_scan_reviews:Number(org.review_count)||0,latest_session:s?{id:s.id,name:s.name,status:s.status,aria_processing_status:s.aria_processing_status,aria_processing_error:s.aria_processing_error}:null,latest_completed_session:c?{id:c.id,name:c.name,closed_at:c.closed_at}:null};

  return res.status(200).json({
    date,generatedAt:now.toISOString(),director,
    organization:{id:orgId,name:org.name||'your organization',instructions:org.aria_instructions||'',vocabulary},
    attendance:s?{
      active:true,recoverable:false,
      session_id:s.id,name:s.name,status:s.status,started_by:s.started_by,started_at:s.started_at,closed_at:null,
      processing_status:s.aria_processing_status,processing_attempts:Number(s.aria_processing_attempts)||0,
      processing_started_at:s.aria_processing_started_at,processing_completed_at:s.aria_processing_completed_at,
      processing_error:s.aria_processing_error,processing_stage:s.aria_processing_stage||'idle',
      processing_progress:Number(s.aria_processing_progress)||0,
      processing_processed:Number(s.aria_processing_processed)||0,
      processing_total:Number(s.aria_processing_total)||0
    }:{active:false,recoverable:false},
    aria_processing:org.latest_background_session?{
      session_id:org.latest_background_session.id,
      name:org.latest_background_session.name,
      status:org.latest_background_session.status,
      processing_status:org.latest_background_session.aria_processing_status,
      processing_stage:org.latest_background_session.aria_processing_stage,
      progress:Number(org.latest_background_session.aria_processing_progress)||0,
      processed:Number(org.latest_background_session.aria_processing_processed)||0,
      total:Number(org.latest_background_session.aria_processing_total)||0,
      started_at:org.latest_background_session.aria_processing_started_at,
      completed_at:org.latest_background_session.aria_processing_completed_at
    }:null,
    notification:{hasSomething:directorData?.primary_focus?.priority!=='low'||count>0,text:directorData?.primary_focus?.title||'ARIA is keeping watch today.',count},
    director_status:directorData?'live':'degraded',
    briefing:{headline:[directorData?.primary_focus?.title,directorData?.primary_focus?.summary].filter(Boolean).join(' — ')||'ARIA is keeping watch today.',items:top,director:directorData},
    categories:{
      scan:top.filter(x=>x.task_kind==='scan_review'),
      follow_up:top.filter(x=>x.task_kind==='follow_up'),
      care:top.filter(x=>x.task_kind==='action')
    },
    peopleCount:Number(org.people_count)||0,reviewCount:Number(org.review_count)||0,
    queue:{todayCount:count,laterCount:Number(dailyQueue.later_count)||0,items:top},
    nextRefresh:date+'T23:59:59.999'
  });
 }catch(err){
  console.error('[ARIA] Home bootstrap error:',err);
  return res.status(500).json({error:'Unable to load NYEOCARE.'});
 }
});
