// pages/api/people/bulk-create.js
import pool from '../../../lib/db';
import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { normalizePhone } from '../../../lib/phoneUtils';
import { normalizeDisplayName } from '../../../lib/scanValidation';
import { withOrg } from '../../../lib/apiHelpers';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';
import { directAriaEvent } from '../../../lib/aria/director';
import { identityNameKey, findIdentityCandidates, recordIdentityReview } from '../../../lib/aria/peopleMutationEngine';
import { persistPersonIdentityReview, stableIdentityReviewRequestId, personIdentityPayloadHash } from '../../../lib/personIdentityReviewQueue';

const MAX_ROWS = 200;

function splitName(value) {
  const normalized = normalizeDisplayName(value);
  const parts = normalized.core.split(/\s+/).filter(Boolean);
  return {
    first_name: parts.shift() || '',
    last_name: parts.join(' '),
    display_name: normalized.display
  };
}

function proposedPayload(candidate) {
  return {
    first_name: candidate.first_name, last_name: candidate.last_name,
    display_name: candidate.display_name, full_name: candidate.display_name,
    phone: candidate.phone || null,
    phone_numbers: candidate.phone ? [{raw:candidate.phone,normalized:candidate.phone,source:'bulk_add',index:1}] : [],
    email: candidate.email || null, birthday: candidate.birthday || null, type: candidate.type || 'visitor'
  };
}

function rowNumber(row, index) {
  const value = Number(row?.row_number);
  return Number.isInteger(value) && value > 0 ? value : index + 1;
}

async function processCreatedPeople(people, organizationId, actorId, actorRole) {
  // ARIA enrichment is deliberately outside the synchronous insert path.
  // The people records are already committed before this background work starts.
  for (let offset = 0; offset < people.length; offset += 4) {
    const batch = people.slice(offset, offset + 4);
    await Promise.allSettled(batch.map(async person => {
      try {
        const event = await emitAriaEvent({
          organizationId,
          personId: person.id,
          type: 'PERSON_CREATED',
          source: 'manual',
          actorId,
          actorRole,
          metadata: { source: 'bulk_add' },
          eventKey: `manual:${organizationId}:person:${person.id}:created`
        });
        if (event) await directAriaEvent(event);
      } catch (error) {
        console.error('[PEOPLE_BULK] ARIA enrichment failed:', {
          person_id: person.id,
          message: error?.message || String(error)
        });
      }
    }));
  }
}

export default withOrg(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!['owner', 'admin', 'leader', 'worker', 'user'].includes(String(req.user.role||'').toLowerCase())) {
    return res.status(403).json({ error: 'Authorized organization operator permissions required.' });
  }

  const body = req.body || {};
  const rawRows = body.rows;
  const defaultType = String(body.default_type || 'visitor').trim().toLowerCase();
  if (!['member', 'visitor'].includes(defaultType)) {
    return res.status(400).json({ error: 'Default type must be member or visitor.' });
  }
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return res.status(400).json({ error: 'Paste at least one person row.' });
  }
  if (rawRows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Add up to ${MAX_ROWS} people per batch.`, max_rows: MAX_ROWS });
  }

  const results = rawRows.map((raw, index) => {
    const row = raw && typeof raw === 'object' ? raw : {};
    const name = String(row.full_name ?? row.name ?? '').trim();
    const phoneText = String(row.phone ?? '').trim();
    const email = String(row.email ?? '').trim().toLowerCase();
    const type = String(row.type || defaultType).trim().toLowerCase();
    const line = rowNumber(row, index);
    const sourceLines = Array.isArray(row.source_line_numbers) ? row.source_line_numbers.map(Number).filter(value => Number.isInteger(value) && value > 0) : [line];
    const review_key = `${name.trim().toLowerCase()}|${phoneText.trim()}`;
    const outcome = { row: line, source_line_numbers: sourceLines.length ? sourceLines : [line], name, review_key, status: 'skipped', reason: '' };

    if (!name) {
      outcome.reason = 'Name is required.';
      return { outcome, candidate: null };
    }
    if (name.length > 150) {
      outcome.reason = 'Name must be 150 characters or fewer.';
      return { outcome, candidate: null };
    }
    const split = splitName(name);
    if (!split.first_name || split.first_name.length > 150 || split.last_name.length > 150) {
      outcome.reason = 'Please enter a valid name (up to 150 characters per name part).';
      return { outcome, candidate: null };
    }
    const phone = phoneText ? normalizePhone(phoneText) : null;
    if (phoneText && !phone) {
      outcome.reason = 'Phone number is incomplete or invalid. Use a complete number, such as 08012345678.';
      return { outcome, candidate: null };
    }
    if (!['member', 'visitor'].includes(type)) {
      outcome.reason = 'Type must be member or visitor.';
      return { outcome, candidate: null };
    }
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      outcome.reason = 'Email address is invalid.';
      return { outcome, candidate: null };
    }

    return {
      outcome,
      candidate: {
        index,
        ...split,
        identity_review: row.identity_review&&typeof row.identity_review==='object'?row.identity_review:null,
        phone,
        email: email || null,
        type,
        birthday: null,
        living_truth: JSON.stringify({
          status: 'alive',
          confidence: 90,
          source: 'canonical_record',
          updated_at: new Date().toISOString()
        })
      }
    };
  });

  // Keep the first valid instance of a phone number in the pasted list.
  const seenPhones = new Map();
  const seenNames = new Map();
  const candidates = [];
  for (const item of results) {
    const candidate = item.candidate;
    if (!candidate) continue;
    const nameKey=identityNameKey(candidate.display_name||item.outcome.name);
    if (candidate.phone && seenPhones.has(candidate.phone)) {
      item.outcome.status='needs_review';
      item.outcome.reason = `Phone number duplicates row ${seenPhones.get(candidate.phone)} in this list. Review both records before deciding whether they are one person.`;
      item.outcome.proposed_payload=proposedPayload(candidate);
      item.outcome.payload_hash=personIdentityPayloadHash(item.outcome.proposed_payload);
      item.outcome.duplicate_row=seenPhones.get(candidate.phone);
      item.outcome.identity_review_required=true;
      item.outcome.review_request_id=stableIdentityReviewRequestId(`bulk-create:${req.org.id}:${req.user?.id||''}:${item.outcome.row}:${item.outcome.payload_hash}`);
      item.candidate = null;
      continue;
    }
    if (nameKey && seenNames.has(nameKey)) {
      item.outcome.status='needs_review';
      item.outcome.reason = `Name is similar to row ${seenNames.get(nameKey)} in this list. Review both records before deciding whether they are one person.`;
      item.outcome.proposed_payload=proposedPayload(candidate);
      item.outcome.payload_hash=personIdentityPayloadHash(item.outcome.proposed_payload);
      item.outcome.duplicate_row=seenNames.get(nameKey);
      item.outcome.identity_review_required=true;
      item.outcome.review_request_id=stableIdentityReviewRequestId(`bulk-create:${req.org.id}:${req.user?.id||''}:${item.outcome.row}:${item.outcome.payload_hash}`);
      item.candidate = null;
      continue;
    }
    if (candidate.phone) seenPhones.set(candidate.phone, item.outcome.row);
    if (nameKey) seenNames.set(nameKey,item.outcome.row);
    candidates.push(candidate);
  }

  const organizationId = req.org.id;
  const client = await pool.connect();
  let insertedPeople = [];
  try {
    await client.query('BEGIN');
    // Avoid two simultaneous bulk submissions racing each other through the duplicate check.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`people-bulk-create:${organizationId}`]);

    const accepted = [];
    for (const item of results) {
      const candidate = item.candidate;
      if (!candidate) continue;
      const nameKey=identityNameKey(candidate.display_name||item.outcome.name);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`nyeocare:person-name:${organizationId}:${nameKey}`]);
      if(candidate.phone)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`nyeocare:person-phone:${organizationId}:${candidate.phone}`]);
      const matches=await findIdentityCandidates(organizationId,nameKey,candidate.phone,client);
      const candidatePayload=matches.map(match=>({
        id:String(match.id),organization_id:String(match.organization_id),organization_name:req.org.name||null,display_name:match.display_name||[match.first_name,match.last_name].filter(Boolean).join(' ')||'Unnamed person',
        first_name:match.first_name||'',last_name:match.last_name||'',phone:match.phone||null,
        type:match.type||null,status:match.status||null,
        name_match:match.name_match===true,phone_match:match.phone_match===true,similar_name:match.similar_name===true
      }));
      const exact=matches.find(match=>match.name_match&&match.phone_match);
      const review=candidate.identity_review;
      const expectedIds=Array.isArray(review?.candidate_ids)?[...new Set(review.candidate_ids.map(value=>String(value)))].sort():[];
      const currentIds=candidatePayload.map(match=>match.id).sort();
      const payload=proposedPayload(candidate);
      const payloadHash=personIdentityPayloadHash(payload);
      const reviewRequestId=stableIdentityReviewRequestId(`bulk-create:${organizationId}:${req.user.id}:${item.outcome.row}:${payloadHash}`);
      item.outcome.proposed_payload=payload;
      item.outcome.payload_hash=payloadHash;
      item.outcome.review_request_id=reviewRequestId;
      const priorRequest=(await client.query(
        `SELECT r.payload_hash,r.person_id FROM public.person_create_requests r
         WHERE r.organization_id=$1 AND r.client_request_id=$2 LIMIT 1 FOR UPDATE`,
        [organizationId,reviewRequestId]
      )).rows[0];
      if(priorRequest){
        if(priorRequest.payload_hash!==payloadHash)throw Object.assign(new Error('A bulk-add retry key was reused for different details. Nothing from this batch was saved.'),{code:'PERSON_CREATE_REQUEST_ID_REUSED'});
        item.outcome.status='already_saved';
        item.outcome.reason='This row was already saved or resolved in Review Center. NYEOCARE did not create a second person.';
        item.outcome.person_id=String(priorRequest.person_id);
        item.candidate=null;
        continue;
      }
      if((matches.length&&(review?.confirmed!==true||expectedIds.length!==currentIds.length||expectedIds.some((value,index)=>value!==currentIds[index])))||(!matches.length&&review?.confirmed===true&&expectedIds.length)){
        item.outcome.status='needs_review';
        item.outcome.identity_review_required=true;
        item.outcome.reason=review?.confirmed===true?'Possible matches changed while this row was being reviewed. Review the refreshed candidates before saving.':exact?'The same normalized name and phone already exist. Confirm whether this is the same person or a genuinely separate person.':'Possible identity matches require human review before this row can be saved.';
        item.outcome.candidates=candidatePayload;
        item.candidate=null;
        continue;
      }
      candidate.person_id=randomUUID();
      candidate.identity_candidates=matches.length?matches:[];
      candidate.review_request_id=reviewRequestId;
      candidate.payload_hash=payloadHash;
      accepted.push(candidate);
    }

    if (accepted.length) {
      const values = [organizationId];
      const groups = accepted.map(row => {
        const first = values.length + 1;
        values.push(
          row.person_id, row.first_name, row.last_name, row.display_name || null,
          row.phone, JSON.stringify(row.phone ? [{raw:row.phone,normalized:row.phone,source:'manual',index:1}] : []),
          row.email, row.type, row.birthday, req.user.id, row.living_truth
        );
        return `($${first},$1,$${first + 1},$${first + 2},$${first + 3},$${first + 4},$${first + 5},$${first + 6},$${first + 7},$${first + 8},$${first + 9},$${first + 10}::jsonb,'active','manual')`;
      });
      const created = await client.query(
        `INSERT INTO people
          (id,organization_id,first_name,last_name,display_name,phone,phone_numbers,email,type,birthday,created_by,living_truth,status,source)
         VALUES ${groups.join(',')}
         RETURNING id,first_name,last_name,display_name,phone,phone_numbers,email,type,birthday,created_at`,
        values
      );
      insertedPeople = created.rows;
      const acceptedById=new Map(accepted.map(row=>[row.person_id,row]));
      for (const person of insertedPeople) {
        const input=acceptedById.get(person.id);
        if(input?.identity_candidates?.length)await recordIdentityReview(client,{
          organizationId,actorId:req.user.id,actorRole:req.user.role,
          person,candidates:input.identity_candidates,phone:person.phone,source:'bulk_people_identity_review'
        });
        if(input?.review_request_id&&input?.payload_hash){
          await client.query(
            `INSERT INTO public.person_create_requests(organization_id,client_request_id,payload_hash,person_id,created_by)
             VALUES($1,$2,$3,$4,$5)`,
            [organizationId,input.review_request_id,input.payload_hash,person.id,req.user.id]
          );
        }
      }
      for (const candidate of accepted) results[candidate.index].outcome.status = 'created';
    }

    // Persist blocked rows before committing the batch; the proposal remains a review item, never a People row.
    for(const item of results){
      if(item.outcome.status!=='needs_review'||!item.outcome.proposed_payload)continue;
      let candidates=Array.isArray(item.outcome.candidates)?item.outcome.candidates:[];
      if(item.outcome.duplicate_row){
        const owner=results.find(other=>Number(other.outcome.row)===Number(item.outcome.duplicate_row)&&other.candidate?.person_id);
        const createdOwner=owner?.candidate?.person_id?insertedPeople.find(person=>String(person.id)===String(owner.candidate.person_id)):null;
        if(createdOwner)candidates=[...candidates,{...createdOwner,organization_id:organizationId,status:'active'}];
      }
      const payloadHash=item.outcome.payload_hash||personIdentityPayloadHash(item.outcome.proposed_payload);
      const reviewRequestId=item.outcome.review_request_id||stableIdentityReviewRequestId(`bulk-create:${organizationId}:${req.user.id}:${item.outcome.row}:${payloadHash}`);
      const saved=await persistPersonIdentityReview(client,{
        organizationId,actorId:req.user.id,clientRequestId:reviewRequestId,payloadHash,
        proposedPayload:item.outcome.proposed_payload,candidates,
        evidence:{code:'PERSON_IDENTITY_REVIEW_REQUIRED',reason:item.outcome.reason,row_number:item.outcome.row,review_reasons:[item.outcome.reason],source:'bulk_create'},
        source:'bulk_create'
      });
      item.outcome.review_id=saved.id;
    }

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[PEOPLE_BULK] Insert failed:', error?.message || error);
    return res.status(500).json({ error: 'Could not add people. Nothing from this batch was saved.' });
  } finally {
    client.release();
  }

  if (insertedPeople.length) {
    try {
      waitUntil(processCreatedPeople(insertedPeople, organizationId, req.user.id, req.user.role));
    } catch (error) {
      console.error('[PEOPLE_BULK] Could not schedule ARIA enrichment:', error?.message || error);
    }
  }

  const skipped = results.filter(item => item.outcome.status !== 'created');
  return res.status(200).json({
    success: true,
    created: insertedPeople.length,
    skipped: skipped.length,
    max_rows: MAX_ROWS,
    results: results.map(item => item.outcome)
  });
});
