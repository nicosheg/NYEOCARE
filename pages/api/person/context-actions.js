// pages/api/person/context-actions.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

export default withOrg(async function handler(req,res){
if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
const personId=String(req.query.person_id||'');
if(!personId)return res.status(400).json({error:'Missing person_id'});
const orgId=req.org.id;
try{
const person=await pool.query(`SELECT id,first_name,last_name,phone,birthday FROM people WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1`,[personId,orgId]);
if(!person.rows.length)return res.status(404).json({error:'Person not found'});
const p=person.rows[0],actions=[];
const last=await pool.query(`SELECT MAX(occurred_at) AS last FROM person_communications WHERE person_id=$1 AND organization_id=$2`,[personId,orgId]);
if(!last.rows[0]?.last||(Date.now()-new Date(last.rows[0].last).getTime())>7*86400000)actions.push({type:'draft',label:'Send a check-in message',description:`${p.first_name||'This person'} has not been contacted recently.`});

const attended=await pool.query(`SELECT COUNT(*)::int AS attended FROM attendance_records WHERE people_id=$1 AND organization_id=$2 AND present=true AND confirmed=true AND attendance_date>=CURRENT_DATE-INTERVAL '30 days'`,[personId,orgId]);
if(Number(attended.rows[0]?.attended||0)===0)actions.push({type:'followup',label:'Check in with this person',description:`${p.first_name||'This person'} has no confirmed attendance in the last 30 days.`});

if(p.birthday){
const today=new Date(),b=new Date(p.birthday+'T00:00:00'),next=new Date(today.getFullYear(),b.getUTCMonth(),b.getUTCDate());
if(next<new Date(today.getFullYear(),today.getMonth(),today.getDate()))next.setFullYear(today.getFullYear()+1);
const days=Math.ceil((next-new Date(today.getFullYear(),today.getMonth(),today.getDate()))/86400000);
if(days<=7)actions.push({type:'birthday',label:'Send a birthday greeting',description:`${p.first_name||'This person'} has a birthday coming up.`});
}

const prayer=await pool.query(`SELECT description FROM timeline_events WHERE people_id=$1 AND event_type='prayer_request' ORDER BY occurred_at DESC LIMIT 1`,[personId]);
if(prayer.rows.length)actions.push({type:'prayer',label:'Follow up on prayer request',description:`${p.first_name||'This person'} has a recent prayer request.`});

return res.status(200).json({actions});
}catch(e){console.error('[PERSON ACTIONS]',e);return res.status(500).json({error:'Unable to load suggested actions.'})}
});
