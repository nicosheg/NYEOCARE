// pages/api/diagnostics/client-error.js
import{withOrg}from'../../../lib/apiHelpers';

const clean=(value,max=6000)=>String(value??'').replace(/[\r\n]+/g,' ').slice(0,max);

export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const body=req.body||{};
 console.error('[NYEOCARE_CLIENT_ERROR]',JSON.stringify({
  surface:clean(body.surface,80),
  pathname:clean(body.pathname,300),
  message:clean(body.message,2000),
  stack:clean(body.stack,6000),
  componentStack:clean(body.componentStack,6000),
  userId:clean(req.user?.id,100),
  organizationId:clean(req.org?.id,100)
 }));
 return res.status(204).end();
});
