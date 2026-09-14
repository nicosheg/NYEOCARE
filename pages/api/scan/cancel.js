// pages/api/scan/cancel.js
import{withOrg}from'../../../lib/apiHelpers';
import pool from'../../../lib/db';
async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const{job_id}=req.body||{};if(!job_id)return res.status(400).json({error:'Missing job_id'});
 try{const result=await pool.query(`UPDATE scan_jobs SET status='failed',progress='failed',error_code='SCAN_CANCELLED',result=jsonb_build_object('error',jsonb_build_object('stage','scan','code','SCAN_CANCELLED','message','Scan cancelled by user.','userMessage','Scan cancelled. Your existing data is safe.')),completed_at=NOW(),duration_ms=CASE WHEN started_at IS NULL THEN NULL ELSE GREATEST(0,ROUND(EXTRACT(EPOCH FROM(NOW()-started_at))*1000)::int) END,heartbeat=NOW(),last_progress_at=NOW() WHERE id=$1 AND organization_id=$2 AND status IN('pending','processing','retrying') RETURNING id,status,progress`,[job_id,req.org.id]);if(!result.rows.length)return res.status(200).json({ok:true,status:'already_finished'});return res.status(200).json({ok:true,status:'cancelled',job_id:result.rows[0].id})}catch(err){console.error('[SCAN] Cancel failure:',err);return res.status(500).json({error:'ARIA could not cancel this scan safely.'})}}
export default withOrg(handler);
