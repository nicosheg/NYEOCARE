// pages/api/timeline.js
import pool from '../../lib/db';
import { withOrg } from '../../lib/apiHelpers';
import { isOrganizationOperator } from '../../lib/attendance/access';

async function handler(req,res){
 const orgId=req.org.id;
 if(!['GET','POST'].includes(req.method)){
  res.setHeader('Allow','GET,POST');
  return res.status(405).json({error:'Method not allowed'});
 }
 if(!isOrganizationOperator(req.user?.role))return res.status(403).json({error:'Person timeline is limited to authorized organization operators.'});

 if(req.method==='GET'){
  const personId=String(req.query.person_id||'');
  if(!personId)return res.status(400).json({error:'person_id is required'});
  try{
   const person=await pool.query(`SELECT id FROM people WHERE id=$1 AND organization_id=$2 LIMIT 1`,[personId,orgId]);
   if(!person.rows.length)return res.status(404).json({error:'Person not found'});
   const{rows}=await pool.query(`SELECT t.* FROM timeline_events t JOIN people p ON p.id=t.people_id AND p.organization_id=$2 WHERE t.people_id=$1 ORDER BY COALESCE(t.occurred_at,t.created_at) DESC,t.created_at DESC`,[personId,orgId]);
   return res.status(200).json(rows);
  }catch(err){
   console.error('GET timeline error:',err);
   return res.status(500).json({error:'Unable to load timeline'});
  }
 }

 if(req.method==='POST'){
  const{person_id,event_type,title,description,metadata,source,occurred_at}=req.body||{};
  if(!person_id||!event_type)return res.status(400).json({error:'person_id and event_type are required'});
  try{
   const person=await pool.query(`SELECT id FROM people WHERE id=$1 AND organization_id=$2 LIMIT 1`,[person_id,orgId]);
   if(!person.rows.length)return res.status(404).json({error:'Person not found'});
   const result=await pool.query(`INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source,occurred_at,created_at) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,NOW()),NOW()) RETURNING *`,[person_id,event_type,title||event_type,description||'',metadata&&typeof metadata==='object'?metadata:{},source||'human',occurred_at||null]);
   return res.status(201).json(result.rows[0]);
  }catch(err){
   console.error('POST timeline error:',err);
   return res.status(500).json({error:'Unable to create timeline event'});
  }
 }

 res.setHeader('Allow','GET,POST');
 return res.status(405).json({error:'Method not allowed'});
}

export default withOrg(handler);
