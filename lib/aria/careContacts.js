// lib/aria/careContacts.js
import pool from'../db';

const POSITIVE=new Set(['positive','helpful','worked','returned','became_regular','relationship_strengthened']);

export async function loadCareContactSignals(organizationId,personIds=[]){
 const ids=[...new Set((Array.isArray(personIds)?personIds:[]).map(String).filter(Boolean))];
 if(!organizationId||!ids.length)return new Map();

 const [relationships,outcomes]=await Promise.all([
  pool.query(
   `SELECT pr.person_id,pr.related_person_id candidate_id,'person' candidate_kind,
           pr.relationship_type,pr.confidence,pr.strength,pr.evidence,
           p.display_name,p.first_name,p.last_name,
           COALESCE(string_agg(DISTINCT r.role,', '),'') roles
    FROM person_relationships pr
    JOIN people p ON p.id=pr.related_person_id AND p.organization_id=pr.organization_id AND p.status='active'
    LEFT JOIN person_roles r
      ON r.person_id=p.id AND r.organization_id=p.organization_id AND r.status='active'
      AND(r.start_date IS NULL OR r.start_date<=CURRENT_DATE)
      AND(r.end_date IS NULL OR r.end_date>=CURRENT_DATE)
    WHERE pr.organization_id=$1
      AND pr.person_id=ANY($2::uuid[])
      AND pr.active=true
      AND pr.is_current=true
      AND(pr.valid_until IS NULL OR pr.valid_until>NOW())
      AND(
        lower(pr.relationship_type) ~ 'leader|care|follow|mentor|responsib|contact|know'
        OR(pr.evidence->>'care_relevant')='true'
      )
    GROUP BY pr.person_id,pr.related_person_id,pr.relationship_type,pr.confidence,pr.strength,pr.evidence,
             p.display_name,p.first_name,p.last_name`,
   [organizationId,ids]
  ),
  pool.query(
   `SELECT io.person_id,io.actor_id candidate_id,'operator' candidate_kind,
           COUNT(*)::int success_count,MAX(io.observed_at) last_success
    FROM intelligence_outcomes io
    JOIN users u ON u.id=io.actor_id
      AND u.organization_id=io.organization_id
      AND u.active=true
    WHERE io.organization_id=$1
      AND io.person_id=ANY($2::uuid[])
      AND io.actor_id IS NOT NULL
      AND io.outcome=ANY($3::text[])
    GROUP BY io.person_id,io.actor_id`,
   [organizationId,ids,[...POSITIVE]]
  )
 ]);

 const out=new Map();
 const push=(personId,candidate)=>{
  const key=String(personId);
  if(!out.has(key))out.set(key,[]);
  const arr=out.get(key);
  const dedupe=String(candidate.candidate_id);
  if(arr.some(x=>String(x.candidate_id)===dedupe&&x.candidate_kind===candidate.candidate_kind))return;
  arr.push(candidate);
 };
 for(const row of relationships.rows){
  push(row.person_id,{
    candidate_id:row.candidate_id,
    candidate_kind:'person',
    name:row.display_name||[row.first_name,row.last_name].filter(Boolean).join(' ')||'Unnamed person',
    relationship_type:row.relationship_type,
    confidence:Math.max(0,Math.min(1,Number(row.confidence)||0)),
    strength:Number(row.strength)||0,
    roles:String(row.roles||'').split(', ').filter(Boolean),
    evidence:row.evidence||{}
  });
 }
 for(const row of outcomes.rows){
  const successCount=Number(row.success_count)||0;
  push(row.person_id,{
    candidate_id:row.candidate_id,
    candidate_kind:'operator',
    name:'Operator',
    confidence:Math.max(.5,Math.min(1,.5+successCount*.1)),
    success_count:successCount,
    last_success:row.last_success,
    evidence:{successful_outcomes:successCount,last_success:row.last_success}
  });
 }
 const operatorIds=[...out.values()].flat().filter(x=>x.candidate_kind==='operator').map(x=>x.candidate_id);
 if(operatorIds.length){
  const users=(await pool.query(
   `SELECT id,name,email FROM users WHERE organization_id=$1 AND active=true AND id=ANY($2::uuid[])`,
   [organizationId,[...new Set(operatorIds.map(String))]]
  )).rows;
  const byId=new Map(users.map(u=>[String(u.id),u]));
  for(const arr of out.values())for(const x of arr)if(x.candidate_kind==='operator'){const u=byId.get(String(x.candidate_id));if(u)x.name=u.name||u.email||'Operator';}
 }
 for(const [k,arr] of out)arr.sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0)||Number(b.strength||0)-Number(a.strength||0)).splice(3);
 return out;
}
