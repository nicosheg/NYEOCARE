
import pool from'../../lib/db';

const QUEUE='nyeocare-attendance';

export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({status:'error',error:'Method not allowed'});
 const started=Date.now();
 const buildId=process.env.VERCEL_GIT_COMMIT_SHA||'unknown';
 let database='down',queue='unknown',workers='unknown';
 try{
  const dbStarted=Date.now();
  await pool.query('SELECT 1');
  const dbMs=Date.now()-dbStarted;
  database=dbMs<=1500?'ok':'slow';
 }catch(error){
  console.error('[HEALTH] Database check failed:',error?.message||error);
  return res.status(503).json({status:'degraded',build_id:buildId,database:'down',queue:'unknown',workers:'unknown'});
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
  console.error('[HEALTH] Worker check failed:',error?.message||error);
  workers='unknown';
 }
 const ok=database!=='down'&&queue!=='down'&&workers!=='missing';
 res.status(ok?200:503).json({
  status:ok?'ok':'degraded',
  build_id:buildId,
  database,
  queue,
  workers,
  duration_ms:Date.now()-started,
  checked_at:new Date().toISOString()
 });
}
