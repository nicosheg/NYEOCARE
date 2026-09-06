// pages/api/identity/review-action.js
import pool from'../../../lib/db';
import{withAdmin}from'../../../lib/apiHelpers';

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
const result=job.rows[0].result||{},list=Array.isArray(result.needs_review)?result.needs_review:[];
const index=Number(review_index);
if(!Number.isInteger(index)||index<0||index>=list.length){await client.query('ROLLBACK');return res.status(404).json({error:'Review item not found.'})}
const item=list[index];
if(item?.resolved){await client.query('ROLLBACK');return res.status(400).json({error:'This review has already been resolved.'})}

let personId=null;

if(action==='confirm'){
if(!target_person_id){await client.query('ROLLBACK');return res.status(400).json({error:'Choose the person this scan belongs to.'})}
const p=await client.query(`SELECT id,first_name,last_name FROM people WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1`,[target_person_id,orgId]);
if(!p.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Selected person was not found.'})}
personId=target_person_id;
const alias=String(item.extracted_name||'').trim();
if(alias){
await client.query(`INSERT INTO person_aliases(organization_id,person_id,alias,created_by) SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM person_aliases WHERE organization_id=$1 AND person_id=$2 AND lower(alias)=lower($3))`,[orgId,personId,alias,req.user.id]);
}
await client.query(`UPDATE people SET confidence=GREATEST(confidence,90),updated_at=NOW() WHERE id=$1 AND organization_id=$2`,[personId,orgId]);
}else{
const cleanName=String(new_name||item.extracted_name||'').trim();
if(!cleanName||cleanName.length>160){await client.query('ROLLBACK');return res.status(400).json({error:'A valid name is required.'})}
const p=await client.query(`INSERT INTO people(organization_id,first_name,phone,type,status,confidence,source,created_by,last_scan_job_id,living_truth) VALUES($1,$2,$3,'visitor','active',$4,'scan',$5,$6,$7) RETURNING id`,[orgId,cleanName,String(new_phone||item.extracted_phone||'').trim()||null,Number(item.confidence)||70,req.user.id,scan_job_id,JSON.stringify({status:'alive',source:'human_review',updated_at:new Date().toISOString()})]);
personId=p.rows[0].id;
}

list[index]={...item,resolved:true,resolved_person_id:personId,resolution_action:action,resolved_at:new Date().toISOString()};
result.needs_review=list;
await client.query(`UPDATE scan_jobs SET result=$1 WHERE id=$2 AND organization_id=$3`,[result,scan_job_id,orgId]);
await client.query('COMMIT');
return res.status(200).json({success:true,resolved:list[index]});
}catch(e){
try{await client.query('ROLLBACK')}catch{}
console.error('[REVIEW ACTION]',e);
return res.status(500).json({error:'Unable to resolve this identity review.'});
}finally{client.release()}
});
