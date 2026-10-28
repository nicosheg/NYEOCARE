// pages/api/review/person-identity-action.js
// Resolves a durable person-creation identity review without ever treating a blocked draft as a person.
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { normalizePhone, normalizePhoneList, primaryPhone } from '../../../lib/phoneUtils';
import { normalizeDisplayName, normalizeName } from '../../../lib/scanValidation';
import { identityNameKey, findIdentityCandidates } from '../../../lib/aria/peopleMutationEngine';
import { personIdentityPayloadHash } from '../../../lib/personIdentityReviewQueue';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';
import { directAriaEvent } from '../../../lib/aria/director';

const operatorRoles=['owner','admin','leader','worker','user'];
function splitName(value){
  const n=normalizeDisplayName(value);
  const parts=String(n.core||'').split(/\\s+/).filter(Boolean);
  return {first_name:parts.shift()||'',last_name:parts.join(' '),display_name:n.display};
}
function validBirthday(value){
  if(!value)return null;
  const s=String(value).trim();
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(s))throw Object.assign(new Error('Birthday must use YYYY-MM-DD.'),{status:400,code:'INVALID_BIRTHDAY'});
  const p=s.split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1,p[2]));
  if(d.getUTCFullYear()!==p[0]||d.getUTCMonth()!==p[1]-1||d.getUTCDate()!==p[2])throw Object.assign(new Error('That birthday is not a valid calendar date.'),{status:400,code:'INVALID_BIRTHDAY'});
  return s;
}
function parseProposed(row,body){
  const old=row.proposed_payload&&typeof row.proposed_payload==='object'?row.proposed_payload:{};
  const rawName=String(body.name??old.display_name??old.full_name??'').trim();
  const parsed=splitName(rawName);
  if(!parsed.first_name)throw Object.assign(new Error('A name is required before this review can be saved.'),{status:400,code:'IDENTITY_REVIEW_NAME_REQUIRED'});
  if(rawName.length>200)throw Object.assign(new Error('Name is too long.'),{status:400,code:'IDENTITY_REVIEW_NAME_TOO_LONG'});
  const rawPhones=Array.isArray(body.phones)?body.phones:(Array.isArray(old.phone_numbers)?old.phone_numbers:[old.phone]);
  const phoneEntries=[],seen=new Set();
  for(const entry of rawPhones){
    const raw=typeof entry==='string'?entry:(entry?.raw||entry?.normalized||entry?.phone||'');
    if(!String(raw||'').trim())continue;
    const normalized=normalizePhone(raw);
    if(!normalized)throw Object.assign(new Error('One of the phone numbers is incomplete or invalid. Correct it or remove it before saving.'),{status:400,code:'INVALID_PHONE'});
    if(seen.has(normalized))continue;
    seen.add(normalized);
    phoneEntries.push({raw:String(raw).trim(),normalized,source:'identity_review',index:phoneEntries.length+1});
  }
  const type=String(body.type??old.type??'visitor').trim().toLowerCase();
  if(!['member','visitor'].includes(type))throw Object.assign(new Error('Type must be member or visitor.'),{status:400,code:'INVALID_PERSON_TYPE'});
  const email=String(body.email??old.email??'').trim().toLowerCase()||null;
  if(email&&(email.length>254||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)))throw Object.assign(new Error('Email address is invalid.'),{status:400,code:'INVALID_EMAIL'});
  const birthday=validBirthday(body.birthday??old.birthday??null);
  return {
    ...parsed,full_name:parsed.display_name,
    phone:phoneEntries[0]?.normalized||null,
    phone_numbers:phoneEntries,email,birthday,type,request_context:old.request_context||null
  };
}
function candidatePayload(candidate){
  const name=String(candidate.display_name||[candidate.first_name,candidate.last_name].filter(Boolean).join(' ')||'Unnamed person');
  return {
    id:String(candidate.id),organization_id:String(candidate.organization_id),display_name:name,
    first_name:candidate.first_name||'',last_name:candidate.last_name||'',
    phone:primaryPhone(candidate),phones:normalizePhoneList(candidate),
    type:candidate.type||'person',status:candidate.status||null,
    name_match:candidate.name_match===true,phone_match:candidate.phone_match===true,
    similar_name:candidate.similar_name===true
  };
}
async function currentCandidates(db,orgId,proposal){
  const nameKey=identityNameKey(proposal.display_name||proposal.full_name);
  const numbers=normalizePhoneList(proposal,{limit:4});
  const seen=new Map();
  for(const phone of [null,...numbers]){
    const matches=await findIdentityCandidates(orgId,nameKey,phone,db);
    for(const match of matches)seen.set(String(match.id),match);
  }
  return [...seen.values()].map(candidatePayload);
}
function sortedIds(values){return [...new Set((Array.isArray(values)?values:[]).map(String))].sort()}
function sameIds(a,b){const x=sortedIds(a),y=sortedIds(b);return x.length===y.length&&x.every((v,i)=>v===y[i])}
function identityEvidence(row,candidates,proposal,actorId,action,canonicalId=null){
  return {
    review_id:String(row.id),source:row.source||'manual_create',action,actor_id:actorId,
    proposed_payload:proposal,candidate_person_ids:candidates.map(c=>String(c.id)),
    candidate_evidence:candidates.map(c=>({id:c.id,name:c.display_name,phone:c.phone,status:c.status,name_match:c.name_match,phone_match:c.phone_match})),
    canonical_person_id:canonicalId,decided_at:new Date().toISOString()
  };
}
async function savePendingDraft(db,{row,orgId,actorId,proposal,candidates}){
  const hash=personIdentityPayloadHash(proposal);
  const evidence={code:'PERSON_IDENTITY_REVIEW_REQUIRED',review_reasons:candidates.map(c=>c.phone_match?'phone_already_used':c.name_match?'same_normalized_name':'similar_name'),matches:candidates};
  const update=await db.query(
    `UPDATE public.person_identity_review_items
     SET proposed_payload=$3::jsonb,payload_hash=$4,candidate_person_ids=$5::jsonb,
         match_evidence=$6::jsonb,updated_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND status='pending'
     RETURNING id,status,payload_hash`,
    [row.id,orgId,JSON.stringify(proposal),hash,JSON.stringify(candidates.map(c=>String(c.id))),JSON.stringify(evidence)]
  );
  if(update.rowCount!==1)throw Object.assign(new Error('This identity review is no longer pending. Reload Review Center before continuing.'),{status:409,code:'IDENTITY_REVIEW_NOT_PENDING'});
  return update.rows[0];
}
async function recordSeparatePair(db,{orgId,actorId,person,candidates,proposedPhones,reviewId}){
  for(const candidate of candidates){
    const evidence={source:'person_identity_review',review_id:String(reviewId),reason:'human_confirmed_distinct_people',actor_id:actorId,decided_at:new Date().toISOString(),incoming_person_id:String(person.id),matched_person_id:String(candidate.id)};
    await db.query(
      `INSERT INTO identity_pair_decisions(organization_id,person_a_id,person_b_id,decision,decided_by,evidence,updated_at)
       VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid),'keep_separate',$4,$5::jsonb,NOW())
       ON CONFLICT(organization_id,LEAST(person_a_id,person_b_id),GREATEST(person_a_id,person_b_id))
       DO UPDATE SET decision='keep_separate',decided_by=EXCLUDED.decided_by,evidence=EXCLUDED.evidence,updated_at=NOW()`,
      [orgId,person.id,candidate.id,actorId,JSON.stringify(evidence)]
    );
    const shared=normalizePhoneList(candidate,{limit:4}).filter(phone=>proposedPhones.includes(phone));
    for(const phone of shared){
      await db.query(
       `INSERT INTO identity_shared_contacts(organization_id,person_a_id,person_b_id,phone,confirmed_by,metadata)
        VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid),$4,$5,$6::jsonb)
        ON CONFLICT(organization_id,LEAST(person_a_id,person_b_id),GREATEST(person_a_id,person_b_id),phone)
        DO UPDATE SET confirmed_by=EXCLUDED.confirmed_by,confirmed_at=NOW(),metadata=EXCLUDED.metadata`,
       [orgId,person.id,candidate.id,phone,actorId,JSON.stringify({source:'person_identity_review',review_id:String(reviewId),reason:'human_confirmed_shared_contact'})]
      );
    }
  }
}
async function upsertCreateRequest(db,{orgId,requestId,payloadHash,personId,actorId}){
  const existing=(await db.query(
    `SELECT payload_hash,person_id FROM public.person_create_requests
     WHERE organization_id=$1 AND client_request_id=$2 FOR UPDATE`,
    [orgId,requestId]
  )).rows[0];
  if(existing){
    if(existing.payload_hash!==payloadHash||String(existing.person_id)!==String(personId)){
      throw Object.assign(new Error('This creation request was already used for different details. The identity review remains pending; refresh before retrying.'),{status:409,code:'PERSON_CREATE_REQUEST_ID_REUSED'});
    }
    return;
  }
  await db.query(
    `INSERT INTO public.person_create_requests(organization_id,client_request_id,payload_hash,person_id,created_by)
     VALUES($1,$2,$3,$4,$5)`,
    [orgId,requestId,payloadHash,personId,actorId]
  );
}
async function resolveReview(db,{row,orgId,actorId,personId,action,evidence}){
  const done=await db.query(
    `UPDATE public.person_identity_review_items
     SET status='resolved',decision=$3::jsonb,resolved_by=$4,resolved_person_id=$5,resolved_at=NOW(),updated_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND status='pending'
     RETURNING id,status,resolved_person_id`,
    [row.id,orgId,JSON.stringify(evidence),actorId,personId]
  );
  if(done.rowCount!==1||done.rows[0]?.status!=='resolved'||String(done.rows[0]?.resolved_person_id)!==String(personId)){
    throw Object.assign(new Error('NYEOCARE could not verify that the identity review was resolved. The transaction was rolled back and the review remains pending.'),{status:409,code:'IDENTITY_REVIEW_RESOLUTION_VERIFICATION_FAILED'});
  }
}
export default withOrg(async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'})}
  if(!operatorRoles.includes(String(req.user?.role||'').toLowerCase()))return res.status(403).json({error:'Authorized organization operator permissions required.'});
  const {id,action,canonicalId}=req.body||{};
  if(!id||!['merge','keep_separate','edit'].includes(action))return res.status(400).json({error:'Invalid identity review action.'});
  const db=await pool.connect();
  let finished=false,eventData=null;
  try{
    await db.query('BEGIN');
    const found=(await db.query(
      `SELECT * FROM public.person_identity_review_items
       WHERE id=$1 AND organization_id=$2 AND status='pending' FOR UPDATE`,
      [String(id).replace(/^identity:/,''),req.org.id]
    )).rows[0];
    if(!found){await db.query('ROLLBACK');finished=true;return res.status(404).json({error:'This identity review is no longer pending. Refresh Review Center.',code:'IDENTITY_REVIEW_NOT_FOUND'})}
    const proposal=parseProposed(found,req.body||{});
    const payloadHash=personIdentityPayloadHash(proposal);
    const candidates=await currentCandidates(db,req.org.id,proposal);
    const persistedIds=Array.isArray(found.candidate_person_ids)?found.candidate_person_ids.map(String):[];
    const freshIds=candidates.map(c=>String(c.id));
    if(action==='edit'){
      const saved=await savePendingDraft(db,{row:found,orgId:req.org.id,actorId:req.user.id,proposal,candidates});
      await db.query('COMMIT');finished=true;
      return res.status(200).json({ok:true,verified:true,persisted:true,review_status:'pending',review_id:found.id,payload_hash:saved.payload_hash});
    }
    if(!sameIds(persistedIds,freshIds)){
      await savePendingDraft(db,{row:found,orgId:req.org.id,actorId:req.user.id,proposal,candidates});
      await db.query('COMMIT');finished=true;
      return res.status(409).json({error:'The possible matches changed while this review was open. The review remains pending with updated candidates; inspect it again before deciding.',code:'PERSON_IDENTITY_REVIEW_STALE',review_id:found.id,review_status:'pending',candidates});
    }
    const proposedPhones=normalizePhoneList(proposal,{limit:4});
    let person=null,finalId=null;
    if(action==='merge'){
      if(!canonicalId)throw Object.assign(new Error('Select the existing person you want to keep as the main record.'),{status:400,code:'CANONICAL_PERSON_REQUIRED'});
      const selected=candidates.find(c=>String(c.id)===String(canonicalId));
      if(!selected)throw Object.assign(new Error('The selected person is no longer a current identity match. Refresh Review Center and select a current record.'),{status:409,code:'INVALID_CANONICAL_PERSON'});
      person=(await db.query(
        `SELECT * FROM people WHERE id=$1 AND organization_id=$2 AND status='active' FOR UPDATE`,
        [String(canonicalId),req.org.id]
      )).rows[0];
      if(!person)throw Object.assign(new Error('The selected person is no longer active. Refresh Review Center and choose another current record, or keep the proposed person separate.'),{status:409,code:'CANONICAL_PERSON_NOT_ACTIVE'});
      const existingPhones=normalizePhoneList(person,{limit:4});
      const mergedPhones=[...new Set([...existingPhones,...proposedPhones])].slice(0,4);
      const primary=primaryPhone(person)||mergedPhones[0]||null;
      const orderedPhones=mergedPhones.map((phone,index)=>{
        const existing=(Array.isArray(person.phone_numbers)?person.phone_numbers:[]).find(entry=>normalizePhone(entry?.normalized||entry?.raw||entry?.phone)===phone);
        return existing&&typeof existing==='object'?{...existing,normalized:phone,raw:existing.raw||phone,index:index+1}:{raw:phone,normalized:phone,source:'identity_review_merge',index:index+1};
      });
      const meta={review_id:String(found.id),actor_id:req.user.id,proposed_name:proposal.display_name,merged_at:new Date().toISOString(),source:found.source||'manual_create'};
      const saved=(await db.query(
        `UPDATE people SET phone=$3,phone_numbers=$4::jsonb,
          email=COALESCE(NULLIF(email,''),$5),birthday=COALESCE(birthday,$6::date),
          type=CASE WHEN type='visitor' AND $7='member' THEN 'member' ELSE type END,
          identity_verification_status='verified',identity_verified_at=NOW(),
          identity_verified_by=$8,identity_verification_source='human_identity_review',
          metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('last_identity_merge',$9::jsonb),
          updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 AND status='active'
         RETURNING id,organization_id,first_name,last_name,display_name,phone,phone_numbers,email,birthday,type,status,identity_verification_status`,
        [person.id,req.org.id,primary,JSON.stringify(orderedPhones),proposal.email,proposal.birthday,proposal.type,req.user.id,JSON.stringify(meta)]
      )).rows[0];
      if(!saved||String(saved.id)!==String(person.id)||saved.status!=='active')throw Object.assign(new Error('NYEOCARE could not verify the main person record after merge. The review remains pending.'),{status:409,code:'IDENTITY_MERGE_VERIFICATION_FAILED'});
      const savedPhones=normalizePhoneList(saved,{limit:4});
      if(proposedPhones.some(phone=>!savedPhones.includes(phone)))throw Object.assign(new Error('A proposed contact number could not be retained on the main person record. The review remains pending.'),{status:409,code:'IDENTITY_MERGE_CONTACT_VERIFICATION_FAILED'});
      if(normalizeName(proposal.display_name)!==normalizeName(saved.display_name||[saved.first_name,saved.last_name].filter(Boolean).join(' '))){
        await db.query(
          `INSERT INTO person_aliases(organization_id,person_id,alias,created_by)
           SELECT $1,$2,$3,$4
           WHERE NOT EXISTS(SELECT 1 FROM person_aliases WHERE organization_id=$1 AND person_id=$2 AND lower(alias)=lower($3))`,
          [req.org.id,person.id,proposal.display_name,req.user.id]
        );
      }
      person=saved;finalId=String(saved.id);
    }else if(action==='keep_separate'){
      const parts=splitName(proposal.display_name);
      const now=new Date().toISOString();
      const phoneNumbers=proposedPhones.map((phone,index)=>({raw:phone,normalized:phone,source:'person_identity_review',index:index+1}));
      const requestContext=proposal.request_context&&typeof proposal.request_context==='object'?proposal.request_context:null;
      const personMetadata={
        ...(requestContext?.kind==='attendance_add_visitor'?{
          attendance_add_visitor_request_id:String(requestContext.request_id||''),
          attendance_add_visitor_session_id:String(requestContext.session_id||''),
          ...(proposedPhones.length?{contact_consent:{phone:true,status:requestContext.contact_consent===true?'granted':'unknown',source:'attendance_add_visitor',recorded_by:req.user.id,recorded_at:now}}:{})
        }:{}),
        identity_review:{review_id:String(found.id),source:found.source||'manual_create',action:'keep_separate',decided_by:req.user.id,decided_at:now}
      };
      person=(await db.query(
        `INSERT INTO people(
          organization_id,first_name,last_name,display_name,phone,phone_numbers,email,type,birthday,
          created_by,metadata,living_truth,status,source,identity_verification_status,identity_verified_at,identity_verified_by,identity_verification_source
        ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::date,$10,$11::jsonb,$12::jsonb,'active','manual','verified',NOW(),$10,'human_identity_review')
        RETURNING id,organization_id,first_name,last_name,display_name,phone,phone_numbers,email,type,birthday,status,identity_verification_status`,
        [req.org.id,parts.first_name,parts.last_name,proposal.display_name||null,proposedPhones[0]||null,JSON.stringify(phoneNumbers),proposal.email,proposal.type,proposal.birthday,req.user.id,JSON.stringify(personMetadata),JSON.stringify({status:'alive',confidence:100,source:'human_identity_review',updated_at:now})]
      )).rows[0];
      if(!person||person.status!=='active'||person.identity_verification_status!=='verified')throw Object.assign(new Error('NYEOCARE could not verify the newly created person record. The review remains pending.'),{status:409,code:'IDENTITY_CREATE_VERIFICATION_FAILED'});
      await recordSeparatePair(db,{orgId:req.org.id,actorId:req.user.id,person,candidates,proposedPhones,reviewId:found.id});
      finalId=String(person.id);
    }
    const evidence=identityEvidence(found,candidates,proposal,req.user.id,action,action==='merge'?canonicalId:null);
    await upsertCreateRequest(db,{orgId:req.org.id,requestId:found.client_request_id,payloadHash:found.request_payload_hash||found.payload_hash,personId:finalId,actorId:req.user.id});
    await resolveReview(db,{row:found,orgId:req.org.id,actorId:req.user.id,personId:finalId,action,evidence});
    await db.query('COMMIT');finished=true;
    eventData={organizationId:req.org.id,personId:finalId,actorId:req.user.id,action,reviewId:String(found.id)};
  }catch(err){
    if(!finished)await db.query('ROLLBACK').catch(()=>{});
    const status=[400,403,404,409].includes(Number(err?.status))?Number(err.status):500;
    console.error('[PERSON_IDENTITY_REVIEW] Action failed:',{organization_id:req.org.id,review_id:String(id),code:err?.code||null,message:err?.message||String(err)});
    return res.status(status).json({error:status<500?String(err.message||'Identity review failed.'):'The identity decision could not be completed safely. Nothing was changed; the item remains pending.',code:err?.code||'PERSON_IDENTITY_REVIEW_ACTION_FAILED'});
  }finally{
    db.release();
  }
  if(eventData){
    try{
      const event=await emitAriaEvent({
        organizationId:eventData.organizationId,personId:eventData.personId,
        type:eventData.action==='merge'?'PERSON_UPDATED':'PERSON_CREATED',
        source:'human_identity_review',actorId:eventData.actorId,
        metadata:{review_id:eventData.reviewId,action:eventData.action},
        eventKey:`person-identity-review:${eventData.reviewId}:${eventData.action}:${eventData.personId}`
      });
      if(event)await directAriaEvent(event);
    }catch(error){console.warn('[PERSON_IDENTITY_REVIEW] ARIA event skipped:',error?.message||error)}
  }
  return res.status(200).json({ok:true,verified:true,persisted:true,review_status:'resolved',action,review_id:String(id),person_id:eventData?.personId||null});
});
