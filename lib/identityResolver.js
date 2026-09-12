// lib/identityResolver.js
import pool from'./db';
import{fuzzyMatch,normalizeName,normalizePhone}from'./scanValidation';
import{canonicalNameSuggestion,buildNameReview}from'./nameIntelligence';
const ALIVE_THRESHOLD=94,NAME_REVIEW_THRESHOLD=72,NAME_CANDIDATE_THRESHOLD=68,CONFLICT_MARGIN=5;
function displayName(row){return String(row.display_name||[row.first_name,row.last_name].filter(Boolean).join(' ')||row.first_name||'').trim()}
function personPhones(person){const values=Array.isArray(person.phone_numbers)?person.phone_numbers:person.phone?[{normalized:person.phone}]:[];return[...new Set(values.map(x=>normalizePhone(typeof x==='string'?x:x?.normalized||x?.phone||x?.raw)).filter(Boolean))]}
function nameScore(extracted,canonical){const a=normalizeName(extracted),b=normalizeName(canonical);if(!a||!b)return 0;if(a===b)return 100;return Math.round(fuzzyMatch(a,b)*100)}
function phoneEvidence(extractedPhones,candidatePhones){const incoming=[...new Set(extractedPhones.filter(Boolean))],existing=[...new Set(candidatePhones.filter(Boolean))],matches=incoming.filter(p=>existing.includes(p));if(!matches.length)return{score:0,matches:[],count:0};return{score:100,matches,count:matches.length}}
function combinedScore(name,phone,alias=false){if(alias&&phone.count)return 100;if(alias)return 96;if(phone.count&&name>=76)return 99;if(phone.count)return 90;if(name>=96)return 94;if(name>=88)return 82;return Math.min(81,name)}
function method(name,phone,alias=false){if(alias&&phone.count)return'confirmed_alias_and_phone';if(alias)return'confirmed_alias';if(phone.count&&name>=76)return phone.count>1?'name_and_two_phones':'name_and_phone';if(phone.count)return'phone_only';if(name>=96)return'exact_name_only';return'fuzzy_name_only'}
function candidateEvidence(person,extractedName,extractedPhones,alias=false){const canonical=displayName(person),name=nameScore(extractedName,canonical),phone=phoneEvidence(extractedPhones,personPhones(person)),score=combinedScore(name,phone,alias);return{...person,score,nameScore:name,phoneScore:phone.score,phoneMatches:phone.matches,phoneMatchCount:phone.count,compatibleName:name>=76,alias,method:method(name,phone,alias)}}
export async function resolveIdentities(extractedPeople,orgId,scanJobId,client=null){
 if(!orgId)throw new Error('orgId required');
 const db=client||pool;if(!Array.isArray(extractedPeople))return[];
 const[peopleResult,aliasResult]=await Promise.all([
  db.query(`SELECT id,first_name,last_name,display_name,phone,phone_numbers,type,status FROM people WHERE organization_id=$1 AND status='active'`,[orgId]),
  db.query(`SELECT person_id,alias FROM person_aliases WHERE organization_id=$1`,[orgId])
 ]);
 const people=peopleResult.rows,aliases=aliasResult.rows,aliasMap=new Map(),phoneMap=new Map(),byId=new Map(people.map(x=>[x.id,x]));
 for(const row of aliases){const key=normalizeName(row.alias);if(!key||!byId.has(row.person_id))continue;const list=aliasMap.get(key)||[];if(!list.includes(row.person_id))list.push(row.person_id);aliasMap.set(key,list)}
 for(const person of people){for(const phone of personPhones(person)){const list=phoneMap.get(phone)||[];if(!list.some(x=>x.id===person.id))list.push(person);phoneMap.set(phone,list)}}
 const results=[];
 for(let idx=0;idx<extractedPeople.length;idx++){
  const person=extractedPeople[idx],extractedName=String(person.name||person.display_name||person.raw_name||'').trim(),normalizedPhones=[...new Set(personPhones(person))],candidates=new Map(),key=normalizeName(extractedName);
  for(const row of people){const evidence=candidateEvidence(row,extractedName,normalizedPhones,false);if(evidence.nameScore>=NAME_CANDIDATE_THRESHOLD||evidence.phoneMatchCount)candidates.set(row.id,evidence)}
  const aliasIds=[...new Set(aliasMap.get(key)||[])];
  for(const id of aliasIds){const row=byId.get(id);if(row)candidates.set(id,candidateEvidence(row,extractedName,normalizedPhones,true))}
  const exactPhoneCandidates=normalizedPhones.flatMap(p=>phoneMap.get(p)||[]);
  for(const row of exactPhoneCandidates)candidates.set(row.id,candidateEvidence(row,extractedName,normalizedPhones,false));
  const unique=[...candidates.values()].sort((a,b)=>b.score-a.score),best=unique[0]||null,second=unique[1]||null,margin=best&&second?best.score-second.score:100;
  const samePhoneOwners=normalizedPhones.flatMap(p=>phoneMap.get(p)||[]).filter((row,i,arr)=>arr.findIndex(x=>x.id===row.id)===i);
  let status='new',bestCandidateId=null;
  if(samePhoneOwners.length>1)status='conflict';
  else if(best){
   if(best.alias&&(!second||margin>CONFLICT_MARGIN)){status='alive';bestCandidateId=best.id}
   else if(best.phoneMatchCount&&best.nameScore>=76&&(!second||margin>CONFLICT_MARGIN)){status='alive';bestCandidateId=best.id}
   else if(second&&best.score>=85&&second.score>=85&&margin<=CONFLICT_MARGIN)status='conflict';
   else if(best.score>=NAME_REVIEW_THRESHOLD)status='needs_decision';
  }
  const nameSuggestions=buildNameReview(extractedName,unique.slice(0,5)),globalSuggestions=canonicalNameSuggestion(extractedName);
  results.push({extracted_name:extractedName,extracted_first_name:person.first_name,extracted_last_name:person.last_name,extracted_phone:normalizedPhones[0]||null,extracted_phones:normalizedPhones,confidence:best?.score||0,name_confidence:best?.nameScore||0,phone_confidence:best?.phoneScore||0,pair_confidence:best?.phoneMatchCount?(best.nameScore>=76?100:90):0,status,candidate_ids:unique.map(x=>x.id),candidates:unique.slice(0,5).map(x=>({id:x.id,name:displayName(x),phone:x.phone,phone_numbers:x.phone_numbers||[],score:x.score,name_score:x.nameScore,phone_score:x.phoneScore,phone_matches:x.phoneMatches,method:x.method,alias:x.alias})),best_candidate_id:bestCandidateId,resolved:status==='alive',name_suggestions:nameSuggestions,global_name_suggestions:globalSuggestions,evidence:{name:best?.nameScore||0,phone:best?.phoneScore||0,phone_matches:best?.phoneMatches||[],pair:best?.phoneMatchCount?(best.nameScore>=76?'strong':'phone_only'):'none'},review_id:`${scanJobId}:${idx}`});
 }
 return results;
}
