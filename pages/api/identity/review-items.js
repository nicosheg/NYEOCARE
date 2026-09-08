// pages/api/identity/review-items.js
import pool from'../../../lib/db';
import{withAdmin}from'../../../lib/apiHelpers';
import{fuzzyMatch,normalizeName}from'../../../lib/scanValidation';

export default withAdmin(async function handler(req,res){
if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
const orgId=req.org.id;
try{
const[r,p]=await Promise.all([
pool.query(`SELECT id,created_at,result FROM scan_jobs WHERE organization_id=$1 AND status='complete' AND result IS NOT NULL ORDER BY created_at DESC LIMIT 50`,[orgId]),
pool.query(`SELECT id,first_name,last_name,display_name,phone FROM people WHERE organization_id=$1 AND status='active'`,[orgId])
]);
const people=p.rows,items=[];
for(const row of r.rows){
const list=Array.isArray(row.result?.needs_review)?row.result.needs_review:[];
list.forEach((x,index)=>{
if(x?.resolved)return;
const extractedName=x.extracted_name||x.name||'Unknown person';
const key=normalizeName(extractedName);
const candidates=key?people.map(person=>({id:person.id,name:person.display_name||[person.first_name,person.last_name].filter(Boolean).join(' '),phone:person.phone,score:Math.round(fuzzyMatch(key,person.display_name||[person.first_name,person.last_name].filter(Boolean).join(' '))*100),method:'name'})).filter(x=>x.score>=72).sort((a,b)=>b.score-a.score).slice(0,5):[];
items.push({
id:`${row.id}:${index}`,
scan_job_id:row.id,
review_index:index,
extracted_name:extractedName,
extracted_phone:x.extracted_phone||null,
status:x.status||'needs_decision',
confidence:x.confidence??null,
score:candidates[0]?.score??x.score??0,
reasons:Array.isArray(x.reasons)?x.reasons:[],
evidence:x.evidence||null,
verification_alternatives:x.verification_alternatives||null,
candidates,
best_candidate_id:x.best_candidate_id||candidates[0]?.id||null,
evidence_url:`/api/scan/evidence?job_id=${encodeURIComponent(row.id)}`,
created_at:row.created_at
});
});
}
return res.status(200).json({items,stats:{total:items.length,needs_decision:items.filter(x=>x.status==='needs_decision').length,conflict:items.filter(x=>x.status==='conflict').length}});
}catch(e){
console.error('[REVIEW ITEMS]',e);
return res.status(500).json({error:'Unable to load identity reviews.'});
}
});
