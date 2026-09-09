// lib/identityResolver.js
import pool from'./db';
import{fuzzyMatch,normalizeName,normalizePhone}from'./scanValidation';

const ALIVE_THRESHOLD=90,REVIEW_THRESHOLD=82,CONFLICT_MARGIN=6;

function displayName(row){return String(row.display_name||[row.first_name,row.last_name].filter(Boolean).join(' ')||row.first_name||'').trim()}
function scoreName(extracted,canonical){
 const a=normalizeName(extracted),b=normalizeName(canonical);
 if(!a||!b)return 0;
 if(a===b)return 94;
 return Math.round(fuzzyMatch(a,b)*88);
}

function personPhones(person){
 const values=Array.isArray(person.phone_numbers)?person.phone_numbers:person.phone?[{normalized:person.phone}]:[];
 return values.map(x=>normalizePhone(typeof x==='string'?x:x?.normalized||x?.phone||x?.raw)).filter(Boolean);
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
  const person=extractedPeople[idx],normalizedName=normalizeName(person.name),normalizedPhones=personPhones(person),candidates=new Map();

  for(const phone of normalizedPhones){
   const exactPhone=phoneMap.get(phone);
   if(exactPhone){
    const existing=candidates.get(exactPhone.id);
    if(!existing||existing.score<100)candidates.set(exactPhone.id,{...exactPhone,score:100,method:'phone'});
   }
  }

  for(const id of aliasMap.get(normalizedName)||[]){
   const row=byId.get(id);
   if(row)candidates.set(id,{...row,score:96,method:'alias'});
  }

  for(const row of nameMap.get(normalizedName)||[])candidates.set(row.id,{...row,score:94,method:'exact_name'});

  if(candidates.size<3&&normalizedName){
   for(const row of people){
    const score=scoreName(normalizedName,displayName(row));
    if(score>=REVIEW_THRESHOLD){
     const existing=candidates.get(row.id);
     if(!existing||score>existing.score)candidates.set(row.id,{...row,score,method:'fuzzy'});
    }
   }
  }

  const unique=[...candidates.values()].sort((a,b)=>b.score-a.score),best=unique[0]||null,second=unique[1]||null,margin=best&&second?best.score-second.score:100;

  let status='new',bestCandidateId=null;

  if(best){
   if(second&&margin<=CONFLICT_MARGIN)status='conflict';
   else if(best.score>=ALIVE_THRESHOLD){
    status='alive';
    bestCandidateId=best.id;
   }else status='needs_decision';
  }

  results.push({
   extracted_name:person.name,
   extracted_first_name:person.first_name,
   extracted_last_name:person.last_name,
   extracted_phone:normalizedPhones[0]||null,
   extracted_phones:normalizedPhones,
   confidence:person.confidence,
   status,
   candidate_ids:unique.map(x=>x.id),
   candidates:unique.slice(0,5).map(x=>({id:x.id,name:displayName(x),phone:x.phone,phone_numbers:x.phone_numbers||[],score:x.score,method:x.method})),
   best_candidate_id:bestCandidateId,
   resolved:status==='alive',
   review_id:`${scanJobId}:${idx}`
  });
 }

 return results;
}
