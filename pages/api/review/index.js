// pages/api/review/index.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';
export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const{rows}=await pool.query(`SELECT id,first_name,last_name,display_name,phone,phone_numbers,type,quarantine_reason,last_scan_job_id,living_truth,metadata,created_at,updated_at FROM people WHERE organization_id=$1 AND status='active' AND living_truth->>'status' IN ('needs_decision','conflict') ORDER BY updated_at DESC,created_at DESC`,[req.org.id]);
  const items=rows.map(x=>({id:x.id,name:x.display_name||[x.first_name,x.last_name].filter(Boolean).join(' '),first_name:x.first_name,last_name:x.last_name,phone:x.phone,phones:x.phone_numbers||[],type:x.type,status:x.living_truth?.status||'needs_decision',reason:x.quarantine_reason||'ARIA found something that needs your attention.',suggestion:x.metadata?.review_suggestion||'Review the evidence and decide what is true.',raw_name:x.metadata?.raw_name||null,raw_phones:x.metadata?.raw_phones||[],row_number:x.metadata?.row_number??null,scan_job_id:x.last_scan_job_id,candidate_ids:Array.isArray(x.metadata?.candidate_ids)?x.metadata.candidate_ids:[],candidates:Array.isArray(x.metadata?.candidate_details)?x.metadata.candidate_details:[],name_suggestions:Array.isArray(x.metadata?.name_suggestions)?x.metadata.name_suggestions:[],review_reasons:x.metadata?.review_reasons||[],created_at:x.created_at,updated_at:x.updated_at}));
  return res.status(200).json({items,total:items.length});
 }catch(err){console.error('[REVIEW] List error:',err);return res.status(500).json({error:'Review Center could not load.'})}
});
