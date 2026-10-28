import pool from'../db';
import{normalizePhone,normalizePhoneList,primaryPhone}from'../phoneUtils';
import{normalizeDisplayName}from'../scanValidation';import{candidatesRequiringEditIdentityReview}from'./identityEditPolicy';
import{emitAriaEvent}from'./eventEmitter';import{filterRowsToOrganization}from'./tenantScope';import{createHash}from'node:crypto';
import{persistPersonIdentityReview,resolvePersonIdentityReviewByRequest,stableIdentityReviewRequestId,personIdentityPayloadHash}from'../personIdentityReviewQueue';

const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const splitName=value=>{const n=normalizeDisplayName(value),parts=n.core.split(/\s+/).filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' '),display_name:n.display}};
function phoneNumbersForEditedPrimary(person,nextPrimary,primarySource='human_edit'){
 const stored=Array.isArray(person?.phone_numbers)?person.phone_numbers:[];
 const ordered=stored.map((entry,index)=>({entry,index,order:Number.isFinite(Number(entry?.index))&&Number(entry.index)>0?Number(entry.index):index+1})).sort((a,b)=>a.order-b.order||a.index-b.index).map(item=>item.entry);
 const previousPrimary=primaryPhone(person),seen=new Set(),out=[];
 const valueOf=entry=>normalizePhoneList({phones:[entry]},{limit:1})[0]||null;
 if(nextPrimary){
  const existingPrimary=ordered.find(entry=>valueOf(entry)===nextPrimary);
  out.push(existingPrimary&&typeof existingPrimary==='object'
   ?{...existingPrimary,raw:existingPrimary.raw||nextPrimary,normalized:nextPrimary,index:1}
   :{raw:nextPrimary,normalized:nextPrimary,source:primarySource,index:1});
  seen.add(nextPrimary);
 }
 for(const entry of ordered){
  const value=valueOf(entry);
  if(!value||value===nextPrimary||value===previousPrimary||seen.has(value))continue;
  seen.add(value);
  out.push(entry&&typeof entry==='object'
   ?{...entry,raw:entry.raw||value,normalized:value,source:entry.source||'existing_phone_numbers',index:out.length+1}
   :{raw:value,normalized:value,source:'existing_phone_numbers',index:out.length+1});
 }
 return out.slice(0,4).map((entry,index)=>({...entry,index:index+1}));
}
export const identityNameKey=value=>normalizeDisplayName(value).core.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
export async function findIdentityCandidates(organizationId,nameKey,phone,db=pool,excludePersonId=null){
 const digits=String(phone||'').replace(/\D/g,'');
 const localDigits=digits.startsWith('234')?'0'+digits.slice(3):digits;
 const phoneVariants=[...new Set([digits,localDigits].filter(Boolean))];
 const phoneMatchExpr="($2::text IS NOT NULL AND (p.phone=$2 OR regexp_replace(COALESCE(p.phone,''), '[^0-9]', '', 'g')=ANY($4::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p.phone_numbers,'[]'::jsonb)) v WHERE v->>'normalized'=$2 OR regexp_replace(COALESCE(v->>'normalized',''), '[^0-9]', '', 'g')=ANY($4::text[]) OR regexp_replace(COALESCE(v->>'raw',''), '[^0-9]', '', 'g')=ANY($4::text[]))))";
 const nameExpr="lower(regexp_replace(trim(COALESCE(NULLIF(CONCAT_WS(' ',p.first_name,p.last_name),''),p.display_name,'')), '[^a-zA-Z0-9]+', ' ', 'g'))";
 const displayExpr="COALESCE(NULLIF(p.display_name, ''::text), ((COALESCE(p.first_name, ''::text) || ' '::text) || COALESCE(p.last_name, ''::text)))";
 const aliasMatchExpr="EXISTS(SELECT 1 FROM person_aliases a WHERE a.organization_id=$1 AND a.person_id=p.id AND lower(regexp_replace(trim(a.alias), '[^a-zA-Z0-9]+', ' ', 'g'))=$3::text)";
 const mergedArchiveExpr="(p.status='archived' AND (COALESCE(p.metadata->>'identity_merged_into','')<>'' OR (p.living_truth->>'source'='identity_merge' AND COALESCE(p.living_truth->>'merged_into','')<>'')))";
 const nameOrPhoneMatch="(("+phoneMatchExpr+") OR ("+nameExpr+"=$3) OR ("+displayExpr+" % $5::text) OR ("+aliasMatchExpr+"))";
 const result=await db.query(
  "WITH matches AS ("+
  " SELECT p.id,p.organization_id,p.first_name,p.last_name,p.display_name,p.phone,p.phone_numbers,p.email,p.type,p.status,p.created_at,"+
  " CASE WHEN "+phoneMatchExpr+" THEN TRUE ELSE FALSE END AS phone_match,"+
  " CASE WHEN "+displayExpr+" % $5::text THEN TRUE ELSE FALSE END AS similar_name,"+
  " CASE WHEN "+aliasMatchExpr+" THEN TRUE ELSE FALSE END AS alias_name_match "+
  " FROM people p WHERE p.organization_id=$1 AND p.status='active' AND p.id<>$6::uuid "+
  " AND "+nameOrPhoneMatch+
  " UNION ALL "+
  " SELECT p.id,p.organization_id,p.first_name,p.last_name,p.display_name,p.phone,p.phone_numbers,p.email,p.type,p.status,p.created_at,"+
  " CASE WHEN "+phoneMatchExpr+" THEN TRUE ELSE FALSE END AS phone_match,"+
  " CASE WHEN "+displayExpr+" % $5::text THEN TRUE ELSE FALSE END AS similar_name,"+
  " CASE WHEN "+aliasMatchExpr+" THEN TRUE ELSE FALSE END AS alias_name_match "+
  " FROM people p WHERE p.organization_id=$1 AND p.status IN ('inactive','archived') AND p.id<>$6::uuid "+
  // A merge-archived row is historical evidence for its canonical person, not another identity.
  // Keep it visible only if it still carries a phone collision; never let a stale merged name
  // create a second review candidate after its alias has been moved to the surviving record.
  " AND (NOT "+mergedArchiveExpr+" OR ("+phoneMatchExpr+")) "+
  " AND "+nameOrPhoneMatch+
  ") SELECT * FROM matches ORDER BY CASE WHEN phone_match THEN 0 WHEN similar_name OR alias_name_match THEN 1 ELSE 2 END,created_at ASC LIMIT 20",
  [organizationId,phone||null,nameKey||'',phoneVariants,nameKey||'',excludePersonId||'00000000-0000-0000-0000-000000000000']
 );
 // Defense in depth: identity suggestions must never cross an organization boundary.
 // The SQL predicates below are the primary guard; this post-filter also fails safely
 // if a future query edit or adapter accidentally returns a foreign-tenant row.
 const scopedRows=filterRowsToOrganization(result.rows,organizationId);
 if(scopedRows.length!==result.rows.length){
  console.error('[IDENTITY] Discarded out-of-organization identity candidates.',{
   organization_id:String(organizationId),discarded_count:result.rows.length-scopedRows.length
  });
 }
 return scopedRows.map(row=>{
  const displayName=row.display_name||[row.first_name,row.last_name].filter(Boolean).join(' ')||row.first_name||'Unnamed person';
  return {
   id:String(row.id),organization_id:String(row.organization_id),first_name:row.first_name||'',last_name:row.last_name||'',
   display_name:displayName,phone:primaryPhone(row),email:row.email||null,
   type:row.type||null,status:row.status||null,
   name_match:identityNameKey(displayName)===nameKey||row.alias_name_match===true,
   phone_match:row.phone_match===true,
   similar_name:row.similar_name===true
  };
 });
}


export async function recordIdentityReview(db,{organizationId,actorId,actorRole,person,candidates,phone,source}){
 for(const candidate of candidates){
  const sharedPhone=candidate.phone_match===true&&Boolean(phone);
  const reason=sharedPhone
   ?'operator_verified_distinct_people_sharing_a_contact'
   :candidate.name_match
    ?'operator_verified_same_name_distinct_phone'
    :candidate.similar_name
     ?'operator_verified_similar_names'
     :'operator_verified_distinct_records';
  const evidence=JSON.stringify({
   source,decision:'not_duplicate',actor_id:actorId,actor_role:actorRole,
   reviewed_at:new Date().toISOString(),incoming_person_id:person.id,
   incoming_display_name:person.display_name||[person.first_name,person.last_name].filter(Boolean).join(' '),
   incoming_phone:phone||null,matched_person_id:candidate.id,
   matched_display_name:candidate.display_name||null,reason
  });
  await db.query(
   "INSERT INTO identity_pair_decisions(organization_id,person_a_id,person_b_id,decision,decided_by,evidence) "+
   "VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid),'not_duplicate',$4,$5::jsonb) "+
   "ON CONFLICT (organization_id,LEAST(person_a_id,person_b_id),GREATEST(person_a_id,person_b_id)) "+
   "DO UPDATE SET decision='not_duplicate',decided_by=EXCLUDED.decided_by,evidence=EXCLUDED.evidence,updated_at=NOW()",
   [organizationId,person.id,candidate.id,actorId,evidence]
  );
  if(sharedPhone){
   const sharedMetadata=JSON.stringify({source,reason:'operator_verified_shared_contact',reviewed_by:actorId,reviewed_at:new Date().toISOString()});
   await db.query(
    "INSERT INTO identity_shared_contacts(organization_id,person_a_id,person_b_id,phone,confirmed_by,metadata) "+
    "VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid),$4,$5,$6::jsonb) ON CONFLICT DO NOTHING",
    [organizationId,person.id,candidate.id,phone,actorId,sharedMetadata]
   );
  }
 }
}

import{parsePeopleRoster}from'./peopleRosterParser';
export{parsePeopleRoster}from'./peopleRosterParser';
export async function createPerson({organizationId,actorId,name,phone=null,birthday=null,type='visitor',identityReview=null}){
 const actor=(await pool.query("SELECT id,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId])).rows[0];
 if(!actor||!['owner','admin','leader','worker','user'].includes(String(actor.role||'').toLowerCase()))throw Object.assign(new Error('Authorized organization operator required.'),{status:403});
 const rawName=clean(name,200);
 const parsed=splitName(rawName);
 if(!parsed.first_name)throw Object.assign(new Error('A name is required.'),{status:400});
 const normalized=phone?normalizePhone(phone):null;
 if(phone&&!normalized)throw Object.assign(new Error('That phone number is incomplete or invalid.'),{status:400,code:'INVALID_PHONE'});
 if(!['member','visitor'].includes(String(type||'visitor').toLowerCase()))throw Object.assign(new Error('Type must be member or visitor.'),{status:400});
 let dob=null;
 if(birthday){
  dob=String(birthday).trim();
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(dob))throw Object.assign(new Error('Birthday must use YYYY-MM-DD.'),{status:400});
  const parts=dob.split('-').map(Number),date=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
  if(date.getUTCFullYear()!==parts[0]||date.getUTCMonth()!==parts[1]-1||date.getUTCDate()!==parts[2])throw Object.assign(new Error('That birthday is not a valid calendar date.'),{status:400,code:'INVALID_BIRTHDAY'});
 }
 const nameKey=identityNameKey(parsed.display_name||rawName);
 const proposal={
  first_name:parsed.first_name,last_name:parsed.last_name,display_name:parsed.display_name||null,full_name:parsed.display_name||null,
  phone:normalized,phone_numbers:normalized?[{raw:normalized,normalized,source:'aria_direct_create',index:1}]:[],
  email:null,birthday:dob,type:String(type||'visitor').toLowerCase()
 };
 const payloadHash=personIdentityPayloadHash(proposal);
 const requestKey=`aria-person-create:${organizationId}:${actor.id}:${payloadHash}`;
 const requestId=stableIdentityReviewRequestId(requestKey);
 const client=await pool.connect();
 let person=null,identityCandidates=[],alreadyCreated=false;
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['nyeocare:person-name:'+organizationId+':'+nameKey]);
  if(normalized)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['nyeocare:person-phone:'+organizationId+':'+normalized]);
  const prior=(await client.query(
   `SELECT r.payload_hash,p.* FROM public.person_create_requests r
    JOIN public.people p ON p.id=r.person_id AND p.organization_id=r.organization_id
    WHERE r.organization_id=$1 AND r.client_request_id=$2 LIMIT 1 FOR UPDATE OF r,p`,
   [organizationId,requestId]
  )).rows[0];
  if(prior){
   if(prior.payload_hash!==payloadHash)throw Object.assign(new Error('This person creation request was reused for different details.'),{status:409,code:'PERSON_CREATE_REQUEST_ID_REUSED'});
   person=prior;alreadyCreated=true;
  }else{
   identityCandidates=await findIdentityCandidates(organizationId,nameKey,normalized,client);
   const exact=identityCandidates.find(candidate=>candidate.name_match&&candidate.phone_match);
   const review=identityReview&&typeof identityReview==='object'?identityReview:null;
   const expectedIds=Array.isArray(review?.candidate_ids)?[...new Set(review.candidate_ids.map(value=>String(value)))].sort():[];
   const currentIds=identityCandidates.map(candidate=>String(candidate.id)).sort();
   const changed=expectedIds.length!==currentIds.length||expectedIds.some((value,index)=>value!==currentIds[index]);
   if((identityCandidates.length&&(review?.confirmed!==true||changed))||(!identityCandidates.length&&review?.confirmed===true&&expectedIds.length)){
    const code=review?.confirmed===true?'PERSON_IDENTITY_REVIEW_STALE':exact?'DUPLICATE_IDENTITY_NOT_DISTINCT':'PERSON_IDENTITY_REVIEW_REQUIRED';
    const candidates=identityCandidates.map(candidate=>({...candidate,display_name:candidate.display_name||[candidate.first_name,candidate.last_name].filter(Boolean).join(' ')}));
    const saved=await persistPersonIdentityReview(client,{
     organizationId,actorId:actor.id,clientRequestId:requestKey,payloadHash,proposedPayload:proposal,candidates,
     evidence:{code,review_reasons:candidates.map(candidate=>candidate.phone_match?'phone_already_used':candidate.name_match?'same_normalized_name':'similar_name'),source:'aria_person_create'},
     source:'manual_create'
    });
    await client.query('COMMIT');
    const error=Object.assign(new Error(exact?'The same normalized name and phone already exist. Review the saved proposal in Review Center and choose merge or keep separate.':'Possible identity matches need human review before ARIA can create this person. Open Review Center to finish the decision.'),{status:409,code,review_id:saved.id});
    error.candidates=candidates;
    throw error;
   }
   person=(await client.query(
    "INSERT INTO people(organization_id,first_name,last_name,display_name,phone,phone_numbers,type,birthday,created_by,living_truth,status,source) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active','aria') "+
    "RETURNING id,organization_id,first_name,last_name,display_name,phone,phone_numbers,type,birthday,status,source,created_at,updated_at",
    [organizationId,parsed.first_name,parsed.last_name,parsed.display_name||null,normalized,JSON.stringify(normalized?[{raw:normalized,normalized,source:'aria_direct_create',index:1}]:[]),String(type||'visitor').toLowerCase(),dob,actor.id,
     JSON.stringify({status:'alive',confidence:90,source:'aria_direct_create',updated_at:new Date().toISOString()})]
   )).rows[0];
   if(identityCandidates.length)await recordIdentityReview(client,{
    organizationId,actorId:actor.id,actorRole:actor.role,
    person,candidates:identityCandidates,phone:normalized,source:'aria_person_create_identity_review'
   });
   await client.query(
    `INSERT INTO public.person_create_requests(organization_id,client_request_id,payload_hash,person_id,created_by)
     VALUES($1,$2,$3,$4,$5)`,
    [organizationId,requestId,payloadHash,person.id,actor.id]
   );
   if(review?.confirmed===true)await resolvePersonIdentityReviewByRequest(client,{
    organizationId,clientRequestId:requestKey,payloadHash,actorId:actor.id,personId:person.id,action:'keep_separate',
    metadata:{source:'aria_person_create_confirmation',candidate_ids:currentIds}
   });
  }
  await client.query('COMMIT');
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release()}
 const event=await emitAriaEvent({
  organizationId,personId:person.id,type:alreadyCreated?'PERSON_UPDATED':'PERSON_CREATED',source:'aria_direct_create',actorId:actor.id,actorRole:actor.role,
  evidenceKind:'human_report',verificationStatus:'reported',confidence:.99,
  metadata:{name_source:'operator_command',phone_source:normalized?'operator_command':'not_supplied',birthday_source:dob?'operator_command':'not_supplied',identity_review_confirmed:Boolean(identityCandidates.length),idempotent_replay:alreadyCreated},
  eventKey:'aria-person-create:'+person.id
 });
 return{created:!alreadyCreated,person,event_id:event?.id||null,identity_review_confirmed:Boolean(identityCandidates.length),idempotent_replay:alreadyCreated};
}
export async function importPeopleRoster({organizationId,actorId,text}){
 const role=(await pool.query("SELECT role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId])).rows[0]?.role;
 if(!['owner','admin','leader','worker','user'].includes(String(role||'').toLowerCase()))throw Object.assign(new Error('Authorized organization operator required.'),{status:403});
 const parsed=parsePeopleRoster(text,{normalizePhone});
 if(!parsed.rows.length)return{created:[],existing:[],invalid:[],ignored:parsed.ignored,message:'I could not safely find person rows with names and phone numbers.'};
 const created=[],existing=[],invalid=[];
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['people-bulk-create:'+organizationId]);
  const seenPhones=new Map(),seenNames=new Map();
  for(const [rowIndex,row] of parsed.rows.entries()){
   let normalized=normalizePhone(row.phone);
   if(row.phone&&!normalized){invalid.push({...row,reason:'Phone number is incomplete or invalid. Correct it in Review Center or People before saving.'});continue}
   const parsedName=splitName(row.name);
   const nameKey=identityNameKey(parsedName.display_name||row.name);
   if(normalized&&seenPhones.has(normalized)){
    invalid.push({...row,reason:'This phone number is also listed for '+seenPhones.get(normalized)+'. Save the first row, then review this shared number in People before adding this person.'});
    continue;
   }
   if(nameKey&&seenNames.has(nameKey)){
    invalid.push({...row,reason:'This name is similar to '+seenNames.get(nameKey)+'. Save the first row, then review the second row in People before adding it.'});
    continue;
   }
   if(normalized)seenPhones.set(normalized,parsedName.display_name||row.name);
   if(nameKey)seenNames.set(nameKey,parsedName.display_name||row.name);
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['nyeocare:person-name:'+organizationId+':'+nameKey]);
   if(normalized)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['nyeocare:person-phone:'+organizationId+':'+normalized]);
   const proposal={
    first_name:parsedName.first_name,last_name:parsedName.last_name,display_name:parsedName.display_name||null,full_name:parsedName.display_name||null,
    phone:normalized,phone_numbers:normalized?[{raw:normalized,normalized,source:'aria_roster_import',index:1}]:[],
    email:null,birthday:null,type:'visitor'
   };
   const payloadHash=personIdentityPayloadHash(proposal);
   const requestKey=`aria-roster-import:${organizationId}:${actorId}:${rowIndex}:${payloadHash}`;
   const requestId=stableIdentityReviewRequestId(requestKey);
   const priorRequest=(await client.query(
    `SELECT r.payload_hash,r.person_id,p.display_name,p.phone FROM public.person_create_requests r
     JOIN public.people p ON p.id=r.person_id AND p.organization_id=r.organization_id
     WHERE r.organization_id=$1 AND r.client_request_id=$2 LIMIT 1 FOR UPDATE OF r,p`,
    [organizationId,requestId]
   )).rows[0];
   if(priorRequest){
    if(priorRequest.payload_hash!==payloadHash)throw Object.assign(new Error('This roster row was already used for different details.'),{status:409,code:'PERSON_CREATE_REQUEST_ID_REUSED'});
    existing.push({...row,person_id:priorRequest.person_id,name:priorRequest.display_name||row.name,normalized_phone:priorRequest.phone||normalized,already_saved:true});
    continue;
   }
   const matches=await findIdentityCandidates(organizationId,nameKey,normalized,client);
   const exact=matches.find(candidate=>candidate.name_match&&candidate.phone_match);
   if(matches.length){
    const candidates=matches.map(candidate=>({
      id:String(candidate.id),organization_id:String(candidate.organization_id),
      display_name:candidate.display_name||[candidate.first_name,candidate.last_name].filter(Boolean).join(' ')||'Unnamed person',
      first_name:candidate.first_name||'',last_name:candidate.last_name||'',
      phone:candidate.phone||null,type:candidate.type||null,status:candidate.status||null,
      name_match:candidate.name_match===true,phone_match:candidate.phone_match===true,similar_name:candidate.similar_name===true
    }));
    const saved=await persistPersonIdentityReview(client,{
      organizationId,actorId,clientRequestId:requestKey,payloadHash,proposedPayload:proposal,candidates,
      evidence:{code:exact?'DUPLICATE_IDENTITY_NOT_DISTINCT':'PERSON_IDENTITY_REVIEW_REQUIRED',
       reason:exact?'Exact normalized name and phone match':'Possible existing identity match',
       review_reasons:candidates.map(candidate=>candidate.phone_match?'phone_already_used':candidate.name_match?'same_normalized_name':'similar_name'),
       source:'aria_roster_import',row_number:rowIndex+1},
      source:'manual_create'
    });
    invalid.push({
     ...row,
     reason:exact?'The same normalized name and phone already exist. The proposed row is in Review Center until you choose merge or keep separate.':'Possible identity matches need human review. The proposed row is in Review Center; no new person was saved for this row.',
     identity_review_required:true,review_id:saved.id,
     candidates
    });
    continue;
   }
   const person=(await client.query(
    "INSERT INTO people(organization_id,first_name,last_name,display_name,phone,phone_numbers,type,created_by,living_truth,status,source) "+
    "VALUES($1,$2,$3,$4,$5,$6,'visitor',$7,$8,'active','aria') "+
    "RETURNING id,first_name,last_name,display_name,phone,phone_numbers",
    [organizationId,parsedName.first_name,parsedName.last_name,parsedName.display_name||null,normalized,JSON.stringify(normalized?[{raw:normalized,normalized,source:'aria_roster_import',index:1}]:[]),actorId,
     JSON.stringify({status:'alive',confidence:88,source:'aria_roster_import',updated_at:new Date().toISOString()})]
   )).rows[0];
   await client.query(
    `INSERT INTO public.person_create_requests(organization_id,client_request_id,payload_hash,person_id,created_by)
     VALUES($1,$2,$3,$4,$5)`,
    [organizationId,requestId,payloadHash,person.id,actorId]
   );
   const event=await emitAriaEvent({organizationId,personId:person.id,type:'PERSON_CREATED',source:'aria_roster_import',actorId,evidenceKind:'human_report',verificationStatus:'reported',confidence:.95,metadata:{name_source:'operator_text',phone_source:row.phone?'operator_text':'missing'}},client);
   created.push({...row,person_id:person.id,name:person.display_name||row.name,normalized_phone:person.phone,event_id:event?.id||null});
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
 return{
  created,existing,invalid,ignored:parsed.ignored,
  message:'Saved '+created.length+' new people. '+existing.length+' matched exact existing identities. '+invalid.length+' row(s) need correction or human identity review before they can be safely saved.'
 };
}

export async function updatePersonRecord({organizationId,actorId,personId,fields,identityReview=null}){
 const actor=(await pool.query("SELECT id,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId])).rows[0];
 if(!actor||!['owner','admin','leader','worker','user'].includes(String(actor.role||'').toLowerCase()))throw Object.assign(new Error('Authorized organization operator required.'),{status:403});
 if(!fields||typeof fields!=='object'||Array.isArray(fields))throw Object.assign(new Error('Person fields are required.'),{status:400});

 const client=await pool.connect();
 let event=null,updatedFields=[];
 let person=null,previous=null;
 try{
  await client.query('BEGIN');
  const current=(await client.query(
   "SELECT id,organization_id,first_name,last_name,display_name,phone,phone_numbers,email,birthday,type,status,living_truth FROM people WHERE id=$1::uuid AND organization_id=$2 AND status IN('active','inactive') LIMIT 1 FOR UPDATE",
   [personId,organizationId]
  )).rows[0];
  if(!current)throw Object.assign(new Error('Person not found or archived.'),{status:404});
  previous=current;
  let nextDisplayName=current.display_name||[current.first_name,current.last_name].filter(Boolean).join(' ');
  let nextPhone=primaryPhone(current);

  const updates=[],values=[];let n=1;
  const add=(column,value)=>{updates.push(column+'=$'+n++);values.push(value);updatedFields.push(column)};
  if(fields.full_name!==undefined){
   let incoming=clean(fields.full_name,200);
   if(!incoming)throw Object.assign(new Error('Name cannot be empty.'),{status:400});
   const existingName=normalizeDisplayName(current.display_name||[current.first_name,current.last_name].filter(Boolean).join(' '));
   const incomingName=normalizeDisplayName(incoming);
   if(existingName.honorific&&!incomingName.honorific)incoming=existingName.honorific+' '+incoming;
   const parsed=splitName(incoming);
   if(!parsed.first_name)throw Object.assign(new Error('Name cannot be empty.'),{status:400});
   nextDisplayName=parsed.display_name;
   if(parsed.first_name!==String(current.first_name||'')||parsed.last_name!==String(current.last_name||'')||String(parsed.display_name||'')!==String(current.display_name||'')){
    add('first_name',parsed.first_name);add('last_name',parsed.last_name);add('display_name',parsed.display_name||null);
   }
  }
  let userPrimaryPhoneChanged=false;
  if(fields.phone!==undefined){
   const rawPhone=String(fields.phone??'').trim();
   const phone=rawPhone?normalizePhone(rawPhone):null;
   if(rawPhone&&!phone)throw Object.assign(new Error('That phone number is incomplete or invalid.'),{status:400,code:'INVALID_PHONE'});
   const currentPhone=primaryPhone(current);
   if(phone!==currentPhone){
    nextPhone=phone;
    userPrimaryPhoneChanged=true;
   }
  }
  if(fields.email!==undefined){
   const raw=String(fields.email??'').trim().toLowerCase();
   const email=raw||null;
   const currentEmail=String(current.email||'').trim().toLowerCase()||null;
   if(email!==currentEmail)add('email',email);
  }
  if(fields.birthday!==undefined){
   const raw=String(fields.birthday??'').trim();
   let birthday=raw||null;
   if(birthday){
    const m=birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m)throw Object.assign(new Error('Birthday must use YYYY-MM-DD.'),{status:400,code:'INVALID_BIRTHDAY'});
    const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]),check=new Date(Date.UTC(y,mo-1,d));
    if(check.getUTCFullYear()!==y||check.getUTCMonth()!==mo-1||check.getUTCDate()!==d)throw Object.assign(new Error('That date of birth is not a valid calendar date.'),{status:400,code:'INVALID_BIRTHDAY'});
   }
   const currentBirthday=current.birthday?String(current.birthday).slice(0,10):null;
   if(birthday!==currentBirthday)add('birthday',birthday);
  }
  if(fields.type!==undefined){
   const type=String(fields.type||'').trim().toLowerCase();
   if(!['member','visitor'].includes(type))throw Object.assign(new Error('Person type must be member or visitor.'),{status:400,code:'INVALID_PERSON_TYPE'});
   if(type!==String(current.type||'visitor').toLowerCase())add('type',type);
  }
  if(fields.status!==undefined){
   const status=String(fields.status||'').trim().toLowerCase();
   if(!['active','inactive'].includes(status))throw Object.assign(new Error('Person status must be active or inactive. Archived records must be restored separately.'),{status:400,code:'INVALID_PERSON_STATUS'});
   if(status!==String(current.status||'active').toLowerCase())add('status',status);
  }

  // Keep the legacy primary column and ordered JSON contact list synchronized in this
  // transaction, even when the operator only edits a name, email, type, or status.
  // A storage repair is not a user-requested phone change and must not create a false collision.
  if(nextPhone||userPrimaryPhoneChanged){
   const desiredPhoneNumbers=phoneNumbersForEditedPrimary(current,nextPhone,userPrimaryPhoneChanged?'human_edit':'existing_phone_numbers');
   const currentPhoneColumn=String(current.phone??'').trim();
   const currentPhoneNumbers=Array.isArray(current.phone_numbers)?current.phone_numbers:[];
   const desiredPhoneNumbersJson=JSON.stringify(desiredPhoneNumbers);
   if(currentPhoneColumn!==(nextPhone||''))add('phone',nextPhone);
   if(JSON.stringify(currentPhoneNumbers)!==desiredPhoneNumbersJson)add('phone_numbers',desiredPhoneNumbersJson);
  }

  let identityCandidates=[];
  const nameFieldsChanged=updatedFields.some(field=>['first_name','last_name','display_name'].includes(field));
  const identityFieldsChanged=nameFieldsChanged||userPrimaryPhoneChanged;
  if(identityFieldsChanged){
   const incomingNameKey=identityNameKey(nextDisplayName);
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['nyeocare:person-name:'+organizationId+':'+incomingNameKey]);
   if(nextPhone)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['nyeocare:person-phone:'+organizationId+':'+nextPhone]);
   identityCandidates=await findIdentityCandidates(organizationId,incomingNameKey,nextPhone,client,personId);
   // An existing-person phone edit is not a new-person creation. A name-only match
   // (including an archived "Nicholas" matching "Bro Nicholas" after honorific
   // normalization) must not block adding a phone that is not used by another
   // same-organization person. Phone collisions still require review; name edits
   // continue to review same/similar names, and combined edits retain both checks.
   identityCandidates=candidatesRequiringEditIdentityReview(identityCandidates,{nameChanged:nameFieldsChanged,phoneChanged:userPrimaryPhoneChanged});
   const exactIdentity=identityCandidates.find(candidate=>candidate.name_match&&candidate.phone_match);
   if(exactIdentity){
    const error=Object.assign(new Error('A person with this same name and phone number already exists. Open the existing record or correct the name/number; NYEOCARE will not create a second person with the same identity.'),{status:409,code:'DUPLICATE_IDENTITY_NOT_DISTINCT'});
    error.candidates=[exactIdentity];
    throw error;
   }
   const review=identityReview&&typeof identityReview==='object'?identityReview:null;
   const suppliedIds=Array.isArray(review?.candidate_ids)?[...new Set(review.candidate_ids.map(v=>String(v)))].sort():[];
   const foundIds=identityCandidates.map(candidate=>candidate.id).sort();
   if(identityCandidates.length&&review?.confirmed!==true){
    const error=Object.assign(new Error('ARIA found possible matches. Review the records before saving this person update.'),{status:409,code:'PERSON_IDENTITY_REVIEW_REQUIRED'});
    error.candidates=identityCandidates;
    throw error;
   }
   if((identityCandidates.length&&(suppliedIds.length!==foundIds.length||suppliedIds.some((value,index)=>value!==foundIds[index])))||(!identityCandidates.length&&review?.confirmed===true&&suppliedIds.length)){
    const error=Object.assign(new Error('The possible matches changed while you were reviewing. Review the refreshed candidates before saving.'),{status:409,code:'PERSON_IDENTITY_REVIEW_STALE'});
    error.candidates=identityCandidates;
    throw error;
   }
  }
  if(!updates.length){
   await client.query('COMMIT');
   return{updated:false,no_changes:true,person:current,updated_fields:[],previous:current,event_id:null};
  }

  updates.push('updated_at=NOW()');
  values.push(personId,organizationId);
  const idIndex=n,organizationIndex=n+1;
  person=(await client.query(
   "UPDATE people SET "+updates.join(',')+" WHERE id=$"+idIndex+"::uuid AND organization_id=$"+organizationIndex+" AND status IN('active','inactive') RETURNING id,organization_id,first_name,last_name,display_name,phone,phone_numbers,email,birthday,type,status,living_truth,source,created_at,updated_at",
   values
  )).rows[0];
  if(!person)throw Object.assign(new Error('Person not found or archived.'),{status:404});
  if(identityCandidates.length)await recordIdentityReview(client,{organizationId,actorId:actor.id,actorRole:actor.role,person,candidates:identityCandidates,phone:person.phone,source:'people_edit_identity_review'});

  if(current.status==='active'&&person.status==='inactive'){
   await client.query(
    "UPDATE aria_actions SET status='cancelled',failure_reason='Person marked inactive; current follow-up paused',updated_at=NOW() WHERE organization_id=$1 AND person_id=$2 AND status IN('proposed','approved')",
    [organizationId,personId]
   );
  }

  const changedType=updatedFields.includes('type')?{previous:current.type,current:person.type}:null;
  const changedStatus=updatedFields.includes('status')?{previous:current.status,current:person.status}:null;
  event=await emitAriaEvent({
   organizationId,personId,type:'PERSON_UPDATED',source:'people_edit',
   actorId:actor.id,actorRole:actor.role,evidenceKind:'human_report',verificationStatus:'reported',
   confidence:.99,scopeLevel:'person',
   metadata:{
    updated_fields:[...new Set(updatedFields.map(x=>({first_name:'full_name',last_name:'full_name',display_name:'full_name'}[x]||x)))],
    change_source:'people_edit_screen',
    ...(changedType?{person_type_change:changedType}:{}),
    ...(changedStatus?{person_status_change:changedStatus}:{})
   },
   eventKey:'aria-person-edit:'+organizationId+':'+personId+':'+Date.now()
  },client);

  await client.query('COMMIT');
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{
  client.release();
 }

 if(event){
  try{
   const{directAriaEvent}=await import('./director');
   await directAriaEvent(event);
  }catch(error){
   // The event was committed with the person update and remains available to
   // the durable ARIA event worker if inline synchronization is unavailable.
   console.error('[ARIA] Person edit event queued for background processing:',error?.message||error);
  }
 }
 return{updated:true,person,updated_fields:[...new Set(updatedFields.map(x=>({first_name:'full_name',last_name:'full_name',display_name:'full_name'}[x]||x)))],previous,event_id:event?.id||null};
}


async function previewBulkPeopleType({organizationId,target,source}){
 const counts=(await pool.query(
  "SELECT COUNT(*)::int AS active_count,COUNT(*) FILTER(WHERE type=$2)::int AS already_target_count,COUNT(*) FILTER(WHERE type IS DISTINCT FROM $2 AND ($3::text IS NULL OR type=$3))::int AS eligible_count,md5(COALESCE(string_agg(id::text,',' ORDER BY id) FILTER(WHERE type IS DISTINCT FROM $2 AND ($3::text IS NULL OR type=$3)),'')) AS cohort_signature FROM people WHERE organization_id=$1 AND status='active'",
  [organizationId,target,source]
 )).rows[0]||{};
 const eligibleCount=Number(counts.eligible_count)||0;
 if(!eligibleCount)return{capability:'bulk_update_people_type',completed:true,updated:false,updated_count:0,target_type:target,source_type:source,total_active_count:Number(counts.active_count)||0,already_target_count:Number(counts.already_target_count)||0};
 const sample=(await pool.query(
  "SELECT COALESCE(NULLIF(display_name,''),TRIM(CONCAT_WS(' ',first_name,last_name)),'Unnamed person') AS name FROM people WHERE organization_id=$1 AND status='active' AND type IS DISTINCT FROM $2 AND ($3::text IS NULL OR type=$3) ORDER BY display_name NULLS LAST,first_name,last_name,id LIMIT 5",
  [organizationId,target,source]
 )).rows;
 return{capability:'bulk_update_people_type',requires_confirmation:true,target_type:target,source_type:source,eligible_count:eligibleCount,total_active_count:Number(counts.active_count)||0,already_target_count:Number(counts.already_target_count)||0,sample:sample.map(p=>({name:p.name})),cohort_signature:String(counts.cohort_signature||'')};
}

export async function bulkUpdatePeopleType({organizationId,actorId,targetType='member',sourceType=null,confirmed=false,expectedCount=null,expectedSignature=null}){
 const target=String(targetType||'').trim().toLowerCase();
 const source=sourceType==null||String(sourceType).trim()===''?null:String(sourceType).trim().toLowerCase();
 if(!['member','visitor'].includes(target))throw Object.assign(new Error('Bulk People type must be member or visitor.'),{status:400});
 if(source&&!['member','visitor'].includes(source))throw Object.assign(new Error('The source People type must be member or visitor.'),{status:400});

 const actor=(await pool.query("SELECT id,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId])).rows[0];
 if(!actor||!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});
 if(!confirmed)return previewBulkPeopleType({organizationId,target,source});

 // A confirmation is bound to the reviewed cohort. No unpreviewed new person may
 // be changed, and any changed cohort requires a fresh human confirmation.
 const hasSnapshot=Number.isInteger(Number(expectedCount))&&Number(expectedCount)>=0&&/^[a-f0-9]{32}$/i.test(String(expectedSignature||''));
 if(!hasSnapshot){
  const preview=await previewBulkPeopleType({organizationId,target,source});
  return{...preview,stale_preview:true};
 }

 const client=await pool.connect();
 let event=null,result=null;
 try{
  await client.query('BEGIN');
  const currentActor=(await client.query("SELECT id,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1 FOR UPDATE",[actorId,organizationId])).rows[0];
  if(!currentActor||!['owner','admin'].includes(currentActor.role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});
  const candidates=(await client.query(
   "SELECT id FROM people WHERE organization_id=$1 AND status='active' AND type IS DISTINCT FROM $2 AND ($3::text IS NULL OR type=$3) ORDER BY id FOR UPDATE",
   [organizationId,target,source]
  )).rows;
  const ids=candidates.map(row=>String(row.id));
  const liveSignature=createHash('md5').update(ids.join(',')).digest('hex');
  if(ids.length!==Number(expectedCount)||liveSignature!==String(expectedSignature).toLowerCase()){
   await client.query('ROLLBACK');
   const refreshed=await previewBulkPeopleType({organizationId,target,source});
   if(refreshed.requires_confirmation)return{...refreshed,stale_preview:true};
   return{...refreshed,stale_preview:true};
  }

  const updated=await client.query(
   "UPDATE people SET type=$1,updated_at=NOW() WHERE organization_id=$2 AND status='active' AND id=ANY($3::uuid[]) AND type IS DISTINCT FROM $1 AND ($4::text IS NULL OR type=$4)",
   [target,organizationId,ids,source]
  );
  const updatedCount=Number(updated.rowCount)||0;
  if(updatedCount!==Number(expectedCount)){
   await client.query('ROLLBACK');
   const refreshed=await previewBulkPeopleType({organizationId,target,source});
   return{...refreshed,stale_preview:true};
  }
  if(updatedCount){
   event=await emitAriaEvent({
    organizationId,type:'PEOPLE_TYPE_BULK_UPDATED',source:'aria_bulk_people_type',
    actorId:currentActor.id,actorRole:currentActor.role,evidenceKind:'human_report',
    verificationStatus:'reported',confidence:.99,scopeLevel:'organization',
    metadata:{target_type:target,source_type:source,updated_count:updatedCount,record_scope:'reviewed_active_people',changed_field:'type',cohort_signature:liveSignature},
    eventKey:'aria-bulk-people-type:'+organizationId+':'+currentActor.id+':'+target+':'+(source||'all')+':'+Date.now()
   },client);
  }
  await client.query('COMMIT');
  result={capability:'bulk_update_people_type',completed:true,updated:updatedCount>0,updated_count:updatedCount,target_type:target,source_type:source,event_id:event?.id||null};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{
  client.release();
 }
 if(event){
  try{
   const{directAriaEvent}=await import('./director');
   await directAriaEvent(event);
  }catch(error){
   console.error('[ARIA] Bulk People update event queued for background processing:',error?.message||error);
  }
 }
 return result;
}
