// pages/api/identity/review-items.js
import pool from'../../../lib/db';
import{withAdmin}from'../../../lib/apiHelpers';

export default withAdmin(async function handler(req,res){
if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
const orgId=req.org.id;
try{
const r=await pool.query(`SELECT id,created_at,result FROM scan_jobs WHERE organization_id=$1 AND status='complete' AND result IS NOT NULL ORDER BY created_at DESC LIMIT 50`,[orgId]);
const items=[];
for(const row of r.rows){
const list=Array.isArray(row.result?.needs_review)?row.result.needs_review:[];
list.forEach((x,index)=>{
if(x?.resolved)return;
const candidates=Array.isArray(x.candidates)?x.candidates:[];
const best=candidates[0]||null;
items.push({
id:`${row.id}:${index}`,
scan_job_id:row.id,
review_index:index,
extracted_name:x.extracted_name||x.name||'Unknown person',
extracted_phone:x.extracted_phone||null,
status:x.status||'needs_decision',
confidence:x.confidence??null,
score:best?.score??x.score??0,
reasons:x.reasons||[],
evidence:x.evidence||[],
candidates,
best_candidate_id:x.best_candidate_id||best?.id||null,
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
