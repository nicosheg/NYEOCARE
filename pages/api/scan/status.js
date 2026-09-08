// pages/api/scan/status.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

async function handler(req,res){
 const jobId=req.query.job_id;
 if(!jobId)return res.status(400).json({error:'Missing job_id'});
 const orgId=req.org.id;
 try{
  const jobRes=await pool.query(`SELECT id,status,progress,result,attempt_count,retry_count,started_at,last_progress_at,heartbeat,duration_ms,provider_used,completed_at FROM scan_jobs WHERE id=$1 AND organization_id=$2 LIMIT 1`,[jobId,orgId]);
  if(!jobRes.rows.length)return res.status(404).json({error:'Job not found'});
  const job=jobRes.rows[0],resultObj=job.result&&typeof job.result==='object'?job.result:(()=>{try{return job.result?JSON.parse(job.result):null}catch{return{raw:job.result}}})();
  let elapsed=0;
  if(job.started_at){
   const startMs=new Date(job.started_at).getTime();
   elapsed=job.duration_ms!=null?Math.max(0,Math.round(Number(job.duration_ms)/1000)):Number.isFinite(startMs)?Math.max(0,Math.round((Date.now()-startMs)/1000)):0;
  }
  const messages={
   queued:'ARIA is preparing to read the register…',
   enhancing:'ARIA is preparing the image…',
   layout_analysis:'ARIA is examining the register structure…',
   reading_handwriting:'ARIA is reviewing the handwriting…',
   verifying_rows:'ARIA is checking that every phone number belongs to the correct row…',
   validating:'ARIA is validating the extracted records…',
   matching_community:'ARIA is comparing with your community…',
   building_memory:'ARIA is remembering the verified people…',
   retrying:'ARIA is taking a little longer than usual…',
   complete:'Scan complete.'
  };
  let message=messages[job.progress]||messages[job.status]||'ARIA is working…',error=null;
  if(job.status==='failed'){
   const err=resultObj?.error;
   message=err?.userMessage||resultObj?.error||'ARIA could not complete this scan safely.';
   if(/rate limit|token|capacity/i.test(message))message='ARIA does not have enough provider capacity to safely finish this scan yet. Nothing was saved.';
   error=err?{code:err.code||'UNKNOWN_ERROR',stage:err.stage||'unknown',details:err.details||null}:null;
  }
  if(job.status==='processing'&&elapsed>180)message='This scan appears to have stalled. Your existing data is safe. You can try again.';
  else if(job.status==='processing'&&elapsed>90)message='ARIA is taking extra care with this register…';
  const attempts=job.attempt_count??job.retry_count??0;
  return res.status(200).json({status:job.status,progress:job.progress,message,retry_count:attempts,attempt_count:attempts,elapsed_seconds:elapsed,started_at:job.started_at||null,provider:job.provider_used,result:job.status==='complete'?resultObj:null,error:job.status==='failed'?error:null});
 }catch(err){
  console.error('Status error:',err);
  return res.status(500).json({error:'ARIA is having trouble. Please try again.'});
 }
}
export default withOrg(handler);
