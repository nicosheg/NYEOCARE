// pages/api/review/resolve.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';
import normalizePhone from'../../../lib/phoneUtils';
import{normalizeDisplayName}from'../../../lib/scanValidation';
import{emitAriaEvent}from'../../../lib/aria/eventEmitter';
import{processAriaEvent}from'../../../lib/aria/eventProcessor';
function cleanName(v){return String(v||'').replace(/\s+/g,' ').trim().slice(0,160)}
function splitName(value){const n=normalizeDisplayName(value),parts=n.core.split(/\s+/).filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' '),display:n.display}}
function phoneList(body,person){const raw=Array.isArray(body?.phones)?body.phones:(body?.phone?[body.phone]:[]);if(raw.length)return raw.map(x=>normalizePhone(x)).filter(Boolean).slice(0,2);if(Array.isArray(person.phone_numbers))return person.phone_numbers.map(x=>typeof x==='string'?x:x?.normalized||x?.raw).filter(Boolean).slice(0,2);return person.phone?[person.phone]:[]}
async function handler(req,res){
if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
const{id,action,name,phone,phones}=req.body||{};
if(!id||!['approve','edit','delete','dismiss'].includes(action))return res.status(400).json({error:'Invalid review action.'});
const client=await pool.connect();
try{
await client.query('BEGIN');
const found=await client.query(`SELECT * FROM people WHERE id=$1 AND organization_id=$2 AND status='active' FOR UPDATE`,[id,req.org.id]);
if(!found.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Review item not found.'})}
const person=found.rows[0],truthStatus=person.living_truth?.status;
if(!['needs_decision','conflict'].includes(truthStatus)){await client.query('ROLLBACK');return res.status(200).json({ok:true,status:'active',action:'already_resolved'})}
if(action==='delete'||action==='dismiss'){
await client.query(`UPDATE people SET status='archived',living_truth=jsonb_set(COALESCE(living_truth,'{}'::jsonb),'{status}','\"archived\"'::jsonb),metadata=metadata||jsonb_build_object('review_action','deleted','reviewed_by',$2::text,'reviewed_at',NOW()),updated_at=NOW() WHERE id=$1 AND organization_id=$3`,[id,req.user.id,req.org.id]);
await client.query('COMMIT');return res.status(200).json({ok:true,status:'archived'})}
const display=cleanName(name)||person.display_name||[person.first_name,person.last_name].filter(Boolean).join(' ');if(!display){await client.query('ROLLBACK');return res.status(400).json({error:'A name is required.'})}
const parts=splitName(display),list=phoneList({phone,phones},person),normalizedPhone=list[0]||null,phoneNumbers=list.map((normalized,index)=>({raw:normalized,normalized,source:'review',index:index+1}));
if(normalizedPhone){const duplicate=await client.query(`SELECT id,display_name FROM people WHERE organization_id=$1 AND status='active' AND id<>$2 AND phone=$3 LIMIT 1`,[req.org.id,id,normalizedPhone]);if(duplicate.rows.length){await client.query('ROLLBACK');return res.status(409).json({error:'That phone number already belongs to another active person.',code:'DUPLICATE_ACTIVE_PERSON',person:duplicate.rows[0]})}}
const actionName=action==='edit'?'edited':'approved',truth={...(person.living_truth||{}),status:'alive',source:'human_review',confirmed_at:new Date().toISOString(),confirmed_by:req.user.id},metadata={...(person.metadata||{}),review_action:actionName,reviewed_by:req.user.id,reviewed_at:new Date().toISOString()};
await client.query(`UPDATE people SET first_name=$2,last_name=$3,display_name=$4,phone=$5,phone_numbers=$6,living_truth=$7,quarantine_reason=NULL,metadata=$8,updated_at=NOW() WHERE id=$1 AND organization_id=$9`,[id,parts.first_name,parts.last_name,parts.display,normalizedPhone,JSON.stringify(phoneNumbers),JSON.stringify(truth),JSON.stringify(metadata),req.org.id]);
await client.query('COMMIT');
try{const event=await emitAriaEvent({organizationId:req.org.id,personId:id,type:'PERSON_UPDATED',source:'human',actorId:req.user.id,metadata:{review_action:actionName,review_id:id},eventKey:`review:${id}:${actionName}:${Date.now()}`});if(event)processAriaEvent(event).catch(()=>{})}catch(e){console.error('[REVIEW EVENT]',e)}
return res.status(200).json({ok:true,status:'active',action:actionName});
}catch(err){try{await client.query('ROLLBACK')}catch{}console.error('[REVIEW] Resolve error:',err);return res.status(500).json({error:'Review action could not be completed.'})}finally{client.release()}}
export default handler;
