// pages/api/person/context-actions.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';
import{isOrganizationOperator}from'../../../lib/attendance/access';

export default withOrg(async function handler(req,res){
if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
if(!isOrganizationOperator(req.user?.role))return res.status(403).json({error:'Person care context is limited to authorized organization operators.'});
const personId=String(req.query.person_id||'');
if(!personId)return res.status(400).json({error:'Missing person_id'});
const orgId=req.org.id;
try{
const person=await pool.query(`SELECT id,first_name,last_name,phone,birthday FROM people WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1`,[personId,orgId]);
if(!person.rows.length)return res.status(404).json({error:'Person not found'});
const p=person.rows[0],actions=[];
const restriction=await pool.query(`SELECT 1 FROM aria_care_contexts
 WHERE organization_id=$1 AND person_id=$2 AND kind='other'
   AND metadata->>'do_not_contact'='true'
   AND(ends_on IS NULL OR ends_on>=CURRENT_DATE)
 LIMIT 1`,[orgId,personId]);
const doNotContact=restriction.rows.length>0;

if(p.birthday){
const today=new Date(),b=new Date(p.birthday+'T00:00:00'),next=new Date(today.getFullYear(),b.getUTCMonth(),b.getUTCDate());
if(next<new Date(today.getFullYear(),today.getMonth(),today.getDate()))next.setFullYear(today.getFullYear()+1);
const days=Math.ceil((next-new Date(today.getFullYear(),today.getMonth(),today.getDate()))/86400000);
if(days<=7)actions.push({type:'birthday',label:'Remember this birthday',description:`${p.first_name||'This person'} has a birthday coming up.`});
}

const role=String(req.user?.role||'').toLowerCase();
if(!doNotContact&&['owner','admin','leader'].includes(role)){
 const prayer=await pool.query(`SELECT description FROM timeline_events WHERE people_id=$1 AND COALESCE(metadata->>'privacy_class','standard')='standard' AND event_type='prayer_request' ORDER BY occurred_at DESC LIMIT 1`,[personId]);
 if(prayer.rows.length)actions.push({type:'prayer',label:'Review prayer request',description:'A leader can review this request and decide whether a next step is appropriate.'});
}

return res.status(200).json({actions});
}catch(e){console.error('[PERSON ACTIONS]',e);return res.status(500).json({error:'Unable to load suggested actions.'})}
});
