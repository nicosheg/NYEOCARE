// pages/api/scan/start.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';
import{processVisionJob}from'../../../lib/visionProcessor';
import{getScanAdmission}from'../../../lib/aiProvider';

export const config={api:{bodyParser:{sizeLimit:'6mb'}}};

async function handler(req,res){
if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
const{image_base64,program_name}=req.body||{};
if(typeof image_base64!=='string'||image_base64.length<100)return res.status(400).json({error:'Image data is empty or invalid'});
if(image_base64.length>5000000)return res.status(413).json({error:'The prepared image is too large. Please retake the photo from a little farther away.'});
const admission=getScanAdmission();
if(!admission.allowed)return res.status(admission.code==='AI_CAPACITY_LOW'?429:503).json({error:admission.message,code:admission.code,retry_after_seconds:admission.retry_after_seconds||null});
const orgId=req.org.id,actorId=req.user.id,programName=typeof program_name==='string'&&program_name.trim()?program_name.trim():'GIBEON';
try{
const active=await pool.query(`SELECT id FROM scan_jobs WHERE organization_id=$1 AND status IN('pending','processing','retrying') AND created_at>NOW()-INTERVAL'15 minutes' LIMIT 1`,[orgId]);
if(active.rows.length)return res.status(409).json({error:'ARIA is already processing a register for this organization.',code:'SCAN_ALREADY_RUNNING',job_id:active.rows[0].id});
const jobRes=await pool.query(`INSERT INTO scan_jobs(organization_id,status,progress) VALUES($1,'pending','queued') RETURNING id`,[orgId]);
const jobId=jobRes.rows[0].id;
res.status(200).json({job_id:jobId,status:'pending',progress:'queued',pipeline:'v9-single-pass-vision',token_plan:{extract_max:720,audit_max:0,safety:80}});
processVisionJob(jobId,image_base64,orgId,programName,{actorId,registerMode:'complete'}).catch(err=>console.error(`[SCAN] Background job ${jobId} failed:`,err?.message||err));
}catch(err){
console.error('[SCAN] Start error:',err);
if(!res.headersSent)res.status(500).json({error:'ARIA could not start the scan.'});
}
}
export default withOrg(handler);
