
import{withAdmin}from'../../../../lib/apiHelpers';
import pool from'../../../../lib/db';
import{recordDiagnosticEvent}from'../../../../lib/diagnostics/server';

const clean=(value,max=1500)=>String(value??'').slice(0,max);

async function snapshot(orgId){
 const started=Date.now();
 const results=await Promise.allSettled([
  pool.query('SELECT 1'),
  pool.query('SELECT * FROM pgmq.metrics($1)',['nyeocare-attendance']),
  pool.query("SELECT count(*)::int AS count FROM cron.job WHERE active=true AND jobname LIKE 'nyeocare-attendance-worker-%'"),
  pool.query("SELECT count(*)::int AS count FROM sessions WHERE organization_id=$1 AND aria_processing_status IN ('pending','processing','needs_attention','failed')",[orgId]),
  pool.query("SELECT count(*)::int AS count FROM sessions WHERE organization_id=$1 AND aria_processing_status='processing' AND COALESCE(aria_processing_heartbeat_at,aria_processing_started_at,closed_at)<NOW()-INTERVAL '2 minutes'",[orgId]),
  pool.query("SELECT count(*)::int AS count FROM aria_actions WHERE organization_id=$1 AND status='proposed' AND expires_at IS NOT NULL AND expires_at<NOW()",[orgId]),
  pool.query("SELECT count(*)::int AS count FROM budget_reservations WHERE organization_id=$1 AND status='reserved' AND expires_at IS NOT NULL AND expires_at<NOW()",[orgId]),
  pool.query("SELECT count(*)::int AS count FROM system_diagnostic_events WHERE organization_id=$1 AND status<>'resolved'",[orgId]),
  pool.query("SELECT id,kind,severity,status,route,surface,message,occurrences,first_seen_at,last_seen_at,build_id,request_id FROM system_diagnostic_events WHERE organization_id=$1 AND status<>'resolved' ORDER BY last_seen_at DESC LIMIT 30",[orgId])
 ]);
 const value=i=>results[i].status==='fulfilled'?results[i].value:null;
 const dbMs=results[0].status==='fulfilled'?Date.now()-started:null;
 const queueRow=value(1)?.rows?.[0]||{};
 const workerCount=Number(value(2)?.rows?.[0]?.count||0);
 const pendingCount=Number(value(3)?.rows?.[0]?.count||0);
 const staleProcessing=Number(value(4)?.rows?.[0]?.count||0);
 const expiredActions=Number(value(5)?.rows?.[0]?.count||0);
 const expiredReservations=Number(value(6)?.rows?.[0]?.count||0);
 const openIssues=Number(value(7)?.rows?.[0]?.count||0);
 const issues=value(8)?.rows||[];
 const poolStats={total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount,max:pool.options.max};
 const checks=[
  {id:'database',label:'Database',status:results[0].status==='fulfilled'?(dbMs<=1500?'healthy':'slow'):'down',detail:results[0].status==='fulfilled'?String(dbMs)+'ms':'unavailable'},
  {id:'attendance_queue',label:'Attendance queue',status:results[1].status==='fulfilled'?(Number(queueRow.queue_length||0)===0?'healthy':'busy'):'down',detail:results[1].status==='fulfilled'?String(queueRow.queue_length||0)+' queued':'unavailable'},
  {id:'attendance_workers',label:'Attendance workers',status:results[2].status==='fulfilled'?(workerCount>0?'healthy':'missing'):'unknown',detail:results[2].status==='fulfilled'?String(workerCount)+' active':'unavailable'},
  {id:'processing_backlog',label:'ARIA processing',status:staleProcessing>0?'attention':'healthy',detail:staleProcessing>0?String(staleProcessing)+' stale processing jobs':String(pendingCount)+' jobs pending/processing'},
  {id:'expired_actions',label:'Expired ARIA actions',status:expiredActions>0?'attention':'healthy',detail:String(expiredActions)+' expired proposed actions'},
  {id:'expired_reservations',label:'AI budget reservations',status:expiredReservations>0?'attention':'healthy',detail:String(expiredReservations)+' expired reservations'},
  {id:'client_and_server_issues',label:'Observed app issues',status:openIssues>0?'attention':'healthy',detail:String(openIssues)+' unresolved diagnostic groups'}
 ];
 const overall=checks.some(x=>x.status==='down'||x.status==='missing'||x.status==='attention')?'attention':checks.some(x=>x.status==='slow'||x.status==='unknown')?'watch':'healthy';
 return{
  overall,
  checked_at:new Date().toISOString(),
  build_id:process.env.VERCEL_GIT_COMMIT_SHA||'unknown',
  checks,
  pool:poolStats,
  issues,
  recent:issues,
  duration_ms:Date.now()-started
 };
}

export default withAdmin(async function handler(req,res){
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(req.method==='POST'){
  const id=String(req.body?.id||'');
  const status=String(req.body?.status||'resolved');
  if(!id||!['acknowledged','resolved','open'].includes(status))return res.status(400).json({error:'Invalid diagnostic update.'});
  const result=await pool.query('UPDATE system_diagnostic_events SET status=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 RETURNING id,status',[status,id,req.org.id]);
  if(!result.rows[0])return res.status(404).json({error:'Diagnostic issue not found.'});
  return res.status(200).json({ok:true,...result.rows[0]});
 }
 try{
  return res.status(200).json(await snapshot(req.org.id));
 }catch(error){
  void recordDiagnosticEvent({
   organizationId:req.org.id,
   userId:req.user.id,
   kind:'diagnostics_failure',
   severity:'error',
   route:req.url,
   message:clean(error?.message||error),
   stack:error?.stack,
   requestId:req.nyeoRequestId
  });
  console.error('[DIAGNOSTICS] Snapshot failed:',error?.message||error);
  return res.status(503).json({error:'Diagnostics are temporarily unavailable.'});
 }
});
