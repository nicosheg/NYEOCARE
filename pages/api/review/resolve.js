// pages/api/review/resolve.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';
import normalizePhone from'../../../lib/phoneUtils';

function cleanName(v){return String(v||'').replace(/\s+/g,' ').trim().slice(0,120)}
function splitName(name){const parts=cleanName(name).split(' ').filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' ')}}
function phoneList(body,person){
 const raw=Array.isArray(body?.phones)?body.phones:(body?.phone?[body.phone]:[]);
 if(!raw.length&&Array.isArray(person.phone_numbers))return person.phone_numbers.map(x=>typeof x==='string'?x:x?.normalized||x?.raw).filter(Boolean).slice(0,2);
 if(!raw.length&&person.phone)return[person.phone];
 return raw.map(x=>normalizePhone(x)).filter(Boolean).slice(0,2);
}
async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const{id,action,name,phone,phones}=req.body||{};
 if(!id||!['approve','edit','delete','dismiss'].includes(action))return res.status(400).json({error:'Invalid review action.'});
 const client=await pool.connect();
 try{
  const found=await client.query(`SELECT * FROM people WHERE id=$1 AND organization_id=$2 AND status='quarantined' LIMIT 1`,[id,req.org.id]);
  if(!found.rows.length)return res.status(404).json({error:'Review item not found.'});
  const person=found.rows[0];
  if(action==='delete'||action==='dismiss'){
   await client.query(`UPDATE people SET status='archived',quarantine_reason=NULL,quarantined_at=NULL,updated_at=NOW(),metadata=metadata||jsonb_build_object('review_action','deleted','reviewed_by',$2::text,'reviewed_at',NOW()) WHERE id=$1`,[id,req.user.id]);
   return res.status(200).json({ok:true,status:'archived'});
  }
  const display=cleanName(name)||person.display_name||[person.first_name,person.last_name].filter(Boolean).join(' ');
  const parts=splitName(display),list=phoneList({phone,phones},person),normalizedPhone=list[0]||null,phoneNumbers=list.map((normalized,index)=>({raw:normalized,normalized,source:'review',index:index+1}));
  if(normalizedPhone){
   const duplicate=await client.query(`SELECT id,display_name FROM people WHERE organization_id=$1 AND status='active' AND id<>$2 AND phone=$3 LIMIT 1`,[req.org.id,id,normalizedPhone]);
   if(duplicate.rows.length)return res.status(409).json({error:'That phone number already belongs to an active person.',code:'DUPLICATE_ACTIVE_PERSON',person:duplicate.rows[0]});
  }
  const reviewAction=action==='edit'?'edited':'approved';
  await client.query(`UPDATE people SET first_name=$2,last_name=$3,display_name=$4,phone=$5,phone_numbers=$6,status='active',quarantine_reason=NULL,quarantined_at=NULL,updated_at=NOW(),metadata=metadata||jsonb_build_object('review_action',$7::text,'reviewed_by',$8::text,'reviewed_at',NOW()) WHERE id=$1`,[id,parts.first_name,parts.last_name,display,normalizedPhone,JSON.stringify(phoneNumbers),reviewAction,req.user.id]);
  return res.status(200).json({ok:true,status:'active',action:reviewAction});
 }catch(err){
  console.error('[REVIEW] Resolve error:',err);
  return res.status(500).json({error:'Review action could not be completed.'});
 }finally{client.release()}
}
export default withOrg(handler);
