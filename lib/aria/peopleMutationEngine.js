import pool from'../db';
import{normalizePhone}from'../phoneUtils';
import{normalizeDisplayName}from'../scanValidation';
import{emitAriaEvent}from'./eventEmitter';

const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const splitName=value=>{const n=normalizeDisplayName(value),parts=n.core.split(/\s+/).filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' '),display_name:n.display}};
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

export async function updatePersonRecord({organizationId,actorId,personId,fields}){
 const actor=(await pool.query("SELECT id,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId])).rows[0];
 if(!actor||!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});
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
    if(phone){
     const dup=(await client.query(
      "SELECT id,display_name FROM people WHERE organization_id=$1 AND status IN('active','inactive') AND id<>$2::uuid AND(phone=$3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(phone_numbers,'[]'::jsonb)) x WHERE x->>'normalized'=$3)) LIMIT 1",
      [organizationId,personId,phone]
     )).rows[0];
     if(dup)throw Object.assign(new Error('That phone number already belongs to '+(dup.display_name||'another person')+'.'),{status:409,code:'DUPLICATE_ACTIVE_PERSON'});
    }
    add('phone',phone);
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

export async function bulkUpdatePeopleType({organizationId,actorId,targetType='member',sourceType=null,confirmed=false}){
 const target=String(targetType||'').trim().toLowerCase();
 const source=sourceType==null||String(sourceType).trim()===''?null:String(sourceType).trim().toLowerCase();
 if(!['member','visitor'].includes(target))throw Object.assign(new Error('Bulk People type must be member or visitor.'),{status:400});
 if(source&&!['member','visitor'].includes(source))throw Object.assign(new Error('The source People type must be member or visitor.'),{status:400});

 const actor=(await pool.query("SELECT id,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId])).rows[0];
 if(!actor||!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});

 if(!confirmed){
  const counts=(await pool.query(
   "SELECT COUNT(*)::int AS active_count, COUNT(*) FILTER(WHERE type=$2)::int AS already_target_count, COUNT(*) FILTER(WHERE type IS DISTINCT FROM $2 AND ($3::text IS NULL OR type=$3))::int AS eligible_count FROM people WHERE organization_id=$1 AND status='active'",
   [organizationId,target,source]
  )).rows[0]||{};
  const eligibleCount=Number(counts.eligible_count)||0;
  if(!eligibleCount)return{capability:'bulk_update_people_type',completed:true,updated:false,updated_count:0,target_type:target,source_type:source,total_active_count:Number(counts.active_count)||0,already_target_count:Number(counts.already_target_count)||0};
  const sample=(await pool.query(
   "SELECT COALESCE(NULLIF(display_name,''),TRIM(CONCAT_WS(' ',first_name,last_name)),'Unnamed person') AS name FROM people WHERE organization_id=$1 AND status='active' AND type IS DISTINCT FROM $2 AND ($3::text IS NULL OR type=$3) ORDER BY display_name NULLS LAST,first_name,last_name,id LIMIT 5",
   [organizationId,target,source]
  )).rows;
  return{capability:'bulk_update_people_type',requires_confirmation:true,target_type:target,source_type:source,eligible_count:eligibleCount,total_active_count:Number(counts.active_count)||0,already_target_count:Number(counts.already_target_count)||0,sample:sample.map(p=>({name:p.name}))};
 }

 const client=await pool.connect();
 let event=null,result=null;
 try{
  await client.query('BEGIN');
  const currentActor=(await client.query("SELECT id,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1 FOR UPDATE",[actorId,organizationId])).rows[0];
  if(!currentActor||!['owner','admin'].includes(currentActor.role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});
  const updated=await client.query(
   "UPDATE people SET type=$1,updated_at=NOW() WHERE organization_id=$2 AND status='active' AND type IS DISTINCT FROM $1 AND ($3::text IS NULL OR type=$3)",
   [target,organizationId,source]
  );
  const updatedCount=Number(updated.rowCount)||0;
  if(updatedCount){
   event=await emitAriaEvent({
    organizationId,type:'PEOPLE_TYPE_BULK_UPDATED',source:'aria_bulk_people_type',
    actorId:currentActor.id,actorRole:currentActor.role,evidenceKind:'human_report',
    verificationStatus:'reported',confidence:.99,scopeLevel:'organization',
    metadata:{target_type:target,source_type:source,updated_count:updatedCount,record_scope:'active_people',changed_field:'type'},
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
