// lib/identityResolver.js
import pool from'./db';
import{fuzzyMatch,normalizeName,normalizePhone}from'./scanValidation';

const ALIVE_THRESHOLD=94,REVIEW_THRESHOLD=82,CONFLICT_MARGIN=5;

function displayName(row){return String(row.display_name||[row.first_name,row.last_name].filter(Boolean).join(' ')||row.first_name||'').trim()}
function personPhones(person){
 const values=Array.isArray(person.phone_numbers)?person.phone_numbers:person.phone?[{normalized:person.phone}]:[];
 return values.map(x=>normalizePhone(typeof x==='string'?x:x?.normalized||x?.phone||x?.raw)).filter(Boolean);
}
function nameScore(extracted,canonical){
 const a=normalizeName(extracted),b=normalizeName(canonical);
 if(!a||!b)return 0;
 if(a===b)return 94;
 return Math.min(88,Math.round(fuzzyMatch(a,b)*88));
}
function phoneEvidence(extractedPhones,candidatePhones){
 const incoming=[...new Set(extractedPhones.filter(Boolean))];
 const existing=[...new Set(candidatePhones.filter(Boolean))];
 const matches=incoming.filter(p=>existing.includes(p));
 if(!matches.length)return{score:0,matches:[],count:0};
 const ratio=matches.length/Math.max(incoming.length,existing.length,1);
 return{score:Math.min(100,92+(matches.length>1?4:ratio>=1?3:0)),matches,count:matches.length};
}
function combinedScore(name,phone){
 if(phone.count&&name>=88)return 100;
 if(phone.count&&name>=78)return 97;
 if(phone.count)return Math.max(90,phone.score);
 if(name>=94)return 84;
 if(name>=88)return 82;
 return Math.min(81,name);
}
function method(name,phone){
 if(phone.count&&name>=88)return phone.count>1?'name_and_two_phones':'name_and_phone';
 if(phone.count)return'phone_only';
 if(name>=94)return'exact_name_only';
 return'fuzzy_name_only';
}
function candidateEvidence(person,extractedName,extractedPhones){
 const canonical=displayName(person),name=nameScore(extractedName,canonical),phone=phoneEvidence(extractedPhones,personPhones(person)),score=combinedScore(name,phone);
 const existingPhones=personPhones(person);
 const conflictingPhones=extractedPhones.filter(p=>p&&existingPhones.length&&!existingPhones.includes(p));
 const compatibleName=name>=78;
 return{...person,score,nameScore:name,phoneScore:phone.score,phoneMatches:phone.matches,phoneMatchCount:phone.count,conflictingPhones,compatibleName,method:method(name,phone)};
}
export async function resolveIdentities(extractedPeople,orgId,scanJobId,client=null){
 if(!orgId)throw new Error('orgId required');
 const db=client||pool;
 if(!Array.isArray(extractedPeople))return[];
 const[peopleResult,aliasResult]=await Promise.all([
  db.query(`SELECT id,first_name,last_name,display_name,phone,phone_numbers,type,status FROM people WHERE organization_id=$1 AND status='active'`,[orgId]),
  db.query(`SELECT person_id,alias FROM person_aliases WHERE organization_id=$1`,[orgId])
 ]);
 const people=peopleResult.rows,aliases=aliasResult.rows,aliasMap=new Map(),phoneMap=new Map(),nameMap=new Map();
 for(const row of aliases){
  const key=normalizeName(row.alias);
  if(!key)continue;
  const list=aliasMap.get(key)||[];
  list.push(row.person_id);
  aliasMap.set(key,list);
 }
 for(const person of people){
  for(const phone of personPhones(person))phoneMap.set(phone,person);
  const name=normalizeName(displayName(person));
  if(name){
   const list=nameMap.get(name)||[];
   list.push(person);
   nameMap.set(name,list);
  }
 }
 const byId=new Map(people.map(x=>[x.id,x])),results=[];
 for(let idx=0;idx<extractedPeople.length;idx++){
  const person=extractedPeople[idx],extractedName=String(person.name||person.raw_name||'').trim(),normalizedPhones=[...new Set(personPhones(person))],candidates=new Map();
  for(const row of people){
   const evidence=candidateEvidence(row,extractedName,normalizedPhones);
   if(evidence.score>=REVIEW_THRESHOLD)candidates.set(row.id,evidence);
  }
  for(const id of aliasMap.get(normalizeName(extractedName))||[]){
   const row=byId.get(id);
   if(row){
    const evidence=candidateEvidence(row,extractedName,normalizedPhones);
    evidence.score=Math.max(evidence.score,96);
    evidence.method=normalizedPhones.length?'alias_and_phone':'alias';
    candidates.set(id,evidence);
   }
  }
  const exactPhoneCandidates=normalizedPhones.map(p=>phoneMap.get(p)).filter(Boolean);
  for(const row of exactPhoneCandidates){
   const evidence=candidateEvidence(row,extractedName,normalizedPhones);
   candidates.set(row.id,evidence);
  }
  const unique=[...candidates.values()].sort((a,b)=>b.score-a.score),best=unique[0]||null,second=unique[1]||null;
  const margin=best&&second?best.score-second.score:100;
  let status='new',bestCandidateId=null;
  if(best){
   const phoneConflict=best.conflictingPhones.length>0&&!best.phoneMatchCount;
   if(phoneConflict&&best.nameScore<94)status='conflict';
   else if(second&&margin<=CONFLICT_MARGIN)status='conflict';
   else if(best.score>=ALIVE_THRESHOLD){status='alive';bestCandidateId=best.id}
   else status='needs_decision';
  }
  results.push({
   extracted_name:extractedName,
   extracted_first_name:person.first_name,
   extracted_last_name:person.last_name,
   extracted_phone:normalizedPhones[0]||null,
   extracted_phones:normalizedPhones,
   confidence:best?.score||0,
   name_confidence:best?.nameScore||0,
   phone_confidence:best?.phoneScore||0,
   pair_confidence:best?.phoneMatchCount?(best?.nameScore>=88?100:97):0,
   status,
   candidate_ids:unique.map(x=>x.id),
   candidates:unique.slice(0,5).map(x=>({id:x.id,name:displayName(x),phone:x.phone,phone_numbers:x.phone_numbers||[],score:x.score,name_score:x.nameScore,phone_score:x.phoneScore,phone_matches:x.phoneMatches,method:x.method,conflicting_phones:x.conflictingPhones})),
   best_candidate_id:bestCandidateId,
   resolved:status==='alive',
   evidence:{name:best?.nameScore||0,phone:best?.phoneScore||0,phone_matches:best?.phoneMatches||[],pair:best?.phoneMatchCount?(best.nameScore>=88?'strong':'moderate'): 'none'},
   review_id:`${scanJobId}:${idx}`
  });
 }
 return results;
                       }
