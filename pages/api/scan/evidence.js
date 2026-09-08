// pages/api/scan/evidence.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

async function handler(req,res){
if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
const jobId=String(req.query.job_id||'').trim();
if(!jobId)return res.status(400).json({error:'Missing job_id'});
try{
const r=await pool.query(`SELECT mime_type,image_data FROM scan_evidence WHERE scan_job_id=$1 AND organization_id=$2 LIMIT 1`,[jobId,req.org.id]);
if(!r.rows.length)return res.status(404).json({error:'Scan evidence not found'});
res.setHeader('Content-Type',r.rows[0].mime_type||'image/jpeg');
res.setHeader('Cache-Control','private,no-store,max-age=0');
return res.status(200).send(r.rows[0].image_data);
}catch(err){
console.error('[SCAN EVIDENCE]',err);
return res.status(500).json({error:'Unable to load scan evidence.'});
}
}
export default withOrg(handler);
