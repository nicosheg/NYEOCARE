// lib/aiObserver.js
import pool from'./db';
import{calculateEstimatedCost}from'./costCalculator';
import crypto from'crypto';

export async function logAIUsage({
 organization_id,
 job_id=null,
 request_id=null,
 model_key,
 provider,
 model,
 purpose,
 prompt_version='v1',
 attempt=1,
 input_tokens=null,
 output_tokens=null,
 latency_ms=null,
 finish_reason=null,
 http_status=null,
 success=false,
 retry_reason=null,
 rate_limit_remaining_tokens=null,
 rate_limit_remaining_requests=null,
 rate_limit_reset_tokens=null,
 rate_limit_reset_requests=null,
 retry_after=null
}){
 const requestId=request_id||crypto.randomUUID();
 const input=typeof input_tokens==='number'&&Number.isFinite(input_tokens)&&input_tokens>=0?Math.floor(input_tokens):null;
 const output=typeof output_tokens==='number'&&Number.isFinite(output_tokens)&&output_tokens>=0?Math.floor(output_tokens):null;
 const total=input!==null&&output!==null?input+output:null;
 let inputCost=null,outputCost=null,totalCost=null;
 if(input!==null&&output!==null){
  try{
   const cost=calculateEstimatedCost(model_key,input,output);
   inputCost=cost.inputCost;
   outputCost=cost.outputCost;
   totalCost=cost.totalCost;
  }catch(err){console.error('[AI Observer] Cost calculation:',err.message)}
 }
 try{
  await pool.query(`
   INSERT INTO ai_usage_events(
    organization_id,job_id,request_id,provider,model,model_key,purpose,prompt_version,
    attempt,input_tokens,output_tokens,total_tokens,latency_ms,finish_reason,
    http_status,success,retry_reason,estimated_input_cost,estimated_output_cost,estimated_total_cost,
    rate_limit_remaining_tokens,rate_limit_remaining_requests,rate_limit_reset_tokens,
    rate_limit_reset_requests,retry_after
   )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
  `,[
   organization_id,job_id,requestId,provider,model,model_key,purpose,prompt_version,
   attempt,input,output,total,latency_ms,finish_reason,http_status,Boolean(success),retry_reason,
   inputCost,outputCost,totalCost,rate_limit_remaining_tokens,rate_limit_remaining_requests,
   rate_limit_reset_tokens,rate_limit_reset_requests,retry_after
  ]);
  return requestId;
 }catch(err){
  console.error('[AI Observer] Failed to log usage:',err.message);
  return requestId;
 }
}

export async function updateExtractionMetrics(requestId,extractionCount,validationCount,reviewCount){
 if(!requestId)return;
 try{
  await pool.query(`
   UPDATE ai_usage_events
   SET extraction_metrics=jsonb_build_object(
    'extraction_count',$1,
    'validation_count',$2,
    'review_count',$3
   )
   WHERE request_id=$4
  `,[extractionCount,validationCount,reviewCount,requestId]);
 }catch(err){console.error('[AI Observer] Extraction metrics:',err.message)}
   }
