// lib/visionProcessor.js
import pool from'./db';
import{callVisionWithRetry}from'./aiProvider';
import{validateScanOutput}from'./scanValidation';
import{INTERNAL_STATES,dbStatusFromInternal}from'./scanState';
import crypto from'crypto';
import{normalizeConfidence}from'./confidenceUtils';
import{handleScanEvent}from'./aria/director';
import{emitAriaEvent}from'./aria/eventEmitter';
import{processAriaEvent}from'./aria/eventProcessor';

const PIPELINE_VERSION='v15-clean-names-review';

async function updateJobState(client,jobId,state,progress,result,attemptCount,provider,startTime){
 const terminal=[INTERNAL_STATES.COMPLETED,INTERNAL_STATES.FAILED,INTERNAL_STATES.TIMED_OUT].includes(state),now=new Date(),fields={status:dbStatusFromInternal(state),progress:progress||null,heartbeat:now,last_progress_at:now,attempt_count:attemptCount??0,provider_used:provider||null,completed_at:terminal?now:undefined,duration_ms:terminal?Math.max(0,Math.round(now-startTime)):undefined,result:result==null?undefined:result},entries=Object.entries(fields).filter(([,v])=>v!==undefined),set=entries.map(([key],i)=>`${key}=$${i+2}`).join(',');
 await client.query(`UPDATE scan_jobs SET ${set} WHERE id=$1`,[jobId,...entries.map(([,v])=>v)]);
}
function errorResult(stage,code,message,userMessage,details=null){return{error:{stage,code,message,userMessage,details}}}
function decodeImage(value){return Buffer.from(String(value||'').replace(/^data:[^;]+;base64,/,'').replace(/\s/g,''),'base64')}
async function saveEvidence(client,jobId,orgId,imageBase64,hash){
 const buffer=decodeImage(imageBase64);
 if(!buffer.length||buffer.length>4000000)throw new Error('Prepared scan image is invalid or too large.');
 await client.query(`INSERT INTO scan_evidence(organization_id,scan_job_id,mime_type,image_hash,image_data) VALUES($1,$2,'image/jpeg',$3,$4) ON CONFLICT(scan_job_id) DO UPDATE SET image_hash=EXCLUDED.image_hash,image_data=EXCLUDED.image_data,mime_type=EXCLUDED.mime_type`,[orgId,jobId,hash,buffer]);
 return{available:true,job_id:jobId,mime_type:'image/jpeg'};
}
async function acquireGroqLock(client){await client.query(`SELECT pg_advisory_lock(hashtextextended('nyeocare:groq:scan',0))`)}
async function releaseGroqLock(client){await client.query(`SELECT pg_advisory_unlock(hashtextextended('nyeocare:groq:scan',0))`).catch(()=>{})}
async function finalizeJob(jobId,result,attempt,startTime){
 const c=await pool.connect();
 try{await updateJobState(c,jobId,INTERNAL_STATES.COMPLETED,'complete',result,attempt,'groq',startTime);return true}catch(err){console.error(`[SCAN] Final status update failed for ${jobId}:`,err?.message||err);return false}finally{c.release()}
}
function reviewFor(person,validation){
 return validation.needsReview.find(x=>x.extracted_name===person.name)||(validation.needsReview.find(x=>x.extracted_phone&&x.extracted_phone===person.phone))||null;
}
function phoneRecords(person){
 return(Array.isArray(person.phones)?person.phones:person.phone?[person.phone]:[]).slice(0,2).map((normalized,i)=>({raw:(Array.isArray(person.rawPhones)?person.rawPhones[i]:i===0?person.rawPhone:null)||normalized,normalized,source:'scan',index:i+1}));
}
async function insertQuarantine(client,orgId,jobId,actorId,programName,person,review){
 const phoneNumbers=phoneRecords(person),reason=review?.reason||'ARIA found something that needs your attention.';
 const metadata={scan_pipeline_version:PIPELINE_VERSION,honorific:person.honorific||null,row_number:person.row_number,scan_evidence_job_id:jobId,vision_provider:'groq',phone_numbers:phoneNumbers,raw_name:person.raw_name||null,raw_phones:person.rawPhones||[],review_reasons:review?.reasons||[],review_suggestion:review?.suggestion||null,program_name:programName};
 const result=await client.query(`INSERT INTO people(organization_id,first_name,last_name,display_name,phone,phone_numbers,type,status,confidence,source,created_by,last_scan_job_id,quarantine_reason,quarantined_at,living_truth,metadata) VALUES($1,$2,$3,$4,$5,$6,'visitor','quarantined',$7,'scan',$8,$9,$10,NOW(),$11,$12) RETURNING id,display_name,phone,phone_numbers`,[orgId,person.first_name,person.last_name,person.display_name,person.phone,JSON.stringify(phoneNumbers),normalizeConfidence(person.confidence,70),actorId,jobId,reason,JSON.stringify({status:'quarantined',source:'scan',updated_at:new Date().toISOString()}),JSON.stringify(metadata)]);
 return result.rows[0];
}
export async function processVisionJob(jobId,imageBase64,orgId,programName,options={}){
 const{evaluation=false,registerMode='complete',actorId=null}=options,startTime=Date.now(),client=await pool.connect();
 let transactionOpen=false,committed=false,groqLocked=false;
 try{
  if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.ANALYSING,'preparing_image',null,0,null,startTime);
  const hash=crypto.createHash('sha256').update(imageBase64).digest('hex');
  if(!evaluation){
   await client.query(`UPDATE scan_jobs SET image_hash=$1,started_at=COALESCE(started_at,NOW()),heartbeat=NOW() WHERE id=$2`,[hash,jobId]);
   await saveEvidence(client,jobId,orgId,imageBase64,hash);
   const cached=await client.query(`SELECT result FROM scan_jobs WHERE organization_id=$1 AND image_hash=$2 AND status='complete' AND id<>$3 AND result->>'scan_pipeline_version'=$4 ORDER BY completed_at DESC NULLS LAST LIMIT 1`,[orgId,hash,jobId,PIPELINE_VERSION]);
   if(cached.rows.length){await finalizeJob(jobId,cached.rows[0].result,0,startTime);return cached.rows[0].result}
  }
  if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.EXTRACTING,'understanding_page',null,0,'groq',startTime);
  await acquireGroqLock(client);groqLocked=true;
  let vision;
  try{vision=await callVisionWithRetry(imageBase64,null,progress=>{if(!evaluation)updateJobState(client,jobId,INTERNAL_STATES.EXTRACTING,progress,null,vision?.attempt||1,'groq',startTime).catch(()=>{})},{organization_id:orgId,job_id:jobId,purpose:'scan',prompt_version:PIPELINE_VERSION,evaluation})}
  catch(err){const e=errorResult('ai_request',err.code||'AI_PROVIDER_ERROR',err.message||'Vision verification failed.','ARIA could not safely read this register. Nothing was changed.');if(!evaluation)try{await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,0,'groq',startTime)}catch{}return e}
  finally{await releaseGroqLock(client);groqLocked=false}
  const rawContent=vision?.data?.choices?.[0]?.message?.content;
  if(typeof rawContent!=='string'||!rawContent.trim()){const e=errorResult('ai_request','EMPTY_AI_RESPONSE','Vision returned no content.','ARIA could not safely read the register.');if(!evaluation)try{await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,vision?.attempt||0,'groq',startTime)}catch{}return e}
  if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.VALIDATING,'validating',null,vision.attempt,'groq',startTime);
  const validation=await validateScanOutput(rawContent,orgId,programName,jobId,{evaluation});
  if(!validation.valid){const e=errorResult('parse_json','INVALID_AI_RESPONSE',validation.error,'ARIA could not safely understand the register.');if(!evaluation)try{await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,vision.attempt,'groq',startTime)}catch{}return e}
  if(evaluation)return validation;
  await updateJobState(client,jobId,INTERNAL_STATES.MATCHING,'matching_community',null,vision.attempt,'groq',startTime);
  await client.query('BEGIN');transactionOpen=true;
  const identity=await handleScanEvent(validation.people.filter(p=>!reviewFor(p,validation)),orgId,jobId,client);
  await updateJobState(client,jobId,INTERNAL_STATES.SAVING,'building_memory',null,vision.attempt,'groq',startTime);
  const newPeople=[],matchedPeople=[],quarantinedPeople=[],events=[];
  for(const person of validation.people){
   const review=reviewFor(person,validation);
   if(review){
    const candidate=await insertQuarantine(client,orgId,jobId,actorId,programName,person,review);
    quarantinedPeople.push({id:candidate.id,name:candidate.display_name,phone:candidate.phone,phones:candidate.phone_numbers||[],reason:review.reason,suggestion:review.suggestion,row_number:person.row_number});
    continue;
   }
   const decision=identity.decisions.find(d=>d.extracted_name===person.name||(d.extracted_phone&&d.extracted_phone===person.phone));
   if(decision?.status==='alive'&&decision.best_candidate_id){matchedPeople.push({id:decision.best_candidate_id,name:decision.extracted_name});continue}
   if(decision?.status==='conflict'||decision?.status==='needs_decision'){
    const review={reason:'ARIA found more than one possible existing person.',suggestion:'Choose the correct existing person or confirm that this is a new person.',reasons:['identity_conflict']};
    const candidate=await insertQuarantine(client,orgId,jobId,actorId,programName,person,review);
    quarantinedPeople.push({id:candidate.id,name:candidate.display_name,phone:candidate.phone,phones:candidate.phone_numbers||[],reason:review.reason,suggestion:review.suggestion,row_number:person.row_number});
    continue;
   }
   const first=person.first_name,last=person.last_name,stage=person.relationship_stage,type=['regular','returning','familiar_face'].includes(stage)?'member':'visitor',confidence=normalizeConfidence(person.confidence,70),phoneNumbers=phoneRecords(person);
   const metadata={scan_pipeline_version:PIPELINE_VERSION,honorific:person.honorific||null,row_number:person.row_number,scan_evidence_job_id:jobId,vision_provider:'groq',phone_numbers:phoneNumbers,raw_name:person.raw_name||null,raw_phones:person.rawPhones||[]};
   const insert=await client.query(`INSERT INTO people(organization_id,first_name,last_name,display_name,phone,phone_numbers,type,status,confidence,source,created_by,last_scan_job_id,living_truth,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,'scan',$9,$10,$11,$12) RETURNING id,display_name,phone,phone_numbers,type`,[orgId,first,last,person.display_name,person.phone,JSON.stringify(phoneNumbers),type,confidence,actorId,jobId,JSON.stringify({status:'alive',source:'scan',updated_at:new Date().toISOString()}),JSON.stringify(metadata)]);
   const created=insert.rows[0];
   newPeople.push({id:created.id,name:created.display_name,type:created.type,phones:created.phone_numbers||[]});
   const event=await emitAriaEvent({organizationId:orgId,personId:created.id,type:'PERSON_CREATED',source:'scan',actorId,metadata:{jobId,programName,pipeline_version:PIPELINE_VERSION},eventKey:`scan:${jobId}:person:${created.id}`},client);
   if(event)events.push(event);
  }
  const totalPeople=validation.people.length;
  const result={status:'ok',scan_pipeline_version:PIPELINE_VERSION,new_members:newPeople.length,updated:matchedPeople.length,duplicates:[],needs_review:quarantinedPeople,rejected:validation.rejected,people:validation.people.map(p=>({name:p.display_name,phone:p.phone,phones:p.phones||[],raw_phones:p.rawPhones||[],review:Boolean(reviewFor(p,validation))})),total_extracted:totalPeople,total_valid:totalPeople,register_mode:registerMode,verification:{accepted:validation.people.length-quarantinedPeople.length,review:quarantinedPeople.length,passes:vision.verification?.passes||1},evidence:{available:true,job_id:jobId},layout:{provider:'groq-direct-vision',rows:totalPeople},summary:`ARIA found ${totalPeople} people, safely remembered ${newPeople.length+matchedPeople.length}, and sent ${quarantinedPeople.length} to Review Center.`};
  await client.query('COMMIT');transactionOpen=false;committed=true;client.release();
  if(events.length)Promise.allSettled(events.map(event=>processAriaEvent(event))).catch(()=>{});
  await finalizeJob(jobId,result,vision.attempt,startTime);return result;
 }catch(err){
  if(transactionOpen)try{await client.query('ROLLBACK')}catch{}
  const e=errorResult('database_insert','DB_TRANSACTION_ERROR',err.message||'Database transaction failed','ARIA could not save the scan safely.');
  if(!committed&&!evaluation)try{await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,0,null,startTime)}catch{}
  return e;
 }finally{if(groqLocked)await releaseGroqLock(client);try{client.release()}catch{}}
                                                                                }
