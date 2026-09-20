// lib/apiHelpers.js
// Canonical API authorization boundary.
import{getCurrentCareUser}from'./auth';

function instrument(req,res,start){
 const path=String(req?.url||'').split('?')[0]||'unknown';
 let ended=false;
 const finish=()=>{
  if(ended)return;
  ended=true;
  const ms=Number(((typeof performance!=='undefined'?performance.now():Date.now())-start).toFixed(1));
  try{if(!res.headersSent)res.setHeader('Server-Timing',`nyeocare;dur=${ms}`)}catch{}
  console.info('[PERF]',req.method,path,ms+'ms');
 };
 const end=res.end?.bind(res);
 if(end)res.end=(...args)=>{finish();return end(...args)};
 return finish;
}

export function withOrg(handler){return async(req,res)=>{
 const start=typeof performance!=='undefined'?performance.now():Date.now(),finish=instrument(req,res,start);
 try{
  const user=await getCurrentCareUser(req);
  if(!user)return res.status(401).json({error:'Unauthorized'});
  if(!user.organization_id){console.error('[AUTH] User resolved without organization:',user.id);return res.status(403).json({error:'Organization access is not configured.'})}
  req.user=user;req.org={id:user.organization_id,name:user.organization_name};
  return await handler(req,res);
 }catch(err){
  const code=err?.code||'AUTH_SERVICE_UNAVAILABLE';
  console.error('[AUTH] withOrg failure:',code,err?.message||err);
  return res.status(code==='AUTH_STORAGE_UNAVAILABLE'?503:500).json({error:code==='AUTH_STORAGE_UNAVAILABLE'?'Authentication storage is temporarily busy. Please try again in a moment.':'Authentication service unavailable.',code});
 }finally{finish();}
}}
export function withAdmin(handler){return withOrg(async(req,res)=>{if(!['owner','admin'].includes(req.user.role))return res.status(403).json({error:'Admin permissions required'});return handler(req,res)})}
