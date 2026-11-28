// pages/api/health.js
import pool from'../../lib/db';

const QUEUE='nyeocare-attendance';

export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({status:'error',error:'Method not allowed'});
 const started=Date.now();
 const buildId=process.env.VERCEL_GIT_COMMIT_SHA||'unknown';
 let database='down',queue='unknown',workers='unknown',aria_worker='unknown';
 try{
  const dbStarted=Date.now();
  await pool.query('SELECT 1');
  database=Date.now()-dbStarted<=1500?'ok':'slow';
 }catch(error){
  console.error('[HEALTH] Database check failed:',error?.message||error);
  return res.status(503).json({status:'degraded',build_id:buildId,database:'down',queue:'unknown',workers:'unknown',aria_worker:'unknown'});
 }
 try{
  const queueResult=await pool.query('SELECT * FROM pgmq.metrics($1)',[QUEUE]);
  queue=Number(queueResult.rows[0]?.queue_length||0)<=0?'ok':'busy';
 }catch(error){
  console.error('[HEALTH] Queue check failed:',error?.message||error);
  queue='down';
 }
 try{
  const workerResult=await pool.query("SELECT count(*)::int AS count FROM cron.job WHERE active=true AND jobname LIKE 'nyeocare-attendance-worker-%'");
  workers=Number(workerResult.rows[0]?.count||0)>=1?'ok':'missing';
 }catch(error){
  console.error('[HEALTH] Attendance worker check failed:',error?.message||error);
  workers='unknown';
 }
 try{
  const workerResult=await pool.query(`
   SELECT
    EXISTS(
     SELECT 1
     FROM cron.job j
     WHERE j.active=true
       AND j.jobname='nyeocare-aria-event-worker'
       AND EXISTS(
        SELECT 1
        FROM cron.job_run_details d
        WHERE d.jobid=j.jobid
          AND d.status='succeeded'
          AND d.end_time>NOW()-INTERVAL '3 minutes'
          AND d.start_time=(
           SELECT MAX(latest.start_time)
           FROM cron.job_run_details latest
           WHERE latest.jobid=j.jobid
          )
       )
    )
    AND EXISTS(
     SELECT 1
     FROM net._http_response r
     WHERE r.status_code=200
       AND r.created>NOW()-INTERVAL '3 minutes'
       AND r.content LIKE '%"mode":"cron"%'
    ) AS healthy
  `);
  aria_worker=workerResult.rows[0]?.healthy===true?'ok':'missing';
 }catch(error){
  console.error('[HEALTH] ARIA worker check failed:',error?.message||error);
  aria_worker='unknown';
 }
 const ok=database==='ok'&&(queue==='ok'||queue==='busy')&&workers==='ok'&&aria_worker==='ok';
 return res.status(ok?200:503).json({
  status:ok?'ok':'degraded',
  build_id:buildId,
  database,
  queue,
  workers,
  aria_worker,
  duration_ms:Date.now()-started,
  checked_at:new Date().toISOString()
 });
}
