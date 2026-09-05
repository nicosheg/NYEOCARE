// lib/identityResolver.js
import pool from'./db';
import{fuzzyMatch,normalizeName,normalizePhone}from'./scanValidation';

const ALIVE_THRESHOLD=80;
const NEEDS_DECISION_THRESHOLD=60;
const CONFLICT_DIFFERENCE=10;

function displayName(row){
 return String(row.display_name||[row.first_name,row.last_name].filter(Boolean).join(' ')||row.first_name||'').trim();
}

export async function resolveIdentities(extractedPeople,orgId,scanJobId,client=null){
 if(!orgId)throw new Error('orgId required');
 const db=client||pool;
 const results=[];

 for(let idx=0;idx<extractedPeople.length;idx++){
  const person=extractedPeople[idx];
  const normalizedName=normalizeName(person.name);
  const normalizedPhone=normalizePhone(person.phone);
  const candidates=[];

  if(normalizedPhone){
   const r=await db.query(
    `SELECT id,first_name,last_name,display_name,phone,type,status
     FROM people
     WHERE organization_id=$1 AND phone=$2 AND status='active'
     LIMIT 1`,
    [orgId,normalizedPhone]
   );
   for(const row of r.rows)candidates.push({...row,score:100,method:'phone'});
  }

  if(normalizedName){
   const r=await db.query(
    `SELECT pa.person_id AS id,p.first_name,p.last_name,p.display_name,p.phone,p.type,p.status
     FROM person_aliases pa
     JOIN people p ON p.id=pa.person_id AND p.organization_id=pa.organization_id
     WHERE pa.organization_id=$1 AND pa.alias=$2 AND p.status='active'
     LIMIT 5`,
    [orgId,normalizedName]
   );
   for(const row of r.rows)candidates.push({...row,score:90,method:'alias'});
  }

  if(candidates.length<3&&normalizedName){
   const r=await db.query(
    `SELECT id,first_name,last_name,display_name,phone,type,status
     FROM people
     WHERE organization_id=$1 AND status='active'`,
    [orgId]
   );
   for(const row of r.rows){
    const score=Math.round(fuzzyMatch(normalizedName,normalizeName(displayName(row)))*100);
    if(score>=60)candidates.push({...row,score,method:'fuzzy'});
   }
  }

  const unique=[];
  const seen=new Set();
  for(const candidate of candidates){
   if(!seen.has(candidate.id)){
    seen.add(candidate.id);
    unique.push(candidate);
   }
  }

  unique.sort((a,b)=>b.score-a.score);

  const best=unique[0]||null;
  const second=unique[1]||null;
  const margin=best&&second?best.score-second.score:100;

  let status='new';
  let bestCandidateId=null;

  if(best){
   if(second&&margin<=CONFLICT_DIFFERENCE){
    status='conflict';
   }else if(best.score<NEEDS_DECISION_THRESHOLD){
    status='needs_decision';
   }else if(best.score<ALIVE_THRESHOLD||!normalizedPhone){
    status='needs_decision';
   }else{
    status='alive';
    bestCandidateId=best.id;
   }
  }

  results.push({
   extracted_name:person.name,
   extracted_first_name:person.first_name,
   extracted_last_name:person.last_name,
   extracted_phone:normalizedPhone||null,
   confidence:person.confidence,
   status,
   candidate_ids:unique.map(x=>x.id),
   candidates:unique.map(x=>({
    id:x.id,
    name:displayName(x),
    phone:x.phone,
    score:x.score,
    method:x.method
   })),
   best_candidate_id:bestCandidateId,
   resolved:status==='alive',
   review_id:`${scanJobId}:${idx}`
  });
 }

 return results;
}
