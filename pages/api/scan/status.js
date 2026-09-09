// pages/api/scan/status.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

function ariaFailure(err){
 const code=err?.code||'';
 const message=String(err?.message||'').toLowerCase();
 if(code==='AI_OUTPUT_LIMIT'||code==='AI_OUTPUT_TRUNCATED'||/output tokens per minute|otpm|requested .*max_tokens|reduce max_tokens/.test(message))return'ARIA couldn’t safely finish reading this register this time. Nothing was changed.';
 if(code==='NO_PEOPLE_EXTRACTED')return'ARIA couldn’t confidently read any people from this register. Nothing was changed.';
 if(code==='AI_TIMEOUT')return'ARIA needs a little more time to finish reading this register. Nothing was changed.';
 if(code==='AI_NOT_CONFIGURED')return'ARIA isn’t ready to read registers yet. Nothing was changed.';
 if(code==='INVALID_IMAGE')return'ARIA couldn’t read this image safely. Please try another clear photo.';
 if(code==='EMPTY_AI_RESPONSE')return'ARIA couldn’t get a complete reading this time. Nothing was changed.';
 if(/rate limit|capacity|temporarily unavailable|429/.test(message))return'ARIA needs a moment before she can continue. Nothing was changed.';
 return'ARIA couldn’t safely complete this scan. Nothing was changed.';
}
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
  const messages={queued:'ARIA is preparing to read the register…',preparing_image:'ARIA is preparing the image…',reading_page:'ARIA is examining the register structure…',rereading_original:'ARIA is carefully rereading the register…',reading_handwriting:'ARIA is reviewing the handwriting…',finalizing_scan:'ARIA is finalizing the reading…',validating:'ARIA is validating what she found…',matching_community:'ARIA is comparing what she found with your people…',building_memory:'ARIA is remembering the verified people…',provider_wait:'ARIA needs a moment before continuing…',retrying:'ARIA is taking another careful pass…',complete:'Scan complete.'};
  let message=messages[job.progress]||messages[job.status]||'ARIA is working…',error=null;
  if(job.status==='failed'){
   const err=resultObj?.error;
   message=ariaFailure(err);
   error=err?{code:err.code||'UNKNOWN_ERROR',stage:err.stage||'unknown',details:err.details||null}:null;
  }
  if(job.status==='processing'&&elapsed>180)message='ARIA appears to have paused while reading this register. Your existing data is safe. You can try again.';
  else if(job.status==='processing'&&elapsed>90)message='ARIA is taking extra care with this register…';
  const attempts=job.attempt_count??job.retry_count??0;
  return res.status(200).json({status:job.status,progress:job.progress,message,retry_count:attempts,attempt_count:attempts,elapsed_seconds:elapsed,started_at:job.started_at||null,provider:job.provider_used,result:job.status==='complete'?resultObj:null,error:job.status==='failed'?error:null});
 }catch(err){
  console.error('Status error:',err);
  return res.status(500).json({error:'ARIA is having trouble. Please try again.'});
 }
}
export default withOrg(handler);
