import crypto from 'node:crypto';
import { hashPersonCreatePayload } from './peopleCreateIdempotency';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function stableIdentityReviewRequestId(value){
  const hex=crypto.createHash('sha256').update(String(value||'')).digest('hex').slice(0,32).split('');
  hex[12]='5';
  hex[16]='89ab'[parseInt(hex[16],16)%4];
  const h=hex.join('');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}

export function personIdentityPayloadHash(payload){
  return hashPersonCreatePayload({
    first_name:payload?.first_name,
    last_name:payload?.last_name,
    display_name:payload?.display_name||payload?.full_name,
    phone:payload?.phone||null,
    email:payload?.email||null,
    type:payload?.type||'visitor',
    birthday:payload?.birthday||null
  });
}

function candidateSnapshot(candidate){
  const name=String(candidate?.display_name||candidate?.name||[candidate?.first_name,candidate?.last_name].filter(Boolean).join(' ')||'Unnamed person');
  return {
    id:String(candidate?.id||''),
    display_name:name,
    first_name:String(candidate?.first_name||''),
    last_name:String(candidate?.last_name||''),
    phone:candidate?.phone||null,
    phones:Array.isArray(candidate?.phones)?candidate.phones:[],
    type:candidate?.type||null,
    status:candidate?.status||null,
    name_match:candidate?.name_match===true,
    phone_match:candidate?.phone_match===true,
    similar_name:candidate?.similar_name===true,
    name_score:Number(candidate?.name_score||0),
    phone_score:Number(candidate?.phone_score||0)
  };
}

export async function persistPersonIdentityReview(db,{
  organizationId,actorId,clientRequestId,payloadHash,proposedPayload,candidates=[],
  evidence={},source='manual_create'
}){
  const requestId=UUID_RE.test(String(clientRequestId||''))?String(clientRequestId):stableIdentityReviewRequestId(clientRequestId);
  const candidateRows=(Array.isArray(candidates)?candidates:[]).map(candidateSnapshot).filter(x=>x.id);
  const proposed=proposedPayload&&typeof proposedPayload==='object'?proposedPayload:{};
  const hash=String(payloadHash||personIdentityPayloadHash(proposed));
  const result=await db.query(
    `INSERT INTO public.person_identity_review_items
      (organization_id,client_request_id,payload_hash,source,proposed_payload,candidate_person_ids,match_evidence,created_by)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)
     ON CONFLICT(organization_id,client_request_id) DO UPDATE SET
       candidate_person_ids=EXCLUDED.candidate_person_ids,
       match_evidence=EXCLUDED.match_evidence,
       updated_at=NOW()
     WHERE person_identity_review_items.status='pending'
       AND person_identity_review_items.payload_hash=EXCLUDED.payload_hash
     RETURNING id,status,payload_hash,candidate_person_ids,proposed_payload,match_evidence,created_at,updated_at`,
    [organizationId,requestId,hash,source,JSON.stringify(proposed),JSON.stringify(candidateRows.map(x=>x.id)),
     JSON.stringify({...evidence,matches:candidateRows}),actorId||null]
  );
  if(result.rows?.[0])return result.rows[0];
  const existing=(await db.query(
    `SELECT id,status,payload_hash,candidate_person_ids,proposed_payload,match_evidence,created_at,updated_at
     FROM public.person_identity_review_items
     WHERE organization_id=$1 AND client_request_id=$2 LIMIT 1`,
    [organizationId,requestId]
  )).rows[0];
  if(existing){
    if(existing.status==='pending'&&existing.payload_hash!==hash){
      throw Object.assign(new Error('This identity review is being edited in Review Center. Open that pending review before changing these details again.'),{
        status:409,code:'PERSON_IDENTITY_REVIEW_IN_PROGRESS',review_id:existing.id
      });
    }
    return existing;
  }
  throw Object.assign(new Error('NYEOCARE could not persist this identity review.'),{status:500,code:'PERSON_IDENTITY_REVIEW_PERSIST_FAILED'});
}

export async function resolvePersonIdentityReviewByRequest(db,{
  organizationId,clientRequestId,payloadHash,actorId,personId,action,metadata={}
}){
  if(!clientRequestId)return null;
  const requestId=UUID_RE.test(String(clientRequestId))?String(clientRequestId):stableIdentityReviewRequestId(clientRequestId);
  const result=await db.query(
    `UPDATE public.person_identity_review_items
     SET status='resolved',decision=$4::jsonb,resolved_by=$5,resolved_person_id=$6,resolved_at=NOW(),updated_at=NOW()
     WHERE organization_id=$1 AND client_request_id=$2 AND payload_hash=$3 AND status='pending'
     RETURNING id,status`,
    [organizationId,requestId,payloadHash,JSON.stringify({action,actor_id:actorId,person_id:personId,...metadata}),actorId||null,personId||null]
  );
  return result.rows?.[0]||null;
}

export function normalizeIdentityReviewCandidates(candidates){
  return (Array.isArray(candidates)?candidates:[]).map(candidateSnapshot).filter(x=>x.id);
}
