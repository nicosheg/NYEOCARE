import crypto from'node:crypto';
import{getCurrentCareUser}from'./auth';
import{recordDiagnosticEvent}from'./diagnostics/server';

function instrument(req,res,start,requestId){
 const path=String(req?.url||'').split('?')[0]||'unknown';
 let ended=false;
 try{if(!res.headersSent)res.setHeader('X-NYEO-Request-ID',requestId)}catch{}
 const finish=()=>{
  if(ended)return;
  ended=true;
  const now=typeof performance!=='undefined'?performance.now():Date.now();
  const ms=Number((now-start).toFixed(1));
  try{
   if(!res.headersSent)res.setHeader('Server-Timing',`nyeocare;dur=${ms}`);
   console.info('[PERF]',req.method,path,`${ms}ms`,`status=${res.statusCode}`,`request_id=${requestId}`);
  }catch{}
 };
 const end=res.end?.bind(res);
 if(end)res.end=(...args)=>{finish();return end(...args)};
 return finish;
}

export function withOrg(handler){return async(req,res)=>{
 const start=typeof performance!=='undefined'?performance.now():Date.now();
 const requestId=String(req?.headers?.['x-nyeo-request-id']||crypto.randomUUID());
 req.nyeoRequestId=requestId;
 const finish=instrument(req,res,start,requestId);
 try{
  const user=await getCurrentCareUser(req);
  if(!user)return res.status(401).json({error:'Unauthorized',request_id:requestId});
  if(!user.organization_id){
   console.error('[AUTH] User resolved without organization:',user.id);
   return res.status(403).json({error:'Organization access is not configured.',request_id:requestId});
  }
  req.user=user;req.org={id:user.organization_id,name:user.organization_name};

  try{
   return await handler(req,res);
  }catch(error){
   void recordDiagnosticEvent({
    organizationId:req.org.id,
    userId:req.user.id,
    kind:'server_error',
    severity:'error',
    surface:'api',
    route:String(req.url||'').split('?')[0],
    message:error?.message||error,
    stack:error?.stack,
    requestId,
    buildId:process.env.VERCEL_GIT_COMMIT_SHA||'unknown',
    metadata:{method:req.method,status_code:error?.statusCode||500}
   });
   console.error('[API] Unhandled route error:',{request_id:requestId,path:String(req.url||'').split('?')[0],error:error?.message||error});
   return res.status(500).json({error:'Server error.',code:'INTERNAL_SERVER_ERROR',request_id:requestId});
  }
 }catch(err){
  if(err?.code==='AUTH_STORAGE_UNAVAILABLE'){
   console.error('[AUTH] withOrg failure:',err.code,err?.message||err);
   return res.status(503).json({error:'Authentication storage is temporarily busy. Please try again in a moment.',code:err.code,request_id:requestId});
  }
  if(req.org?.id){
   void recordDiagnosticEvent({
    organizationId:req.org.id,
    userId:req.user?.id||null,
    kind:'api_wrapper_error',
    severity:'error',
    surface:'api-wrapper',
    route:String(req.url||'').split('?')[0],
    message:err?.message||err,
    stack:err?.stack,
    requestId,
    buildId:process.env.VERCEL_GIT_COMMIT_SHA||'unknown',
    metadata:{method:req.method}
   });
  }
  console.error('[AUTH] withOrg failure:',err?.message||err);
  return res.status(500).json({error:'Authentication service unavailable.',code:'AUTH_SERVICE_UNAVAILABLE',request_id:requestId});
 }finally{finish();}
}}
export function withAdmin(handler){return withOrg(async(req,res)=>{
 if(!['owner','admin'].includes(req.user.role))return res.status(403).json({error:'Admin permissions required',request_id:req.nyeoRequestId});
 return handler(req,res);
})}