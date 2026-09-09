// pages/api/scan/start.js
import{withOrg}from'../../../lib/apiHelpers';
import{processVisionJob}from'../../../lib/visionProcessor';
import pool from'../../../lib/db';

async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});

 const{image_base64,program_name}=req.body||{};

 if(!image_base64||typeof image_base64!=='string'||image_base64.length<100)return res.status(400).json({error:'Image data is empty or invalid'});

 const orgId=req.org.id,actorId=req.user.id,programName=program_name||'GIBEON';

 try{
  const jobRes=await pool.query(`INSERT INTO scan_jobs(organization_id,status) VALUES($1,'pending') RETURNING id`,[orgId]);
  const jobId=jobRes.rows[0].id;

  res.status(200).json({
   job_id:jobId,
   status:'queued',
   progress:'queued',
   message:'ARIA is preparing the register…'
  });

  processVisionJob(jobId,image_base64,orgId,programName,{actorId,registerMode:'complete'}).catch(err=>console.error(`[SCAN] Background failure for ${jobId}:`,err?.message||err));
 }catch(err){
  console.error('[SCAN] Start failure:',err);
  if(!res.headersSent)return res.status(500).json({error:'ARIA could not start the scan. Please try again.'});
 }
}

export default withOrg(handler);
