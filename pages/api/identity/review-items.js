// pages/api/identity/review-items.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';
export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const{rows}=await pool.query(`SELECT id,living_truth,metadata FROM people WHERE organization_id=$1 AND status='active' AND living_truth->>'status' IN ('needs_decision','conflict') ORDER BY updated_at DESC,created_at DESC`,[req.org.id]);
  const items=rows.map(x=>({id:x.id,status:x.living_truth?.status||'needs_decision',name_suggestions:x.metadata?.name_suggestions||[],candidate_ids:x.metadata?.candidate_ids||[]}));
  return res.status(200).json({items,stats:{total:items.length,needs_decision:items.filter(x=>x.status==='needs_decision').length,conflict:items.filter(x=>x.status==='conflict').length}});
 }catch(e){console.error('[REVIEW ITEMS]',e);return res.status(500).json({error:'Unable to load identity reviews.'})}
});
