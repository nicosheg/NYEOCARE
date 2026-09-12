// pages/api/review/resolve.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';
import normalizePhone from'../../../lib/phoneUtils';
import{normalizeDisplayName,normalizeName}from'../../../lib/scanValidation';
import{emitAriaEvent}from'../../../lib/aria/eventEmitter';
import{processAriaEvent}from'../../../lib/aria/eventProcessor';
const cleanName=v=>String(v||'').replace(/\s+/g,' ').trim().slice(0,160);
function splitName(value){const n=normalizeDisplayName(value),parts=n.core.split(/\s+/).filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' '),display:n.display}}
function phonesFrom(row){const v=Array.isArray(row?.phone_numbers)?row.phone_numbers:row?.phone?[row.phone]:[];return[...new Set(v.map(x=>normalizePhone(typeof x==='string'?x:x?.normalized||x?.raw||x?.phone)).filter(Boolean))].slice(0,2)}
function phoneList(body,row){const raw=Array.isArray(body?.phones)?body.phones:(body?.phone?[body.phone]:[]),v=raw.length?raw:phonesFrom(row);return[...new Set(v.map(normalizePhone).filter(Boolean))].slice(0,2)}
function candidateIds(row){return Array.isArray(row?.metadata?.candidate_ids)?row.metadata.candidate_ids.map(String):[]}
async function phoneCollision(db,orgId,personId,phones){if(!phones.length)return null;const q=await db.query(`SELECT id,display_name,phone,phone_numbers FROM people WHERE organization_id=$1 AND status='active' AND id<>$2 AND (phone=ANY($3::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(phone_numbers,'[]'::jsonb)) v WHERE v->>'normalized'=ANY($3::text[]))) LIMIT 1`,[orgId,personId,phones]);return q.rows[0]||null}
async function aliasCollision(db,orgId,personId,alias){const key=normalizeName(alias);if(!key)return null;const q=await db.query(`SELECT pa.person_id,p.display_name FROM person_aliases pa JOIN people p ON p.id=pa.person_id WHERE pa.organization_id=$1 AND p.status='active' AND regexp_replace(lower(pa.alias),'[^a-z0-9]+','','g')=regexp_replace(lower($2),'[^a-z0-9]+','','g') AND pa.person_id<>$3 LIMIT 1`,[orgId,alias,personId]);return q.rows[0]||null}
async function rememberAlias(db,{orgId,personId,alias,actorId,reviewId,scanJobId,canonicalName,phones}){const clean=cleanName(alias),key=normalizeName(clean);if(!key)return;const collision=await aliasCollision(db,orgId,personId,clean);if(collision)throw Object.assign(new Error('That name is already remembered as an alias for another person.'),{statusCode:409,code:'ALIAS_ALREADY_ASSIGNED',person:collision});await db.query(`INSERT INTO person_aliases(organization_id,person_id,alias,created_by) SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM person_aliases WHERE organization_id=$1 AND person_id=$2 AND regexp_replace(lower(alias),'[^a-z0-9]+','','g')=regexp_replace(lower($3),'[^a-z0-9]+','','g'))`,[orgId,personId,clean,actorId]);await db.query(`INSERT INTO aria_learning(organization_id,person_id,scope_key,learning_type,learning_key,value,confidence,source_type,source_id,active) VALUES($1,$2,'person_identity','identity_alias',$3,$4,1,'human_review',$5,true)`,[orgId,personId,key,{canonical_name:canonicalName,observed_name:clean,phones,scan_job_id:scanJobId,review_id:reviewId,confirmed_by:actorId},reviewId])}
async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const{id,action,name,phone,phones,candidateId}=req.body||{};
 if(!id||!['approve','edit','delete','dismiss'].includes(action))return res.status(400).json({error:'Invalid review action.'});
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const found=await db.query(`SELECT * FROM people WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,req.org.id]);
  if(!found.rows.length){await db.query('ROLLBACK');return res.status(404).json({error:'Review item not found.'})}
  const pending=found.rows[0],truth=pending.living_truth?.status;
  if(pending.status!=='active'||['alive','archived'].includes(truth)){await db.query('ROLLBACK');return res.status(200).json({ok:true,action:'already_resolved'})}
  if(!['needs_decision','conflict'].includes(truth)){await db.query('ROLLBACK');return res.status(409).json({error:'This review item is no longer waiting for a decision.',code:'REVIEW_NOT_PENDING'})}
  if(action==='delete'||action==='dismiss'){
   await db.query(`UPDATE people SET status='archived',living_truth=jsonb_set(COALESCE(living_truth,'{}'::jsonb),'{status}','\"archived\"'::jsonb),metadata=metadata||jsonb_build_object('review_action',$2,'reviewed_by',$3::text,'reviewed_at',NOW()),updated_at=NOW() WHERE id=$1 AND organization_id=$4`,[id,action==='dismiss'?'dismissed':'deleted',req.user.id,req.org.id]);
   await db.query('COMMIT');return res.status(200).json({ok:true,status:'archived',action})
  }
  const allowed=candidateIds(pending),selected=candidateId?String(candidateId):null;
  if(selected&&!allowed.includes(selected)){await db.query('ROLLBACK');return res.status(403).json({error:'That person is not one of ARIA’s proposed matches.',code:'INVALID_CANDIDATE'})}
  const candidates=allowed.length?(await db.query(`SELECT * FROM people WHERE id=ANY($1::uuid[]) AND organization_id=$2 AND status='active' FOR UPDATE`,[allowed,req.org.id])).rows:[];
  if(truth==='conflict'&&!selected){await db.query('ROLLBACK');return res.status(409).json({error:'Choose an existing person, or keep this record as a new person.',code:'CHOOSE_MATCH',candidates:candidates.map(x=>({id:x.id,name:x.display_name,phone:x.phone,phone_numbers:x.phone_numbers||[]}))})}
  const target=candidates.find(x=>x.id===selected)||null;
  const originalName=pending.metadata?.raw_name||pending.display_name||'';
  let finalId,finalName,finalPhones;
  if(target){
   if(action==='approve'){
    finalId=target.id;finalName=target.display_name||[target.first_name,target.last_name].filter(Boolean).join(' ');finalPhones=[...new Set([...phonesFrom(target),...phonesFrom(pending)])].slice(0,2);
   }else{
    const chosen=cleanName(name);if(!chosen)return res.status(400).json({error:'A name is required.',code:'NAME_REQUIRED'});const parts=splitName(chosen);finalId=target.id;finalName=parts.display;finalPhones=phoneList({phone,phones},target);if(!finalPhones.length)finalPhones=phonesFrom(target);
   }
   const collision=await phoneCollision(db,req.org.id,finalId,finalPhones);if(collision){await db.query('ROLLBACK');return res.status(409).json({error:'That full phone number already belongs to another active person.',code:'DUPLICATE_ACTIVE_PERSON',person:collision})}
   const parts=splitName(finalName),phoneJson=JSON.stringify(finalPhones.map((p,i)=>({raw:p,normalized:p,source:'human_review',index:i+1})));
   await db.query(`UPDATE people SET first_name=$2,last_name=$3,display_name=$4,phone=$5,phone_numbers=$6,updated_at=NOW() WHERE id=$1 AND organization_id=$7`,[finalId,parts.first_name,parts.last_name,finalName,finalPhones[0]||null,phoneJson,req.org.id]);
  }else{
   const chosen=cleanName(name)||pending.display_name||pending.first_name||'';if(!chosen){await db.query('ROLLBACK');return res.status(400).json({error:'A name is required.',code:'NAME_REQUIRED'})}const parts=splitName(chosen),final=phoneList({phone,phones},pending),collision=await phoneCollision(db,req.org.id,pending.id,final);if(collision){await db.query('ROLLBACK');return res.status(409).json({error:'That full phone number already belongs to another active person.',code:'DUPLICATE_ACTIVE_PERSON',person:collision})}finalId=pending.id;finalName=parts.display;finalPhones=final;const phoneJson=JSON.stringify(final.map((p,i)=>({raw:p,normalized:p,source:'human_review',index:i+1}))),truthJson=JSON.stringify({...pending.living_truth,status:'alive',source:'human_review',confirmed_at:new Date().toISOString(),confirmed_by:req.user.id});await db.query(`UPDATE people SET first_name=$2,last_name=$3,display_name=$4,phone=$5,phone_numbers=$6,living_truth=$7,quarantine_reason=NULL,metadata=metadata||jsonb_build_object('review_action',$8,'reviewed_by',$9::text,'reviewed_at',NOW()),updated_at=NOW() WHERE id=$1 AND organization_id=$10`,[finalId,parts.first_name,parts.last_name,parts.display,final[0]||null,phoneJson,truthJson,action==='edit'?'edited':'approved',req.user.id,req.org.id]);
  }
  const canonical=finalName,observed=originalName&&normalizeName(originalName)!==normalizeName(canonical)?originalName:null;
  if(observed)await rememberAlias(db,{orgId:req.org.id,personId:finalId,alias:observed,actorId:req.user.id,reviewId:id,scanJobId:pending.last_scan_job_id,canonicalName:canonical,phones:finalPhones});
  if(target){await db.query(`UPDATE people SET metadata=metadata||jsonb_build_object('last_identity_review',jsonb_build_object('review_id',$2,'action',$3,'observed_name',$4,'scan_job_id',$5::text)),updated_at=NOW() WHERE id=$1`,[target.id,id,action==='edit'?'edited':'approved',originalName,pending.last_scan_job_id]);await db.query(`UPDATE people SET status='archived',living_truth=jsonb_set(COALESCE(living_truth,'{}'::jsonb),'{status}','\"archived\"'::jsonb),metadata=metadata||jsonb_build_object('review_action','resolved_to_existing','resolved_person_id',$2::text,'reviewed_by',$3::text,'reviewed_at',NOW()),updated_at=NOW() WHERE id=$1 AND organization_id=$4`,[pending.id,target.id,req.user.id,req.org.id])}
  await db.query(`INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source) VALUES($1,'identity_review','Identity confirmed', $2, $3, 'human_review')`,[finalId,`A scanned record was reviewed and confirmed as ${canonical}.`,{review_id:id,action,candidate_id:target?.id||null,scan_job_id:pending.last_scan_job_id,observed_name:originalName,phones:finalPhones}]);
  const event=await emitAriaEvent({organizationId:req.org.id,personId:finalId,type:'PERSON_UPDATED',source:'human_review',actorId:req.user.id,metadata:{review_action:target?'resolved_to_existing':action,review_id:id,candidate_id:target?.id||null},eventKey:`review:${id}:${finalId}:resolved`},db);await db.query('COMMIT');if(event)processAriaEvent(event).catch(()=>{});return res.status(200).json({ok:true,status:'active',action:target?'resolved_to_existing':action,person_id:finalId})
 }catch(err){try{await db.query('ROLLBACK')}catch{}console.error('[REVIEW] Resolve error:',err);return res.status(err.statusCode||500).json({error:err.statusCode===409?err.message:'Review action could not be completed.',code:err.code})}finally{db.release()}}
export default withOrg(handler);
