// pages/api/identity/resolve.js
import pool from'../../../lib/db';
import{withAdmin}from'../../../lib/apiHelpers';
import{normalizeName}from'../../../lib/scanValidation';import normalizePhone from'../../../lib/phoneUtils';

async function handler(req,res){
if(req.method!=='POST'){
res.setHeader('Allow','POST');
return res.status(405).json({error:'Method not allowed'});
}
const{scan_job_id,person_id,extracted_name,action,target_person_id,new_name,new_phone}=req.body||{};
if(!action)return res.status(400).json({error:'action is required'});
const orgId=req.org.id;
try{
let scanJob=null,item=null,result=null,needsReview=[],itemIndex=-1;
if(scan_job_id){
const jobRes=await pool.query(`SELECT result FROM scan_jobs WHERE id=$1 AND organization_id=$2 LIMIT 1`,[scan_job_id,orgId]);
if(!jobRes.rows.length)return res.status(404).json({error:'Scan job not found'});
scanJob=jobRes.rows[0];
result=scanJob.result||{};
needsReview=Array.isArray(result.needs_review)?result.needs_review:[];
itemIndex=needsReview.findIndex(item=>(person_id&&item.person_id===person_id)||(extracted_name&&item.extracted_name===extracted_name));
if(itemIndex<0&&extracted_name)itemIndex=needsReview.findIndex(item=>item.extracted_name===extracted_name);
if(itemIndex<0)return res.status(404).json({error:'Review item not found'});
item=needsReview[itemIndex];
if(item.resolved)return res.status(400).json({error:'Already resolved'});
}
const sourceName=String(extracted_name||item?.extracted_name||'').trim();
let resolvedPersonId=null;
if(action==='confirm'){
const targetId=target_person_id||person_id;
if(!targetId)return res.status(400).json({error:'target_person_id or person_id is required'});
const person=(await pool.query(`SELECT id,first_name,last_name,display_name FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1`,[targetId,orgId])).rows[0];
if(!person)return res.status(404).json({error:'Person not found'});
resolvedPersonId=person.id;
if(sourceName){
const existingName=person.display_name||[person.first_name,person.last_name].filter(Boolean).join(' ');
if(normalizeName(existingName)!==normalizeName(sourceName)){
const alias=await pool.query(`SELECT id FROM person_aliases WHERE organization_id=$1 AND person_id=$2 AND LOWER(alias)=LOWER($3) LIMIT 1`,[orgId,person.id,sourceName]);
if(!alias.rows.length)await pool.query(`INSERT INTO person_aliases(organization_id,person_id,alias,created_by) VALUES($1,$2,$3,$4)`,[orgId,person.id,sourceName,req.user.id]);
}
}
const current=(await pool.query(`SELECT living_truth FROM people WHERE id=$1 AND organization_id=$2`,[person.id,orgId])).rows[0]?.living_truth||{};
await pool.query(`UPDATE people SET living_truth=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3`,[JSON.stringify({...current,status:'alive',confidence:item?.confidence||current.confidence||90,source:'human_confirmed',confirmed_at:new Date().toISOString(),confirmed_by:req.user.id}),person.id,orgId]);
}else if(action==='keep_new'||action==='edit'){
if(person_id){
const person=(await pool.query(`SELECT id,living_truth FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1`,[person_id,orgId])).rows[0];
if(!person)return res.status(404).json({error:'Person not found'});
resolvedPersonId=person.id;
await pool.query(`UPDATE people SET living_truth=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3`,[JSON.stringify({...(person.living_truth||{}),status:'alive',confidence:item?.confidence||70,source:'human_confirmed_new',confirmed_at:new Date().toISOString(),confirmed_by:req.user.id}),person.id,orgId]);
}else{
const name=String(new_name||sourceName).trim();
const rawPhone=String(new_phone||item?.extracted_phone||'').trim(),phone=rawPhone?normalizePhone(rawPhone):null;
if(!name)return res.status(400).json({error:'A name is required'});
if(rawPhone&&!phone)return res.status(400).json({error:'The phone number is invalid. Correct it before saving or remove it from the review.'});
const phoneNumbers=JSON.stringify(phone?[{raw:phone,normalized:phone,source:'human_resolved_scan',index:1}]:[]);
const insert=await pool.query(`INSERT INTO people(organization_id,first_name,phone,phone_numbers,type,status,confidence,source,created_by,living_truth) VALUES($1,$2,$3,$4,'visitor','active',$5,'scan',$6,$7) RETURNING id`,[orgId,name,phone,phoneNumbers,item?.confidence||70,req.user.id,JSON.stringify({status:'alive',confidence:item?.confidence||70,source:'human_resolved_scan',confirmed_at:new Date().toISOString(),confirmed_by:req.user.id})]);
resolvedPersonId=insert.rows[0].id;
}
}else return res.status(400).json({error:`Unsupported action: ${action}`});
if(scanJob&&itemIndex>=0){
needsReview[itemIndex]={...item,resolved:true,resolved_person_id:resolvedPersonId,resolution_action:action,resolved_at:new Date().toISOString(),resolved_by:req.user.id};
result.needs_review=needsReview;
await pool.query(`UPDATE scan_jobs SET result=$1 WHERE id=$2 AND organization_id=$3`,[result,scan_job_id,orgId]);
}
return res.status(200).json({success:true,resolved_person_id:resolvedPersonId});
}catch(err){
console.error('Identity resolution error:',err);
return res.status(500).json({error:'Unable to resolve identity.'});
}
}
export default withAdmin(handler);
