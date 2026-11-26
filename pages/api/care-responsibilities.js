// pages/api/care-responsibilities.js
import crypto from'node:crypto';
import pool from'../../lib/db';
import{withAdmin}from'../../lib/apiHelpers';
import{planActionFromObservation}from'../../lib/aria/recommendationEngine';
import{emitAriaEvent}from'../../lib/aria/eventEmitter';
import{getDailyQueue}from'../../lib/dailyQueue';

const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operatorRoles=['owner','admin','leader','worker','user'];

export default withAdmin(async function handler(req,res){
 if(req.method!=='POST'){
  res.setHeader('Allow','POST');
  return res.status(405).json({error:'Method not allowed'});
 }
 const personId=clean(req.body?.person_id);
 const assigneeId=clean(req.body?.assigned_user_id);
 const title=clean(req.body?.title).slice(0,100);
 const description=clean(req.body?.description).slice(0,600);
 const dueDate=clean(req.body?.due_date);
 const priority=['low','medium','high'].includes(String(req.body?.priority||'').toLowerCase())?String(req.body.priority).toLowerCase():'medium';
 const suppliedKey=clean(req.body?.idempotency_key);
 const idempotencyKey=uuidPattern.test(suppliedKey)?suppliedKey:crypto.randomUUID();
 if(!uuidPattern.test(personId)||!uuidPattern.test(assigneeId)||!title||!datePattern.test(dueDate)){
  return res.status(400).json({error:'Person, task, owner and due date are required.'});
 }
 const dueMs=Date.parse(dueDate+'T00:00:00Z');
 if(!Number.isFinite(dueMs)||new Date(dueMs).toISOString().slice(0,10)!==dueDate){
  return res.status(400).json({error:'Choose a valid due date.'});
 }

 const orgId=req.org.id,client=await pool.connect();
 let action=null;
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('nyeocare:manual-care:'||$1,0))",[orgId]);
  const person=(await client.query(
   "SELECT id,display_name,first_name,last_name FROM people WHERE id=$1::uuid AND organization_id=$2 AND status='active' LIMIT 1 FOR SHARE",
   [personId,orgId]
  )).rows[0];
  if(!person){
   await client.query('ROLLBACK');
   return res.status(404).json({error:'Active person not found.'});
  }
  const assignee=(await client.query(
   "SELECT id,name,role FROM users WHERE id=$1::uuid AND organization_id=$2 AND active=true AND role=ANY($3::text[]) LIMIT 1",
   [assigneeId,orgId,operatorRoles]
  )).rows[0];
  if(!assignee){
   await client.query('ROLLBACK');
   return res.status(400).json({error:'Choose an active operator in this organization.'});
  }
  const organization=(await client.query("SELECT COALESCE(settings->>'timezone','Africa/Lagos') time_zone FROM organizations WHERE id=$1 LIMIT 1",[orgId])).rows[0];
  const timeZone=organization?.time_zone||'Africa/Lagos';
  const today=new Intl.DateTimeFormat('en-CA',{timeZone}).format(new Date());
  if(dueDate<today){
   await client.query('ROLLBACK');
   return res.status(400).json({error:'Due date cannot be in the past.'});
  }
  const latestDate=new Date(Date.parse(today+'T12:00:00Z')+30*86400000).toISOString().slice(0,10);
  if(dueDate>latestDate){
   await client.query('ROLLBACK');
   return res.status(400).json({error:'Choose a due date within the next 30 days.'});
  }
  const message=description;
  const actionKey='human-care:'+idempotencyKey;
  action=await planActionFromObservation({
   organizationId:orgId,
   personId:person.id,
   actionType:'CARE_FOLLOW_UP',
   priority,
   actionKey,
   actionMetadata:{
    kind:'manual_care_responsibility',
    title,
    summary:description||null,
    message,
    reason:'A leader recorded a real care need.',
    knowledge:'This responsibility was created by a human, not inferred from attendance.',
    suggestion:'Complete the agreed next step and record what actually happened.',
    assigned_user_id:assignee.id,
    due_date:dueDate,
    responsibility_created_by:req.user.id,
    responsibility_created_by_role:req.user.role,
    requires_human_approval:true,
    source:'human_care_plan'
   }
  },client);
  if(!action){
   action=(await client.query('SELECT * FROM aria_actions WHERE organization_id=$1 AND action_key=$2 LIMIT 1 FOR UPDATE',[orgId,actionKey])).rows[0]||null;
  }
  if(!action)throw new Error('The care responsibility could not be created.');
  await emitAriaEvent({
   organizationId:orgId,
   personId:person.id,
   type:'CARE_CONTEXT_RECORDED',
   actorId:req.user.id,
   actorRole:req.user.role,
   source:'human_care_plan',
   evidenceKind:'human_report',
   verificationStatus:'verified',
   confidence:1,
   eventKey:'human-care-responsibility:'+action.id,
   metadata:{
    action_id:action.id,
    title,
    description:message,
    assigned_user_id:assignee.id,
    due_date:dueDate,
    created_by:req.user.id,
    source:'human_care_plan'
   }
  },client);
  await client.query('COMMIT');
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error('[CARE RESPONSIBILITY] create failed:',error?.message||error);
  return res.status(500).json({error:'Could not create this care responsibility.'});
 }finally{
  client.release();
 }
 try{
  await getDailyQueue(orgId,req.user.id);
  const queueRow=(await pool.query(
   "SELECT id::text queue_item_id,assigned_user_id::text assigned_user_id,queue_date::text due_date FROM aria_daily_queue_items WHERE organization_id=$1 AND task_kind='follow_up' AND source_id=$2 LIMIT 1",
   [orgId,String(action.id)]
  )).rows[0]||null;
  return res.status(201).json({
   success:true,
   action_id:String(action.id),
   queue_item_id:queueRow?.queue_item_id||null,
   due_date:queueRow?.due_date||dueDate,
   assigned_user_id:queueRow?.assigned_user_id||assigneeId
  });
 }catch(error){
  console.error('[CARE RESPONSIBILITY] queue materialization failed:',error?.message||error);
  return res.status(202).json({success:true,action_id:String(action.id),queue_item_id:null,queue_materialization_pending:true});
 }
});
