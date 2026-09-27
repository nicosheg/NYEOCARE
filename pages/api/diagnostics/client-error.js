import{withOrg}from'../../../lib/apiHelpers';
import{recordDiagnosticEvent}from'../../../lib/diagnostics/server';

const clean=(value,max=6000)=>String(value??'').replace(/[\\r\\n]+/g,' ').slice(0,max);

export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const body=req.body||{};
 const kind=String(body.kind||'client_error').slice(0,80);
 const severity=['info','warning','error','fatal'].includes(body.severity)?body.severity:'error';
 const event={
  organizationId:req.org.id,
  userId:req.user.id,
  kind,
  severity,
  surface:clean(body.surface||'client',120),
  pathname:clean(body.pathname||req.url,500),
  route:clean(body.route||body.pathname||'',500),
  message:clean(body.message||'Unknown client error',3000),
  stack:String(body.stack||'').slice(0,7000),
  requestId:clean(body.requestId||req.nyeoRequestId,160),
  buildId:clean(body.buildId||process.env.VERCEL_GIT_COMMIT_SHA||'unknown',120),
  userAgent:clean(body.userAgent||req.headers['user-agent']||'',700),
  statusCode:body.metadata?.status??null,
  metadata:body.metadata&&typeof body.metadata==='object'?body.metadata:{}
 };
 console.error('[NYEOCARE_CLIENT_ERROR]',JSON.stringify(event));
 void recordDiagnosticEvent(event);
 return res.status(204).end();
});