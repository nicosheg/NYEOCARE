// pages/api/review/index.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const rows=await pool.query(`SELECT id,first_name,last_name,display_name,phone,type,confidence,quarantine_reason,quarantined_at,last_scan_job_id,metadata,created_at FROM people WHERE organization_id=$1 AND status='quarantined' ORDER BY quarantined_at DESC NULLS LAST,created_at DESC`,[req.org.id]);
  const items=rows.rows.map(x=>({id:x.id,name:x.display_name||[x.first_name,x.last_name].filter(Boolean).join(' '),first_name:x.first_name,last_name:x.last_name,phone:x.phone,type:x.type,confidence:x.confidence,reason:x.quarantine_reason||'ARIA found something that needs your attention.',suggestion:x.metadata?.review_suggestion||'Review the original register and confirm the information.',raw_name:x.metadata?.raw_name||null,raw_phone:x.metadata?.raw_phone||null,row_number:x.metadata?.row_number??null,scan_job_id:x.last_scan_job_id,scan_pipeline_version:x.metadata?.scan_pipeline_version||null,review_reasons:x.metadata?.review_reasons||[],created_at:x.created_at,quarantined_at:x.quarantined_at}));
  return res.status(200).json({items,total:items.length});
 }catch(err){
  console.error('[REVIEW] List error:',err);
  return res.status(500).json({error:'Review Center could not load.'});
 }
}
export default withOrg(handler);
