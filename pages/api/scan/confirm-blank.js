// pages/api/scan/confirm-blank.js
import{withOrg}from'../../../lib/apiHelpers';
import pool from'../../../lib/db';
import{processVisionJob,SCAN_PIPELINE_VERSION}from'../../../lib/visionProcessor';
import{waitUntil}from'@vercel/functions';

export const config={api:{bodyParser:{sizeLimit:'1mb'}},maxDuration:300};

async function handler(req,res){
 res.setHeader('Cache-Control','no-store,no-cache,must-revalidate,private');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const{job_id,confirm_blank}=req.body||{};
 if(typeof job_id!=='string'||!job_id.trim())return res.status(400).json({error:'Missing job_id',code:'SCAN_JOB_ID_MISSING'});
 if(typeof confirm_blank!=='boolean')return res.status(400).json({error:'Choose whether the page is blank.',code:'SCAN_CONFIRMATION_REQUIRED'});
 let client=null,inTransaction=false,row=null;
 try{
  client=await pool.connect();
  await client.query('BEGIN');inTransaction=true;
  const found=await client.query(`SELECT j.id,j.status,j.program_name,j.actor_id,j.started_at,j.created_at,j.checkpoint,e.image_data FROM scan_jobs j LEFT JOIN scan_evidence e ON e.scan_job_id=j.id AND e.organization_id=j.organization_id WHERE j.id=$1 AND j.organization_id=$2 FOR UPDATE OF j`,[job_id,req.org.id]);
  row=found.rows[0]||null;
  if(!row){await client.query('ROLLBACK');inTransaction=false;return res.status(404).json({error:'Scan result not found.',code:'SCAN_NOT_FOUND'})}
  if(row.status!=='needs_confirmation'){await client.query('ROLLBACK');inTransaction=false;return res.status(409).json({error:'This scan no longer needs a blank-page confirmation.',code:'SCAN_CONFIRMATION_NOT_PENDING',status:row.status})}
  if(confirm_blank){
   const now=new Date().toISOString(),result={status:'ok',blank_confirmed:true,scan_pipeline_version:SCAN_PIPELINE_VERSION,new_members:0,recognized:0,needs_review:[],needs_review_count:0,rejected:[],total_extracted:0,total_valid:0,register_mode:'complete',verification:{accepted:0,rejected:0,review:0,passes:1,mode:'user_confirmed_blank'},evidence:{available:Boolean(row.image_data),job_id:row.id},layout:{provider:'qwen-full-page-observation',rows:0},summary:'You confirmed that this page is blank. No People or review records were changed.'};
   const detail={stage:'complete',status:'complete',blank_confirmed:true,updated_at:now};
   const done=await client.query(`UPDATE scan_jobs SET status='complete',progress='complete',progress_detail=$1::jsonb,result=$2::jsonb,checkpoint=COALESCE(checkpoint,'{}'::jsonb)||'{"user_confirmation":"confirmed_blank"}'::jsonb,completed_at=NOW(),duration_ms=CASE WHEN started_at IS NULL THEN NULL ELSE GREATEST(0,ROUND(EXTRACT(EPOCH FROM(NOW()-started_at))*1000)::int) END,heartbeat=NOW(),last_progress_at=NOW(),error_code=NULL,error_message=NULL,failed_stage=NULL,error_detail=NULL WHERE id=$3 AND organization_id=$4 AND status='needs_confirmation' RETURNING id`,[JSON.stringify(detail),JSON.stringify(result),row.id,req.org.id]);
   if(!done.rowCount){await client.query('ROLLBACK');inTransaction=false;return res.status(409).json({error:'This scan has already changed state.',code:'SCAN_CONFIRMATION_NOT_PENDING'})}
   await client.query('COMMIT');inTransaction=false;
   return res.status(200).json({ok:true,status:'complete',job_id:row.id,result,message:result.summary});
  }
  if(!row.image_data){await client.query('ROLLBACK');inTransaction=false;return res.status(409).json({error:'The saved photo is unavailable, so ARIA cannot reread it safely.',code:'SCAN_IMAGE_NOT_AVAILABLE'})}
  const detail={stage:'queued',status:'pending',confirmation:'user_says_not_blank',message:'Rereading the saved photo.',updated_at:new Date().toISOString()};
  const queued=await client.query(`UPDATE scan_jobs SET status='pending',progress='queued',progress_detail=$1::jsonb,result=NULL,completed_at=NULL,duration_ms=NULL,error_code=NULL,error_message=NULL,failed_stage=NULL,error_detail=NULL,attempt_count=attempt_count+1,next_attempt_at=NOW(),heartbeat=NOW(),last_progress_at=NOW() WHERE id=$2 AND organization_id=$3 AND status='needs_confirmation' RETURNING id`,[JSON.stringify(detail),row.id,req.org.id]);
  if(!queued.rowCount){await client.query('ROLLBACK');inTransaction=false;return res.status(409).json({error:'This scan has already changed state.',code:'SCAN_CONFIRMATION_NOT_PENDING'})}
  const imageBase64=Buffer.from(row.image_data).toString('base64'),organizationId=req.org.id,programName=row.program_name||'Default',actorId=row.actor_id||req.user?.id||null;
  await client.query('COMMIT');inTransaction=false;
  const task=processVisionJob(row.id,imageBase64,organizationId,programName,{actorId}).catch(error=>console.error('[SCAN_CONFIRMATION] Reread worker failed:',{job_id:row.id,organization_id:organizationId,error:error?.message||error}));
  try{waitUntil(task)}catch(error){console.error('[SCAN_CONFIRMATION] Could not register reread with waitUntil:',error?.message||error);void task}
  return res.status(200).json({ok:true,status:'pending',job_id:row.id,message:'ARIA is rereading the same saved photo. No People were changed by the incomplete read.'});
 }catch(error){
  if(client&&inTransaction)try{await client.query('ROLLBACK')}catch{}
  console.error('[SCAN_CONFIRMATION] Unable to resolve blank-page confirmation:',{job_id:job_id,organization_id:req.org.id,error:error?.message||error});
  return res.status(500).json({error:'ARIA could not safely record that choice. No People were changed.',code:'SCAN_CONFIRMATION_FAILED'});
 }finally{if(client)try{client.release()}catch{}}
}
export default withOrg(handler);
