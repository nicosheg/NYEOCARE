// pages/api/aria/process-events.js
import{timingSafeEqual}from'node:crypto';
import{getCurrentCareUser}from'../../../lib/auth';
import{processPendingAriaEvents}from'../../../lib/aria/eventProcessor';

function cronAuthorized(req){
 const secret=process.env.CRON_SECRET;
 if(!secret)return false;
 const received=Buffer.from(String(req.headers.authorization||''),'utf8');
 const expected=Buffer.from('Bearer '+secret,'utf8');
 return received.length===expected.length&&timingSafeEqual(received,expected);
}

export default async function handler(req,res){
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 res.setHeader('Cache-Control','private,no-store,max-age=0,must-revalidate');
 try{
  const cron=cronAuthorized(req);
  let organizationId=null;
  if(!cron){
   const user=await getCurrentCareUser(req);
   if(!user?.organization_id)return res.status(401).json({error:'Unauthorized'});
   organizationId=user.organization_id;
  }
  const rawLimit=Array.isArray(req.query?.limit)?req.query.limit[0]:req.query?.limit;
  const requested=Number.parseInt(rawLimit,10);
  const limit=Math.min(Math.max(Number.isFinite(requested)?requested:25,1),100);
  const result=await processPendingAriaEvents({organizationId,limit});
  return res.status(200).json({
   ok:true,
   mode:cron?'cron':'organization',
   ...(cron?{}:{organizationId}),
   ...result
  });
 }catch(error){
  console.error('[ARIA] process-events',error);
  return res.status(500).json({error:'Unable to process ARIA events right now.'});
 }
}
