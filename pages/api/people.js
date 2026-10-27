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
const identityNameKey=value=>normalizeDisplayName(value).core.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
async function findIdentityCandidates(orgId,nameKey,phone,db=pool){
 const digits=String(phone||'').replace(/\\D/g,'');
 const localDigits=digits.startsWith('234')?'0'+digits.slice(3):digits;
 const phoneVariants=[...new Set([digits,localDigits].filter(Boolean))];
 const phoneMatchExpr="($2::text IS NOT NULL AND (p.phone=$2 OR regexp_replace(COALESCE(p.phone,''), '[^0-9]', '', 'g')=ANY($4::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p.phone_numbers,'[]'::jsonb)) v WHERE v->>'normalized'=$2 OR regexp_replace(COALESCE(v->>'normalized',''), '[^0-9]', '', 'g')=ANY($4::text[]) OR regexp_replace(COALESCE(v->>'raw',''), '[^0-9]', '', 'g')=ANY($4::text[]))))";
 const nameExpr="lower(regexp_replace(trim(COALESCE(NULLIF(CONCAT_WS(' ',p.first_name,p.last_name),''),p.display_name,'')), '[^a-zA-Z0-9]+', ' ', 'g'))";
 const q=await db.query(
  'SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.type,p.status,'+nameExpr+' AS name_key,CASE WHEN '+phoneMatchExpr+' THEN TRUE ELSE FALSE END AS phone_match '+
  'FROM people p WHERE p.organization_id=$1 AND p.status IN (\'active\',\'inactive\') AND (('+phoneMatchExpr+') OR ($3::text<>\'\' AND '+nameExpr+'=$3)) '+
  'ORDER BY CASE WHEN '+phoneMatchExpr+' THEN 0 ELSE 1 END,p.created_at ASC LIMIT 20',
  [orgId,phone||null,nameKey||'',phoneVariants]
 );
 return q.rows.map(row=>({...row,phone_match:row.phone_match===true}));
}
async function handler(req,res){const orgId=req.org.id;const role=String(req.user?.role||'').trim().toLowerCase();const adminRoles=['owner','admin'];const personCreatorRoles=['owner','admin','leader','worker','user'];const personEditorRoles=['owner','admin','leader','worker','user'];if(req.method==='GET'&&!personCreatorRoles.includes(role))return res.status(403).json({error:'People records and private contact details are limited to authorized organization operators.'});if(req.method==='POST'&&!personCreatorRoles.includes(role))return res.status(403).json({error:'You do not have permission to add people to this organization.'});if(req.method==='PUT'&&!personEditorRoles.includes(role))return res.status(403).json({error:'Authorized organization operator permissions required.'});
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
 const body=req.body||{};
 const rawName=String(body.full_name||[body.first_name,body.last_name].filter(Boolean).join(' ')).trim();
 const normalizedInput=normalizeDisplayName(rawName);
 const nameParts=normalizedInput.core.split(/\s+/).filter(Boolean);
 const first_name=nameParts.shift()||'',last_name=nameParts.join(' '),display_name=normalizedInput.display;
 if(!first_name)return res.status(400).json({error:'A name is required'});
 if(first_name.length>150||last_name.length>150||display_name.length>200)return res.status(400).json({error:'Name is too long'});
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
   const incomingNameKey=identityNameKey(display_name||rawName);
   const candidates=await findIdentityCandidates(orgId,incomingNameKey,phone,client);
   const candidatePayload=candidates.map(row=>({
    id:String(row.id),
    display_name:row.display_name||[row.first_name,row.last_name].filter(Boolean).join(' ')||row.first_name||'Unnamed person',
    first_name:row.first_name||'',last_name:row.last_name||'',phone:row.phone||null,
    type:row.type||null,status:row.status||null,
    name_match:Boolean(row.name_key&&row.name_key===incomingNameKey),
    phone_match:row.phone_match===true
   }));
   const exactIdentity=candidatePayload.find(row=>row.name_match&&row.phone_match);
   if(exactIdentity){
    await client.query('ROLLBACK');
    return res.status(409).json({
     error:'A person with this same name and phone number already exists. Open the existing record or correct the name/number; NYEOCARE will not create a second person with the same identity.',
     code:'DUPLICATE_IDENTITY_NOT_DISTINCT',candidates:[exactIdentity]
    });
   }
   const review=body.identity_review&&typeof body.identity_review==='object'?body.identity_review:null;
   const reviewCandidateIds=Array.isArray(review?.candidate_ids)?[...new Set(review.candidate_ids.map(v=>String(v)))].sort():[];
   const currentCandidateIds=candidatePayload.map(row=>row.id).sort();
   if(candidates.length){
    if(review?.confirmed!==true){
     await client.query('ROLLBACK');
     return res.status(409).json({
      error:'ARIA found possible matches. Review the records before deciding whether this is a separate person.',
      code:'PERSON_IDENTITY_REVIEW_REQUIRED',candidates:candidatePayload,
      review_reasons:[...new Set(candidates.map(row=>row.phone_match?'phone_already_used':'similar_name'))]
     });
    }
    if(reviewCandidateIds.length!==currentCandidateIds.length||reviewCandidateIds.some((value,index)=>value!==currentCandidateIds[index])){
     await client.query('ROLLBACK');
     return res.status(409).json({
      error:'The possible matches changed while you were reviewing. Review the refreshed candidate list before saving.',
      code:'PERSON_IDENTITY_REVIEW_STALE',candidates:candidatePayload
     });
    }
   }else if(review?.confirmed===true&&reviewCandidateIds.length){
    await client.query('ROLLBACK');
    return res.status(409).json({error:'The records changed while you were reviewing. Refresh the People list and try again.',code:'PERSON_IDENTITY_REVIEW_STALE',candidates:[]});
   }
   person=(await client.query(
    `INSERT INTO people(organization_id,first_name,last_name,display_name,phone,email,type,birthday,created_by,living_truth,status,source)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active','manual')
     RETURNING *`,
    [orgId,first_name,last_name,display_name||null,phone,email,type,birthday,req.user.id,
     JSON.stringify({status:'alive',confidence:90,source:'canonical_record',updated_at:new Date().toISOString()})]
   )).rows[0];
   if(candidates.length){
    for(const candidate of candidates){
     const sharedPhone=candidate.phone_match===true&&Boolean(phone);
     const evidence=JSON.stringify({
      source:'manual_person_create_review',decision:'not_duplicate',
      actor_id:req.user.id,actor_role:role,reviewed_at:new Date().toISOString(),
      incoming_person_id:person.id,incoming_display_name:person.display_name||display_name,
      incoming_phone:phone||null,matched_person_id:candidate.id,
      matched_display_name:candidate.display_name||[candidate.first_name,candidate.last_name].filter(Boolean).join(' '),
      reason:sharedPhone?'operator_verified_distinct_people_sharing_a_contact':'operator_verified_distinct_people_with_similar_names'
     });
     await client.query(
      `INSERT INTO identity_pair_decisions(organization_id,person_a_id,person_b_id,decision,decided_by,evidence)
       VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid),'not_duplicate',$4,$5::jsonb)
       ON CONFLICT (organization_id,LEAST(person_a_id,person_b_id),GREATEST(person_a_id,person_b_id))
       DO UPDATE SET decision='not_duplicate',decided_by=EXCLUDED.decided_by,evidence=EXCLUDED.evidence,updated_at=NOW()`,
      [orgId,person.id,candidate.id,req.user.id,evidence]
     );
     if(sharedPhone){
      const sharedMetadata=JSON.stringify({source:'manual_person_create_review',reason:'operator_verified_shared_contact',reviewed_by:req.user.id,reviewed_at:new Date().toISOString()});
      await client.query(
       `INSERT INTO identity_shared_contacts(organization_id,person_a_id,person_b_id,phone,confirmed_by,metadata)
        VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid),$4,$5,$6::jsonb)
        ON CONFLICT DO NOTHING`,
       [orgId,person.id,candidate.id,phone,req.user.id,sharedMetadata]
      );
     }
    }
   }
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
 return res.status(201).json({...person,created:true,idempotent_replay:false,identity_review_confirmed:Boolean(req.body?.identity_review?.confirmed)});
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
