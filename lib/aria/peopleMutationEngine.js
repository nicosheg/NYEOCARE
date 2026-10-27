import pool from'../db';
import{normalizePhone}from'../phoneUtils';
import{normalizeDisplayName}from'../scanValidation';
import{emitAriaEvent}from'./eventEmitter';import{createHash}from'node:crypto';

const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const splitName=value=>{const n=normalizeDisplayName(value),parts=n.core.split(/\s+/).filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' '),display_name:n.display}};
export const identityNameKey=value=>normalizeDisplayName(value).core.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
export async function findIdentityCandidates(organizationId,nameKey,phone,db=pool,excludePersonId=null){
 const digits=String(phone||'').replace(/\D/g,'');
 const localDigits=digits.startsWith('234')?'0'+digits.slice(3):digits;
 const phoneVariants=[...new Set([digits,localDigits].filter(Boolean))];
 const phoneMatchExpr="($2::text IS NOT NULL AND (p.phone=$2 OR regexp_replace(COALESCE(p.phone,''), '[^0-9]', '', 'g')=ANY($4::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p.phone_numbers,'[]'::jsonb)) v WHERE v->>'normalized'=$2 OR regexp_replace(COALESCE(v->>'normalized',''), '[^0-9]', '', 'g')=ANY($4::text[]) OR regexp_replace(COALESCE(v->>'raw',''), '[^0-9]', '', 'g')=ANY($4::text[]))))";
 const nameExpr="lower(regexp_replace(trim(COALESCE(NULLIF(CONCAT_WS(' ',p.first_name,p.last_name),''),p.display_name,'')), '[^a-zA-Z0-9]+', ' ', 'g'))";
 const displayExpr="COALESCE(NULLIF(p.display_name, ''::text), ((COALESCE(p.first_name, ''::text) || ' '::text) || COALESCE(p.last_name, ''::text)))";
 const result=await db.query(
  "WITH matches AS ("+
  " SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.type,p.status,p.created_at,"+
  " CASE WHEN "+phoneMatchExpr+" THEN TRUE ELSE FALSE END AS phone_match,"+
  " CASE WHEN "+displayExpr+" % $5::text THEN TRUE ELSE FALSE END AS similar_name "+
  " FROM people p WHERE p.organization_id=$1 AND p.status='active' AND p.id<>$6::uuid "+
  " AND (("+phoneMatchExpr+") OR ("+nameExpr+"=$3) OR ("+displayExpr+" % $5::text)) "+
  " UNION ALL "+
  " SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.type,p.status,p.created_at,"+
  " CASE WHEN "+phoneMatchExpr+" THEN TRUE ELSE FALSE END AS phone_match,"+
  " CASE WHEN "+displayExpr+" % $5::text THEN TRUE ELSE FALSE END AS similar_name "+
  " FROM people p WHERE p.organization_id=$1 AND p.status='inactive' AND p.id<>$6::uuid "+
  " AND (("+phoneMatchExpr+") OR ("+nameExpr+"=$3) OR ("+displayExpr+" % $5::text)) "+
  ") SELECT * FROM matches ORDER BY CASE WHEN phone_match THEN 0 WHEN similar_name THEN 1 ELSE 2 END,created_at ASC LIMIT 20",
  [organizationId,phone||null,nameKey||'',phoneVariants,nameKey||'',excludePersonId||'00000000-0000-0000-0000-000000000000']
 );
 return result.rows.map(row=>{
  const displayName=row.display_name||[row.first_name,row.last_name].filter(Boolean).join(' ')||row.first_name||'Unnamed person';
  return {
   id:String(row.id),first_name:row.first_name||'',last_name:row.last_name||'',
   display_name:displayName,phone:row.phone||null,email:row.email||null,
   type:row.type||null,status:row.status||null,
   name_match:identityNameKey(displayName)===nameKey,
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
export async function createPerson({organizationId,actorId,name,phone=null,birthday=null,type='visitor'}){
 const actor=(await pool.query("SELECT id,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId])).rows[0];
 if(!actor||!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});
 const rawName=clean(name,200);
 const parsed=splitName(rawName);
 if(!parsed.first_name)throw Object.assign(new Error('A name is required.'),{status:400});
 const normalized=phone?normalizePhone(phone):null;
 if(phone&&!normalized)throw Object.assign(new Error('That phone number is incomplete or invalid.'),{status:400});
 if(!['member','visitor'].includes(String(type||'visitor').toLowerCase()))throw Object.assign(new Error('Type must be member or visitor.'),{status:400});
 let dob=null;
 if(birthday){
  dob=String(birthday).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dob))throw Object.assign(new Error('Birthday must use YYYY-MM-DD.'),{status:400});
 }
 if(normalized){
  const duplicate=(await pool.query("SELECT id,display_name,phone FROM people WHERE organization_id=$1 AND status='active' AND(phone=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(phone_numbers,'[]'::jsonb)) x WHERE x->>'normalized'=$2)) LIMIT 1",[organizationId,normalized])).rows[0];
  if(duplicate)throw Object.assign(new Error('That phone number already belongs to '+(duplicate.display_name||'another person')+'.'),{status:409,code:'DUPLICATE_ACTIVE_PERSON',person:duplicate});
 }
 const person=(await pool.query(`INSERT INTO people(organization_id,first_name,last_name,display_name,phone,type,birthday,created_by,living_truth,status,source)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','aria') RETURNING id,organization_id,first_name,last_name,display_name,phone,type,birthday,status,source,created_at,updated_at`,
   [organizationId,parsed.first_name,parsed.last_name,parsed.display_name||null,normalized,String(type||'visitor').toLowerCase(),dob,actor.id,
    JSON.stringify({status:'alive',confidence:90,source:'aria_direct_create',updated_at:new Date().toISOString()})])).rows[0];
 const event=await emitAriaEvent({
  organizationId,personId:person.id,type:'PERSON_CREATED',source:'aria_direct_create',actorId:actor.id,actorRole:actor.role,
  evidenceKind:'human_report',verificationStatus:'reported',confidence:.99,
  metadata:{name_source:'operator_command',phone_source:normalized?'operator_command':'not_supplied',birthday_source:dob?'operator_command':'not_supplied'},
  eventKey:'aria-person-create:'+person.id
 });
 return{created:true,person,event_id:event?.id||null};
}

export async function importPeopleRoster({organizationId,actorId,text}){
 const role=(await pool.query("SELECT role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId])).rows[0]?.role;
 if(!['owner','admin'].includes(role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});
 const parsed=parsePeopleRoster(text,{normalizePhone});
 if(!parsed.rows.length)return{created:[],existing:[],invalid:[],ignored:parsed.ignored,message:'I could not safely find person rows with names and phone numbers.'};
 const created=[],existing=[],invalid=[];
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const row of parsed.rows){
   let normalized=normalizePhone(row.phone);
   if(row.phone&&!normalized){invalid.push({...row,reason:'Phone number is incomplete or invalid.'});normalized=null}
   const existingByPhone=normalized?(await client.query("SELECT id,first_name,last_name,display_name,phone FROM people WHERE organization_id=$1 AND status='active' AND(phone=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(phone_numbers,'[]'::jsonb)) x WHERE x->>'normalized'=$2)) LIMIT 1",[organizationId,normalized])).rows[0]:null;
   const normalizedName=normalizeDisplayName(row.name).core.toLowerCase();
   const existingByName=existingByPhone||((await client.query("SELECT id,first_name,last_name,display_name,phone FROM people WHERE organization_id=$1 AND status='active' AND lower(regexp_replace(trim(coalesce(display_name,concat_ws(' ',first_name,last_name))),'[^a-z0-9]+',' ','g'))=$2 ORDER BY created_at ASC LIMIT 1",[organizationId,normalizedName])).rows[0]||null);
   if(existingByName){
    if(normalized&&!existingByName.phone&&existingByName.id){
     const updated=(await client.query("UPDATE people SET phone=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 AND status='active' AND COALESCE(phone,'')='' RETURNING id,display_name,phone",[normalized,existingByName.id,organizationId])).rows[0];
     existing.push({...row,person_id:existingByName.id,name:existingByName.display_name||row.name,normalized_phone:updated?.phone||normalized,updated_existing:true});
    }else{
     const conflict=Boolean(normalized&&existingByName.phone&&existingByName.phone!==normalized);
     if(conflict)invalid.push({...row,reason:'A person with this exact name already exists with a different phone number. Review before changing it.'});
     existing.push({...row,person_id:existingByName.id,name:existingByName.display_name||row.name,normalized_phone:existingByName.phone||normalized,phone_conflict:conflict});
    }
    continue
   }
   const name=splitName(row.name);
   const person=(await client.query("INSERT INTO people(organization_id,first_name,last_name,display_name,phone,type,created_by,living_truth,status,source) VALUES($1,$2,$3,$4,$5,'visitor',$6,$7,'active','aria') RETURNING id,first_name,last_name,display_name,phone",[organizationId,name.first_name,name.last_name,name.display_name||null,normalized,actorId,JSON.stringify({status:'alive',confidence:88,source:'aria_roster_import',updated_at:new Date().toISOString()})])).rows[0];
   const event=await emitAriaEvent({organizationId,personId:person.id,type:'PERSON_CREATED',source:'aria_roster_import',actorId,evidenceKind:'human_report',verificationStatus:'reported',confidence:.95,metadata:{name_source:'operator_text',phone_source:row.phone?'operator_text':'missing'}},client);
   created.push({...row,person_id:person.id,name:person.display_name||row.name,normalized_phone:person.phone,event_id:event?.id||null});
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
 return{created,existing,invalid,ignored:parsed.ignored,message:'Saved '+created.length+' new people. '+existing.length+' matched existing records. '+invalid.length+' phone entries need review.'};
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
   "SELECT id,organization_id,first_name,last_name,display_name,phone,email,birthday,type,status,living_truth FROM people WHERE id=$1::uuid AND organization_id=$2 AND status IN('active','inactive') LIMIT 1 FOR UPDATE",
   [personId,organizationId]
  )).rows[0];
  if(!current)throw Object.assign(new Error('Person not found or archived.'),{status:404});
  previous=current;
  let nextDisplayName=current.display_name||[current.first_name,current.last_name].filter(Boolean).join(' ');
  let nextPhone=normalizePhone(current.phone||'')||String(current.phone||'').trim()||null;

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
  if(fields.phone!==undefined){
   const rawPhone=String(fields.phone??'').trim();
   const phone=rawPhone?normalizePhone(rawPhone):null;
   if(rawPhone&&!phone)throw Object.assign(new Error('That phone number is incomplete or invalid.'),{status:400,code:'INVALID_PHONE'});
   const currentPhone=normalizePhone(current.phone||'')||String(current.phone||'').trim()||null;
   if(phone!==currentPhone){
    add('phone',phone);
    nextPhone=phone;
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

  let identityCandidates=[];
  const identityFieldsChanged=updatedFields.some(field=>['first_name','last_name','display_name','phone'].includes(field));
  if(identityFieldsChanged){
   const incomingNameKey=identityNameKey(nextDisplayName);
   identityCandidates=await findIdentityCandidates(organizationId,incomingNameKey,nextPhone,client,personId);
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
   "UPDATE people SET "+updates.join(',')+" WHERE id=$"+idIndex+"::uuid AND organization_id=$"+organizationIndex+" AND status IN('active','inactive') RETURNING id,organization_id,first_name,last_name,display_name,phone,email,birthday,type,status,living_truth,source,created_at,updated_at",
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
