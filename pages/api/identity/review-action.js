// pages/api/identity/review-action.js
import pool from'../../../lib/db';
import{withAdmin}from'../../../lib/apiHelpers';
import normalizePhone from'../../../lib/phoneUtils';
import{normalizeName}from'../../../lib/scanValidation';
function splitName(value){const parts=String(value||'').trim().split(/\s+/).filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' ')}}
export default withAdmin(async function handler(req,res){
if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
const{scan_job_id,review_index,action,target_person_id,new_name,new_phone}=req.body||{};
if(!scan_job_id||review_index===undefined||!action)return res.status(400).json({error:'scan_job_id, review_index and action are required.'});
if(!['confirm','keep_new'].includes(action))return res.status(400).json({error:'Invalid review action.'});
const orgId=req.org.id,client=await pool.connect();
try{
await client.query('BEGIN');
const job=await client.query(`SELECT id,result FROM scan_jobs WHERE id=$1 AND organization_id=$2 AND status='complete' FOR UPDATE`,[scan_job_id,orgId]);
if(!job.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Scan review not found.'})}
const result=job.rows[0].result||{},list=Array.isArray(result.needs_review)?result.needs_review:[],index=Number(review_index);
if(!Number.isInteger(index)||index<0||index>=list.length){await client.query('ROLLBACK');return res.status(404).json({error:'Review item not found.'})}
const item=list[index];
if(item?.resolved){await client.query('ROLLBACK');return res.status(200).json({success:true,resolved:item,idempotent:true})}
let personId=null;
if(action==='confirm'){
if(!target_person_id){await client.query('ROLLBACK');return res.status(400).json({error:'Choose the person this scan belongs to.'})}
const p=await client.query(`SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1`,[target_person_id,orgId]);
if(!p.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Selected person was not found.'})}
personId=target_person_id;
const alias=String(item.extracted_name||item.incoming?.name||item.name||'').trim();
if(alias)await client.query(`INSERT INTO person_aliases(organization_id,person_id,alias,created_by) SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM person_aliases WHERE organization_id=$1 AND person_id=$2 AND lower(alias)=lower($3))`,[orgId,personId,alias,req.user.id]);
await client.query(`UPDATE people SET confidence=GREATEST(COALESCE(confidence,0),90),updated_at=NOW() WHERE id=$1 AND organization_id=$2`,[personId,orgId]);
}else{
const cleanName=String(new_name||'').trim();
if(!cleanName||cleanName.length>160){await client.query('ROLLBACK');return res.status(400).json({error:'Enter the correct name before saving.'})}
const parts=splitName(cleanName),normalizedPhone=new_phone?normalizePhone(String(new_phone).trim()):null,nameKey=normalizeName(cleanName);
let existing=null;
if(normalizedPhone){const p=await client.query(`SELECT id FROM people WHERE organization_id=$1 AND status='active' AND phone=$2 ORDER BY created_at ASC LIMIT 1`,[orgId,normalizedPhone]);existing=p.rows[0]||null}
if(!existing&&nameKey){const p=await client.query(`SELECT id FROM people WHERE organization_id=$1 AND status='active' AND lower(regexp_replace(trim(display_name),'\\s+','','g'))=lower(regexp_replace(trim($2),'\\s+','','g')) ORDER BY created_at ASC LIMIT 1`,[orgId,cleanName]);existing=p.rows[0]||null}
if(existing){personId=existing.id;await client.query(`UPDATE people SET confidence=GREATEST(COALESCE(confidence,0),90),updated_at=NOW() WHERE id=$1 AND organization_id=$2`,[personId,orgId])}
else{
const p=await client.query(`INSERT INTO people(organization_id,first_name,last_name,display_name,phone,phone_numbers,type,status,confidence,source,created_by,last_scan_job_id,living_truth,metadata) VALUES($1,$2,$3,$4,$5,$6,'visitor','active',90,'scan',$7,$8,$9,$10) RETURNING id`,[orgId,parts.first_name,parts.last_name,cleanName,normalizedPhone,JSON.stringify(normalizedPhone?[{raw:new_phone,normalized:normalizedPhone,source:'human_review',index:1}]:[]),req.user.id,scan_job_id,JSON.stringify({status:'alive',confidence:90,source:'human_review',updated_at:new Date().toISOString()}),JSON.stringify({resolved_from_scan_review:true,scan_job_id})]);personId=p.rows[0].id}
}
list[index]={...item,resolved:true,resolved_person_id:personId,resolution_action:action,resolved_at:new Date().toISOString()};result.needs_review=list;
await client.query(`UPDATE scan_jobs SET result=$1 WHERE id=$2 AND organization_id=$3`,[result,scan_job_id,orgId]);await client.query('COMMIT');
return res.status(200).json({success:true,resolved:list[index]});
}catch(e){try{await client.query('ROLLBACK')}catch{}console.error('[REVIEW ACTION]',e);return res.status(500).json({error:'Unable to resolve this identity review.'})}finally{client.release()}
});