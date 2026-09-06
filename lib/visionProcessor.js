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

async function updateJobState(client,jobId,state,progress,result,attemptCount,provider,startTime){
 const terminal=[INTERNAL_STATES.COMPLETED,INTERNAL_STATES.FAILED,INTERNAL_STATES.TIMED_OUT].includes(state);
 const now=new Date();
 const fields={
  status:dbStatusFromInternal(state),
  progress:progress||null,
  heartbeat:now,
  last_progress_at:now,
  attempt_count:attemptCount??0,
  provider_used:provider||null,
  completed_at:terminal?now:undefined,
  duration_ms:terminal?Math.max(0,Math.round(now-startTime)):undefined,
  result:result==null?undefined:result
 };
 const entries=Object.entries(fields).filter(([,v])=>v!==undefined);
 const set=entries.map(([key],i)=>`${key}=$${i+2}`).join(',');
 await client.query(`UPDATE scan_jobs SET ${set} WHERE id=$1`,[jobId,...entries.map(([,v])=>v)]);
}

function errorResult(stage,code,message,userMessage,details=null){
 return{error:{stage,code,message,userMessage,details}};
}

export async function processVisionJob(jobId,imageBase64,orgId,programName,options={}){
 const{evaluation=false,registerMode='complete',actorId=null}=options;
 const startTime=Date.now();
 const client=await pool.connect();
 let transactionOpen=false;
 let committed=false;

 try{
  if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.ANALYSING,'enhancing',null,0,null,startTime);

  const hash=crypto.createHash('sha256').update(imageBase64).digest('hex');

  if(!evaluation){
   await client.query(`UPDATE scan_jobs SET image_hash=$1,started_at=COALESCE(started_at,NOW()),heartbeat=NOW() WHERE id=$2`,[hash,jobId]);

   const cached=await client.query(
    `SELECT result FROM scan_jobs
     WHERE organization_id=$1 AND image_hash=$2 AND status='complete' AND id<>$3
     ORDER BY completed_at DESC NULLS LAST LIMIT 1`,
    [orgId,hash,jobId]
   );

   if(cached.rows.length){
    await updateJobState(client,jobId,INTERNAL_STATES.COMPLETED,'complete',cached.rows[0].result,0,'cache',startTime);
    return cached.rows[0].result;
   }
  }

  let vision;

  try{
   vision=await callVisionWithRetry(
    imageBase64,
    attempt=>{
     if(!evaluation)updateJobState(client,jobId,INTERNAL_STATES.RETRYING,'retrying',{message:`ARIA is retrying (${attempt})`},attempt,'Groq',startTime).catch(()=>{});
    },
    {organization_id:orgId,job_id:jobId,purpose:'scan',prompt_version:'v3',evaluation}
   );
  }catch(err){
   const e=errorResult('ai_request','AI_PROVIDER_ERROR',err.message||'Vision failed','ARIA could not process the image. Please try again.');
   if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,0,null,startTime);
   return e;
  }

  const rawContent=vision?.data?.choices?.[0]?.message?.content;

  if(typeof rawContent!=='string'||!rawContent.trim()){
   const e=errorResult('ai_request','EMPTY_AI_RESPONSE','Vision returned no content.','ARIA could not read the register. Please try again.');
   if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,vision?.attempt||0,vision?.provider||null,startTime);
   return e;
  }

  if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.EXTRACTING,'reading_handwriting',null,vision.attempt,vision.provider,startTime);

  let validation;

  try{
   validation=await validateScanOutput(rawContent,orgId,programName,jobId,{evaluation});
  }catch(err){
   const e=errorResult('validation','VALIDATION_ERROR',err.message||'Validation failed','ARIA could not safely understand the register.');
   if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,vision.attempt,vision.provider,startTime);
   return e;
  }

  if(!validation.valid){
   const e=errorResult('parse_json','INVALID_AI_RESPONSE',validation.error,'ARIA could not safely read the register.');
   if(!evaluation)await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,vision.attempt,vision.provider,startTime);
   return e;
  }

  if(evaluation)return validation;

  if(!validation.people.length){
   const result={
    status:'ok',
    new_members:0,
    updated:0,
    duplicates:[],
    needs_review:validation.needsReview,
    rejected:validation.rejected,
    people:[],
    total_extracted:validation.total_extracted,
    total_valid:validation.total_valid,
    summary:'ARIA read the register but found no safely usable people.'
   };
   await updateJobState(client,jobId,INTERNAL_STATES.COMPLETED,'complete',result,vision.attempt,vision.provider,startTime);
   return result;
  }

  await updateJobState(client,jobId,INTERNAL_STATES.VALIDATING,'validating',null,vision.attempt,vision.provider,startTime);
  await client.query('BEGIN');
  transactionOpen=true;

  const identity=await handleScanEvent(validation.people,orgId,jobId,client);

  await updateJobState(client,jobId,INTERNAL_STATES.MATCHING,'matching_community',null,vision.attempt,vision.provider,startTime);

  const newPeople=[];
  const matchedPeople=[];
  const events=[];

  for(const decision of identity.decisions){
   if(decision.status==='alive'&&decision.best_candidate_id){
    matchedPeople.push({id:decision.best_candidate_id,name:decision.extracted_name});
    continue;
   }

   if(decision.status!=='new')continue;

   const first=decision.extracted_first_name;
   const last=decision.extracted_last_name;
   const stage=validation.people.find(p=>p.name===decision.extracted_name)?.relationship_stage;
   const type=['regular','returning','familiar_face'].includes(stage)?'member':'visitor';
   const confidence=normalizeConfidence(decision.confidence,70);

   const insert=await client.query(
    `INSERT INTO people(organization_id,first_name,last_name,phone,type,status,confidence,source,created_by,last_scan_job_id,living_truth)
     VALUES($1,$2,$3,$4,$5,'active',$6,'scan',$7,$8,$9)
     RETURNING id,first_name,last_name,phone,type`,
    [
     orgId,
     first,
     last,
     decision.extracted_phone||null,
     type,
     confidence,
     actorId,
     jobId,
     JSON.stringify({status:'alive',confidence,source:'scan',updated_at:new Date().toISOString()})
    ]
   );

   const person=insert.rows[0];

   newPeople.push({
    id:person.id,
    name:[person.first_name,person.last_name].filter(Boolean).join(' '),
    type:person.type
   });

   const event=await emitAriaEvent({
    organizationId:orgId,
    personId:person.id,
    type:'PERSON_CREATED',
    source:'scan',
    actorId,
    metadata:{jobId,programName,confidence},
    eventKey:`scan:${jobId}:person:${person.id}`
   },client);

   if(event)events.push(event);
  }

  const result={
   status:'ok',
   new_members:newPeople.length,
   updated:matchedPeople.length,
   duplicates:[],
   needs_review:[...validation.needsReview,...identity.needsReview],
   rejected:validation.rejected,
   people:validation.people.map(p=>({name:p.name,phone:p.phone,confidence:p.confidence})),
   total_extracted:validation.total_extracted,
   total_valid:validation.total_valid,
   register_mode:registerMode,
   summary:`ARIA processed ${validation.people.length} people. ${newPeople.length} new, ${matchedPeople.length} recognised, ${identity.needsReview.length+validation.needsReview.length} need review.`
  };

  await client.query('COMMIT');
  transactionOpen=false;
  committed=true;

  await updateJobState(client,jobId,INTERNAL_STATES.COMPLETED,'complete',result,vision.attempt,vision.provider,startTime);

  if(events.length){
   Promise.allSettled(events.map(event=>processAriaEvent(event))).catch(()=>{});
  }

  return result;
 }catch(err){
  if(transactionOpen)try{await client.query('ROLLBACK')}catch{}
  const e=errorResult('database_insert','DB_TRANSACTION_ERROR',err.message||'Database transaction failed','ARIA could not save the scan safely.');

  if(!committed&&!evaluation){
   try{await updateJobState(client,jobId,INTERNAL_STATES.FAILED,'failed',e,0,null,startTime)}catch{}
  }

  return e;
 }finally{
  client.release();
 }
  }
