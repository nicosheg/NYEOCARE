// pages/api/people.js
import pool from'../../lib/db';
import{normalizePhone}from'../../lib/phoneUtils';
import{normalizeDisplayName}from'../../lib/scanValidation';
import{withOrg}from'../../lib/apiHelpers';
import{updatePersonRecord}from'../../lib/aria/peopleMutationEngine';
import{emitAriaEvent}from'../../lib/aria/eventEmitter';
import{directAriaEvent}from'../../lib/aria/director';
import{hashPersonCreatePayload,isValidPersonCreateRequestId}from'../../lib/peopleCreateIdempotency';
const splitName=value=>{const n=normalizeDisplayName(value),parts=n.core.split(/\s+/).filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' '),display_name:n.display}}
async function duplicatePhone(orgId,phone,excludeId=null,db=pool){if(!phone)return null;const q=await db.query(`SELECT id,display_name,phone FROM people WHERE organization_id=$1 AND status='active' AND living_truth->>'status' NOT IN ('needs_decision','conflict') AND id<>COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000') AND (phone=$3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(phone_numbers,'[]'::jsonb)) v WHERE v->>'normalized'=$3)) LIMIT 1`,[orgId,excludeId,phone]);return q.rows[0]||null}
async function handler(req,res){const orgId=req.org.id;const role=String(req.user?.role||'').trim().toLowerCase();const adminRoles=['owner','admin'];const personCreatorRoles=['owner','admin','leader','worker'];if(req.method==='GET'&&!personCreatorRoles.includes(role))return res.status(403).json({error:'People records and private contact details are limited to authorized organization operators.'});if(req.method==='POST'&&!personCreatorRoles.includes(role))return res.status(403).json({error:'You do not have permission to add people to this organization.'});if(req.method==='PUT'&&!adminRoles.includes(role))return res.status(403).json({error:'Admin permissions required'});
if(req.method==='GET'){
 try{
  const limit=Math.min(Math.max(Number.parseInt(req.query?.limit,10)||50,1),80);
  const search=String(req.query?.search||'').trim().slice(0,80);
  const type=String(req.query?.type||'').trim().toLowerCase();
  const living=String(req.query?.living_truth||'').trim();
  const includeTotal=!req.query?.cursor;
  const rawCursor=String(req.query?.cursor||'').trim();
  let cursor=null;
  if(rawCursor){
   try{
    cursor=JSON.parse(Buffer.from(rawCursor,'base64url').toString('utf8'));
    if(!Number.isInteger(cursor.new_rank)||!Number.isInteger(cursor.truth_rank)||typeof cursor.sort_name!=='string'||typeof cursor.id!=='string')throw new Error('bad cursor');
   }catch{ return res.status(400).json({error:'Invalid people cursor.',code:'INVALID_CURSOR'}); }
  }
  const includeInactive=String(req.query?.include_inactive||'')==='1';
  const requestedPersonStatus=String(req.query?.person_status||'').trim().toLowerCase();
  const where=["p.organization_id=$1::text",includeInactive?"p.status IN ('active','inactive')":"p.status='active'"];
  const values=[orgId];
  let n=2;
  if(includeInactive&&['active','inactive'].includes(requestedPersonStatus)){where.push(`p.status=$${n++}::text`);values.push(requestedPersonStatus)}
  if(type&&['member','visitor'].includes(type)){where.push(`p.type=$${n++}::text`);values.push(type)}
  if(living==='1')where.push(`COALESCE(p.living_truth->>'status','alive') IN ('needs_decision','conflict')`);
  if(search){
   const term=`%${search.replace(/[\\%_]/g,'\\$&')}%`;
   const patternIndex=n++;
   values.push(term);
   const isPhoneSearch=/^[+\d\s().-]+$/.test(search);
   const digits=search.replace(/\D/g,'');
   let phoneDigitsClause='';
   if(isPhoneSearch&&digits.length>=3){
    const digitsIndex=n++;
    values.push(`%${digits}%`);
    const phoneDigitsExpr=`regexp_replace(COALESCE(p.phone,''), '[^0-9]', '', 'g')`;
    const localPhoneExpr=`CASE WHEN ${phoneDigitsExpr} LIKE '234%' AND LENGTH(${phoneDigitsExpr})=13 THEN '0'||SUBSTRING(${phoneDigitsExpr} FROM 4) ELSE ${phoneDigitsExpr} END`;
    phoneDigitsClause=` OR ${phoneDigitsExpr} LIKE $${digitsIndex}::text OR (${localPhoneExpr}) LIKE $${digitsIndex}::text`;
   }
   where.push(`(COALESCE(p.display_name,'') ILIKE $${patternIndex}::text  OR COALESCE(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),'') ILIKE $${patternIndex}::text  OR COALESCE(p.phone,'') ILIKE $${patternIndex}::text  OR COALESCE(p.email,'') ILIKE $${patternIndex}::text ${phoneDigitsClause})`);
  }
  const sortName=`LOWER(COALESCE(NULLIF(p.display_name,''),NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),p.first_name,''))`;
  const cursorClause=cursor?`(r.new_rank,r.truth_rank,r.sort_name,r.id) > (${values.length+1}::int,${values.length+2}::int,${values.length+3}::text,${values.length+4}::uuid)`:'';
  const sql=`
   WITH latest_scan AS(
     SELECT started_at,completed_at
     FROM scan_jobs
     WHERE organization_id=$1::text AND status='complete'
     ORDER BY completed_at DESC NULLS LAST,created_at DESC
     LIMIT 1
   ),
   ranked AS(
     SELECT
       p.id,p.organization_id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.type,p.birthday,
       p.living_truth,p.status,p.source,p.created_at,p.updated_at,p.last_scan_job_id,
       COALESCE(em.last_seen,(
         SELECT MAX(pr.occurred_at)
         FROM participation_records pr
         WHERE pr.organization_id=p.organization_id
           AND pr.person_id=p.id
           AND pr.participation_type='attendance'
       ),(
         SELECT MAX(ar.marked_at)
         FROM attendance_records ar
         WHERE ar.organization_id=p.organization_id
           AND ar.people_id=p.id
           AND ar.present=true
           AND ar.confirmed=true
       )) AS last_seen,
       (
         SELECT to_char(MAX(pr.occurred_at AT TIME ZONE 'UTC'),'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
         FROM participation_records pr
         WHERE pr.organization_id=p.organization_id
           AND pr.person_id=p.id
           AND pr.participation_type='attendance'
       ) AS last_attended_date,
       CASE WHEN p.source='scan' AND ls.started_at IS NOT NULL
              AND p.created_at>=ls.started_at
              AND p.created_at<=COALESCE(ls.completed_at,NOW())
            THEN TRUE ELSE FALSE END AS new_from_latest_scan,
       ${sortName} AS sort_name,
       CASE WHEN p.source='scan' AND ls.started_at IS NOT NULL
              AND p.created_at>=ls.started_at
              AND p.created_at<=COALESCE(ls.completed_at,NOW())
            THEN 0 ELSE 1 END AS new_rank,
       CASE WHEN p.living_truth->>'status'='needs_decision' THEN 0
            WHEN p.living_truth->>'status'='conflict' THEN 1 ELSE 2 END AS truth_rank
     FROM people p
     LEFT JOIN engagement_metrics em
       ON em.organization_id=p.organization_id AND em.person_id=p.id
     LEFT JOIN latest_scan ls ON TRUE
     WHERE ${where.join(' AND ')}
   )
   SELECT r.id,r.first_name,r.last_name,r.display_name,r.phone,r.email,r.type,r.status,r.birthday,r.living_truth,r.last_seen,r.last_attended_date,r.new_from_latest_scan,r.new_rank,r.truth_rank,r.sort_name
   FROM ranked r
   WHERE ${cursorClause||'TRUE'}
   ORDER BY r.new_rank,r.truth_rank,r.sort_name,r.id
   LIMIT ${limit+1}`;
  const actualValues=cursor?[...values,cursor.new_rank,cursor.truth_rank,cursor.sort_name,cursor.id]:values;
  const result=await pool.query(sql,actualValues);
  const hasMore=result.rows.length>limit;
  const items=result.rows.slice(0,limit);
  const last=items[items.length-1];
  let total_count=null;
  if(includeTotal){
   const countSql=`SELECT COUNT(*)::int AS count FROM people p WHERE ${where.join(' AND ')}`;
   total_count=Number((await pool.query(countSql,values)).rows[0]?.count)||0;
  }
  const next_cursor=hasMore&&last?Buffer.from(JSON.stringify({new_rank:last.new_rank,truth_rank:last.truth_rank,sort_name:last.sort_name,id:last.id})).toString('base64url'):null;
  return res.status(200).json({items,next_cursor,has_more:hasMore,total_count,limit,search,type,living_truth:living});
 }catch(err){console.error('GET people error:',err);return res.status(500).json({error:'Unable to load people.'})}
}
if(req.method==='POST'){
 const body=req.body||{},rawName=String(body.full_name||'').trim();
 let first_name=String(body.first_name||'').trim(),last_name=String(body.last_name||'').trim(),display_name='';
 if(!first_name&&rawName){const split=splitName(rawName);first_name=split.first_name;last_name=split.last_name;display_name=split.display}
 else display_name=[first_name,last_name].filter(Boolean).join(' ');
 if(!first_name)return res.status(400).json({error:'A name is required'});
 if(first_name.length>150||last_name.length>150)return res.status(400).json({error:'Name is too long'});
 const phone=normalizePhone(body.phone);
 const type=String(body.type||'visitor').trim().toLowerCase();
 if(!['member','visitor'].includes(type))return res.status(400).json({error:'Type must be member or visitor'});
 const email=String(body.email||'').trim().toLowerCase()||null;
 const birthday=String(body.birthday||'').trim()||null;
 const rawRequestId=String(body.client_request_id||'').trim().toLowerCase();
 if(rawRequestId&&!isValidPersonCreateRequestId(rawRequestId))return res.status(400).json({error:'Invalid person creation request ID.',code:'PERSON_CREATE_REQUEST_ID_INVALID'});
 const requestId=rawRequestId||null;
 const payloadHash=hashPersonCreatePayload({first_name,last_name,display_name,phone,email,type,birthday});
 const client=await pool.connect();
 let person=null,wasReplay=false;
 try{
  await client.query('BEGIN');
  if(requestId)await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['nyeocare:person-create:'+orgId+':'+requestId]);
  if(phone)await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['nyeocare:person-create-phone:'+orgId+':'+phone]);
  let prior=null;
  if(requestId){
   prior=(await client.query(
    `SELECT r.payload_hash AS request_payload_hash,p.*
     FROM public.person_create_requests r
     JOIN public.people p ON p.id=r.person_id AND p.organization_id=r.organization_id
     WHERE r.organization_id=$1 AND r.client_request_id=$2
     LIMIT 1 FOR UPDATE OF r,p`,
    [orgId,requestId]
   )).rows[0]||null;
  }
  if(prior){
   if(prior.request_payload_hash!==payloadHash){
    await client.query('ROLLBACK');
    return res.status(409).json({error:'This retry key was already used for different person details. Review the form and submit again.',code:'PERSON_CREATE_REQUEST_ID_REUSED'});
   }
   person={...prior};
   delete person.request_payload_hash;
   wasReplay=true;
  }else{
   const duplicate=await duplicatePhone(orgId,phone,null,client);
   if(duplicate){
    await client.query('ROLLBACK');
    return res.status(409).json({
     error:'That full phone number already belongs to another person. Review the existing record before adding a new one.',
     code:'DUPLICATE_ACTIVE_PERSON',
     person:duplicate
    });
   }
   person=(await client.query(
    `INSERT INTO people(organization_id,first_name,last_name,display_name,phone,email,type,birthday,created_by,living_truth,status,source)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active','manual')
     RETURNING *`,
    [orgId,first_name,last_name,display_name||null,phone,email,type,birthday,req.user.id,
     JSON.stringify({status:'alive',confidence:90,source:'canonical_record',updated_at:new Date().toISOString()})]
   )).rows[0];
   if(requestId){
    await client.query(
     `INSERT INTO public.person_create_requests(organization_id,client_request_id,payload_hash,person_id,created_by)
      VALUES($1,$2,$3,$4,$5)`,
     [orgId,requestId,payloadHash,person.id,req.user.id]
    );
   }
  }
  await client.query('COMMIT');
 }catch(err){
  try{await client.query('ROLLBACK')}catch{}
  console.error('POST person error:',err);
  return res.status(500).json({error:'Unable to create person.'});
 }finally{client.release()}
 if(wasReplay)return res.status(200).json({...person,created:false,idempotent_replay:true});
 try{
  const event=await emitAriaEvent({organizationId:orgId,personId:person.id,type:'PERSON_CREATED',source:'manual',actorId:req.user.id,metadata:{source:'api'},eventKey:`manual:${orgId}:person:${person.id}:created`});
  if(event)await directAriaEvent(event);
 }catch(err){console.error('ARIA person creation event failed:',err)}
 return res.status(201).json({...person,created:true,idempotent_replay:false});
}
if(req.method==='PUT'){
 const body=req.body||{},id=String(body.id||'').trim();
 if(!id)return res.status(400).json({error:'id is required'});
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({error:'Person id is invalid.',code:'INVALID_PERSON_ID'});
 const fields={};
 for(const key of ['full_name','phone','email','birthday','type','status'])if(Object.prototype.hasOwnProperty.call(body,key))fields[key]=body[key];
 if(!Object.keys(fields).length)return res.status(400).json({error:'Provide at least one person field to update.'});
 try{
  const result=await updatePersonRecord({organizationId:orgId,actorId:req.user.id,personId:id,fields});
  return res.status(200).json({...result.person,updated_fields:result.updated_fields,no_changes:Boolean(result.no_changes),event_id:result.event_id||null});
 }catch(err){
  console.error('PUT person error:',err);
  const status=[400,403,404,409].includes(Number(err?.status))?Number(err.status):err?.code==='DUPLICATE_ACTIVE_PERSON'?409:500;
  const safeMessage=status<500?String(err.message||'Unable to update person.'):'Unable to update person.';
  return res.status(status).json({error:safeMessage,code:err?.code||undefined});
 }
}
res.setHeader('Allow','GET,POST,PUT');return res.status(405).json({error:'Method not allowed'})}
export default withOrg(handler);
