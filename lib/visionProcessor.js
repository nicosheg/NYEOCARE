// lib/visionProcessor.js
import pool from'./db';
import{analyzeRegisterLayout}from'./documentIntelligence';
import{callVisionWithRetry}from'./aiProvider';
import{validateScanOutput}from'./scanValidation';
import{INTERNAL_STATES,dbStatusFromInternal}from'./scanState';
import crypto from'crypto';
import{normalizeConfidence}from'./confidenceUtils';
import{handleScanEvent}from'./aria/director';
import{emitAriaEvent}from'./aria/eventEmitter';
import{processAriaEvent}from'./aria/eventProcessor';

const PIPELINE_VERSION='v7-layout-gated';

async function updateJobState(client,jobId,state,progress,result,attemptCount,provider,startTime){
 const terminal=[INTERNAL_STATES.COMPLETED,INTERNAL_STATES.FAILED,INTERNAL_STATES.TIMED_OUT].includes(state);
 const now=new Date(),fields={status:dbStatusFromInternal(state),progress:progress||null,heartbeat:now,last_progress_at:now,attempt_count:attemptCount??0,provider_used:provider||null,completed_at:terminal?now:undefined,duration_ms:terminal?Math.max(0,Math.round(now-startTime)):undefined,result:result==null?undefined:result};
 const entries=Object.entries(fields).filter(([,v])=>v!==undefined),set=entries.map(([key],i)=>`${key}=$${i+2}`).join(',');
 await client.query(`UPDATE scan_jobs SET ${set} WHERE id=$1`,[jobId,...entries.map(([,v])=>v)]);
}
function errorResult(stage,code,message,userMessage,details=null){return{error:{stage,code,message,userMessage,details}}}
function decodeImage(value){return Buffer.from(String(value||'').replace(/^data:[^;]+;base64,/,''),'base64')}
async function saveEvidence(client,jobId,orgId,imageBase64,hash){
 const buffer=decodeImage(imageBase64);
 if(!buffer.length||buffer.length>4000000)throw new Error('Prepared scan image is invalid or too large.');
 await client.query(`INSERT INTO scan_evidence(organization_id,scan_job_id,mime_type,image_hash,image_data) VALUES($1,$2,'image/jpeg',$3,$4) ON CONFLICT(scan_job_id) DO UPDATE SET image_hash=EXCLUDED.image_hash,image_data=EXCLUDED.image_data,mime_type=EXCLUDED.mime_type`,[orgId,jobId,hash,buffer]);
 return{available:true,job_id:jobId,mime_type:'image/jpeg'};
}
async function acquireGroqLock(client){await client.query(`SELECT pg_advisory_lock(hashtextextended('nyeocare:groq:scan',0))`)}
async function releaseGroqLock(client){await client.query(`SELECT pg_advisory_unlock(hashtextextended('nyeocare:groq:scan',0))`).catch(()=>{})}

export async function processVisionJob(jobId,imageBase64,orgId,programName,options={}){
 const{evaluation=false,registerMode='complete',actorId=null}=options,startTime=Date.now(),client=await pool.connect();
 let transactionOpen=false,committed=false,groqLocked=false;
 try{
  if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.ANALYSING,'enhancing',null,0,null,startTime);
  const hash=crypto.createHash('sha256').update(imageBase64).digest('hex');
  if(!evaluation){
   await client.query(`UPDATE scan_jobs SET image_hash=$1,started_at=COALESCE(started_at,NOW()),heartbeat=NOW() WHERE id=$2`,[hash,jobId]);
   await saveEvidence(client,jobId,orgId,imageBase64,hash);
   const cached=await client.query(`SELECT result FROM scan_jobs WHERE organization_id=$1 AND image_hash=$2 AND status='complete' AND id<>$3 AND result->>'scan_pipeline_version'=$4 ORDER BY completed_at DESC NULLS LAST LIMIT 1`,[orgId,hash,jobId,PIPELINE_VERSION]);
   if(cached.rows.length){await updateJobState(client,jobId,INTERNAL_STATES.COMPLETED,'complete',cached.rows[0].result,0,'cache',startTime);return cached.rows[0].result}
  }
  let layout;
  try{
   layout=await analyzeRegisterLayout(imageBase64,progress=>{if(!evaluation)updateJobState(client,jobId,INTERNAL_STATES.ANALYSING,progress,null,0,'azure-document-intelligence',startTime).catch(()=>{})});
  }catch(err){
   const e=errorResult('layout_analysis',err.code||'DOCUMENT_LAYOUT_ERROR',err.message||'Layout analysis failed.','ARIA could not safely understand the register structure. No people were saved.');
   if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,0,'azure-document-intelligence',startTime);
   return e;
  }
  if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.EXTRACTING,'reading_handwriting',null,0,'azure+groq',startTime);
  await acquireGroqLock(client);groqLocked=true;
  let vision;
  try{
   vision=await callVisionWithRetry(imageBase64,layout,(progress)=>{if(!evaluation)updateJobState(client,jobId,INTERNAL_STATES.EXTRACTING,progress,null,vision?.attempt||1,'groq',startTime).catch(()=>{})},{organization_id:orgId,job_id:jobId,purpose:'scan',prompt_version:PIPELINE_VERSION,evaluation});
  }catch(err){
   const e=errorResult('ai_request',err.code||'AI_PROVIDER_ERROR',err.message||'Vision verification failed.','ARIA could not safely verify this register. Nothing was saved.');
   if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,0,'groq',startTime);
   return e;
  }finally{await releaseGroqLock(client);groqLocked=false}
  const rawContent=vision?.data?.choices?.[0]?.message?.content;
  if(typeof rawContent!=='string'||!rawContent.trim()){
   const e=errorResult('ai_request','EMPTY_AI_RESPONSE','Vision returned no content.','ARIA could not safely read the register.');
   if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,vision?.attempt||0,'groq',startTime);
   return e;
  }
  if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.VALIDATING,'validating',null,vision.attempt,'groq',startTime);
  let validation;
  try{validation=await validateScanOutput(rawContent,orgId,programName,jobId,{evaluation})}catch(err){
   const e=errorResult('validation','VALIDATION_ERROR',err.message||'Validation failed','ARIA could not safely understand the register.');
   if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,vision.attempt,'groq',startTime);
   return e;
  }
  if(!validation.valid){
   const e=errorResult('parse_json','INVALID_AI_RESPONSE',validation.error,'ARIA could not safely read the register.');
   if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,vision.attempt,'groq',startTime);
   return e;
  }
  if(evaluation)return validation;
  if(!validation.people.length){
   const result={status:'ok',scan_pipeline_version:PIPELINE_VERSION,new_members:0,updated:0,duplicates:[],needs_review:validation.needsReview,rejected:validation.rejected,people:[],total_extracted:validation.total_extracted,total_valid:0,verification:{accepted:0,review:validation.needsReview.length,passes:vision.verification?.passes||2},evidence:{available:true,job_id:jobId},layout:{provider:layout.provider,rows:layout.rows.length},summary:`ARIA safely held all ${validation.total_extracted} rows for review rather than guessing.`};
   await updateJobState(client,jobId,INTERNAL_STATES.COMPLETED,'complete',result,vision.attempt,'groq',startTime);
   return result;
  }
  await updateJobState(client,jobId,INTERNAL_STATES.MATCHING,'matching_community',null,vision.attempt,'groq',startTime);
  await client.query('BEGIN');transactionOpen=true;
  const identity=await handleScanEvent(validation.people,orgId,jobId,client);
  await updateJobState(client,jobId,INTERNAL_STATES.SAVING,'building_memory',null,vision.attempt,'groq',startTime);
  const newPeople=[],matchedPeople=[],events=[];
  for(const decision of identity.decisions){
   if(decision.status==='alive'&&decision.best_candidate_id){matchedPeople.push({id:decision.best_candidate_id,name:decision.extracted_name});continue}
   if(decision.status!=='new')continue;
   const source=validation.people.find(p=>p.name===decision.extracted_name)||validation.people.find(p=>p.phone===decision.extracted_phone);
   const first=decision.extracted_first_name,last=decision.extracted_last_name,stage=source?.relationship_stage,type=['regular','returning','familiar_face'].includes(stage)?'member':'visitor',confidence=normalizeConfidence(decision.confidence,90),displayName=source?.display_name||decision.extracted_name;
   const metadata={scan_pipeline_version:PIPELINE_VERSION,honorific:source?.honorific||null,row_number:source?.row_number,scan_evidence_job_id:jobId,layout_provider:layout.provider};
   const insert=await client.query(`INSERT INTO people(organization_id,first_name,last_name,display_name,phone,type,status,confidence,source,created_by,last_scan_job_id,living_truth,metadata) VALUES($1,$2,$3,$4,$5,$6,'active',$7,'scan',$8,$9,$10,$11) RETURNING id,first_name,last_name,display_name,phone,type`,[orgId,first,last,displayName,decision.extracted_phone||null,type,confidence,actorId,jobId,JSON.stringify({status:'alive',confidence,source:'scan',updated_at:new Date().toISOString()}),JSON.stringify(metadata)]);
   const person=insert.rows[0];
   newPeople.push({id:person.id,name:person.display_name||[person.first_name,person.last_name].filter(Boolean).join(' '),type:person.type});
   const event=await emitAriaEvent({organizationId:orgId,personId:person.id,type:'PERSON_CREATED',source:'scan',actorId,metadata:{jobId,programName,confidence,pipeline_version:PIPELINE_VERSION},eventKey:`scan:${jobId}:person:${person.id}`},client);
   if(event)events.push(event);
  }
  const combinedReview=[...validation.needsReview,...identity.needsReview];
  const result={status:'ok',scan_pipeline_version:PIPELINE_VERSION,new_members:newPeople.length,updated:matchedPeople.length,duplicates:[],needs_review:combinedReview,rejected:validation.rejected,people:validation.people.map(p=>({name:p.display_name||p.name,phone:p.phone,confidence:p.confidence,row_number:p.row_number})),total_extracted:validation.total_extracted,total_valid:validation.total_valid,register_mode:registerMode,verification:{accepted:validation.people.length,review:combinedReview.length,passes:vision.verification?.passes||2},evidence:{available:true,job_id:jobId},layout:{provider:layout.provider,rows:layout.rows.length},summary:`ARIA verified ${validation.people.length} rows and held ${combinedReview.length} rows for human review. Nothing uncertain was silently guessed.`};
  await client.query('COMMIT');transactionOpen=false;committed=true;
  await updateJobState(client,jobId,INTERNAL_STATES.COMPLETED,'complete',result,vision.attempt,'groq',startTime);
  if(events.length)Promise.allSettled(events.map(event=>processAriaEvent(event))).catch(()=>{});
  return result;
 }catch(err){
  if(transactionOpen)try{await client.query('ROLLBACK')}catch{}
  const e=errorResult('database_insert','DB_TRANSACTION_ERROR',err.message||'Database transaction failed','ARIA could not save the scan safely.');
  if(!committed&&!evaluation)try{await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,0,null,startTime)}catch{}
  return e;
 }finally{
  if(groqLocked)await releaseGroqLock(client);
  client.release();
 }
                                              }
