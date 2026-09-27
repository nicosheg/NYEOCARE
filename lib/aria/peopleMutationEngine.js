import pool from'../db';
import{normalizePhone}from'../phoneUtils';
import{normalizeDisplayName}from'../scanValidation';
import{emitAriaEvent}from'./eventEmitter';

const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const splitName=value=>{const n=normalizeDisplayName(value),parts=n.core.split(/\s+/).filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' '),display_name:n.display}};
const digits=v=>String(v??'').replace(/\D/g,'');
const looksPhone=line=>{const d=digits(line);return d.length>=10&&d.length<=13&&/^[+\d\s().-]+$/.test(String(line||'').trim())};
const instructionLine=line=>/^(please|kindly|call|let'?s|let us|the following|these are|our women|women that|please let)\b/i.test(String(line||'').trim());
const looksName=line=>{const v=String(line||'').trim();if(v.length<2||v.length>100||looksPhone(v)||instructionLine(v)||!/[a-zA-Z]/.test(v))return false;return/^(mummy|mama|sis|sister|bro|brother|mr|mrs|miss|ms|pastor|pst|elder|deacon|deaconess|rev|chief)\b/i.test(v)||v.split(/\s+/).length>=2||v===v.toUpperCase()};

export function parsePeopleRoster(text){
 const lines=String(text||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);
 const rows=[],ignored=[];let pending=null,lastRow=null;
 for(const line of lines){
  if(looksPhone(line)){
   if(pending){rows.push({name:pending.name,phone:line,note:pending.note||null});lastRow=rows[rows.length-1];pending=null}
   else if(lastRow)lastRow.note=lastRow.note?lastRow.note+' '+line:line;
   continue;
  }
  if(looksName(line)){
   if(pending)rows.push({name:pending.name,phone:null,note:pending.note||null});
   pending={name:line,note:null};
   continue;
  }
  if(lastRow&&/\b(strong|please)\b/i.test(line)){lastRow.note=lastRow.note?lastRow.note+' '+line:line;continue}
  ignored.push(line);
 }
 if(pending)rows.push({name:pending.name,phone:null,note:pending.note||null});
 const dedup=new Map();
 for(const row of rows){
  const key=(row.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+'|'+(normalizePhone(row.phone)||'');
  if(!dedup.has(key))dedup.set(key,row);
 }
 return{rows:[...dedup.values()].slice(0,100),ignored:ignored.slice(0,20)};
}

export async function importPeopleRoster({organizationId,actorId,text}){
 const parsed=parsePeopleRoster(text);
 if(!parsed.rows.length)return{created:[],existing:[],invalid:[],ignored:parsed.ignored,message:'I could not safely find person rows with names and phone numbers.'};
 const created=[],existing=[],invalid=[];
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const row of parsed.rows){
   let normalized=normalizePhone(row.phone);
   if(row.phone&&!normalized){invalid.push({...row,reason:'Phone number is incomplete or invalid.'});normalized=null}
   const existingByPhone=normalized?(await client.query("SELECT id,first_name,last_name,display_name,phone FROM people WHERE organization_id=$1 AND status='active' AND(phone=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(phone_numbers,'[]'::jsonb)) x WHERE x->>'normalized'=$2) LIMIT 1",[organizationId,normalized])).rows[0]:null;
   const normalizedName=normalizeDisplayName(row.name).core.toLowerCase();
   const existingByName=existingByPhone||((await client.query("SELECT id,first_name,last_name,display_name,phone FROM people WHERE organization_id=$1 AND status='active' AND lower(regexp_replace(trim(coalesce(display_name,concat_ws(' ',first_name,last_name))),'[^a-z0-9]+',' ','g'))=$2 ORDER BY created_at ASC LIMIT 1",[organizationId,normalizedName])).rows[0]||null);
   if(existingByName){existing.push({...row,person_id:existingByName.id,name:existingByName.display_name||row.name,normalized_phone:existingByName.phone||normalized});continue}
   const name=splitName(row.name);
   const person=(await client.query("INSERT INTO people(organization_id,first_name,last_name,display_name,phone,type,created_by,living_truth,status,source) VALUES($1,$2,$3,$4,$5,'visitor',$6,$7,'active','aria') RETURNING id,first_name,last_name,display_name,phone",[organizationId,name.first_name,name.last_name,name.display_name||null,normalized,actorId,JSON.stringify({status:'alive',confidence:88,source:'aria_roster_import',updated_at:new Date().toISOString()})])).rows[0];
   const event=await emitAriaEvent({organizationId,personId:person.id,type:'PERSON_CREATED',source:'aria_roster_import',actorId,evidenceKind:'human_report',verificationStatus:'reported',confidence:.95,metadata:{name_source:'operator_text',phone_source:row.phone?'operator_text':'missing',note:row.note||null}},client);
   created.push({...row,person_id:person.id,name:person.display_name||row.name,normalized_phone:person.phone,event_id:event?.id||null});
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
 return{created,existing,invalid,ignored:parsed.ignored,message:'Saved '+created.length+' new people. '+existing.length+' matched existing records. '+invalid.length+' phone entries need review.'};
}

export async function updatePersonRecord({organizationId,actorId,personId,fields}){
 const role=(await pool.query("SELECT role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId])).rows[0]?.role;
 if(!['owner','admin'].includes(role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});
 const current=(await pool.query("SELECT id,first_name,last_name,display_name,phone,email,birthday,living_truth FROM people WHERE id=$1 AND organization_id=$2 AND status='active' AND living_truth->>'status' NOT IN('needs_decision','conflict') LIMIT 1",[personId,organizationId])).rows[0];
 if(!current)throw Object.assign(new Error('Person not found.'),{status:404});
 const updates=[],values=[];let n=1;
 if(fields.full_name!==undefined){const parsed=splitName(fields.full_name);if(!parsed.first_name)throw Object.assign(new Error('Name cannot be empty.'),{status:400});updates.push('first_name=$'+n++,'last_name=$'+n++,'display_name=$'+n++);values.push(parsed.first_name,parsed.last_name,parsed.display_name||null)}
 if(fields.phone!==undefined){const phone=normalizePhone(fields.phone);if(!phone)throw Object.assign(new Error('That phone number is incomplete or invalid.'),{status:400});const dup=(await pool.query("SELECT id,display_name FROM people WHERE organization_id=$1 AND status='active' AND id<>$2 AND(phone=$3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(phone_numbers,'[]'::jsonb)) x WHERE x->>'normalized'=$3) LIMIT 1",[organizationId,personId,phone])).rows[0];if(dup)throw Object.assign(new Error('That phone number already belongs to '+(dup.display_name||'another person')+'.'),{status:409});updates.push('phone=$'+n++);values.push(phone)}
 if(fields.birthday!==undefined){const birthday=String(fields.birthday||'').trim();if(birthday&&!/^\d{4}-\d{2}-\d{2}$/.test(birthday))throw Object.assign(new Error('Birthday must use YYYY-MM-DD.'),{status:400});updates.push('birthday=$'+n++);values.push(birthday||null)}
 if(!updates.length)throw Object.assign(new Error('No supported person changes were supplied.'),{status:400});
 updates.push('updated_at=NOW()');values.push(personId,organizationId);
 const person=(await pool.query("UPDATE people SET "+updates.join(',')+" WHERE id=$"+n+" AND organization_id=$"+(n+1)+" AND status='active' RETURNING id,first_name,last_name,display_name,phone,email,birthday,living_truth",values)).rows[0];
 await emitAriaEvent({organizationId,personId,type:'PERSON_UPDATED',source:'aria_operator_confirmation',actorId,evidenceKind:'human_report',verificationStatus:'reported',confidence:.99,metadata:{updated_fields:Object.keys(fields),changes:fields}});
 return{updated:true,person,updated_fields:Object.keys(fields),previous:current};
}
