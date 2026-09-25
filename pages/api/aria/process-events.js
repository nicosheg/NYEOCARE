// pages/api/aria/process-events.js
import{getCurrentCareUser}from'../../../lib/auth';
import pool from'../../../lib/db';
import{processPendingAriaEvents}from'../../../lib/aria/eventProcessor';

function cronAuthorized(req){
 const secret=process.env.CRON_SECRET;
 return Boolean(secret&&String(req.headers.authorization||'')==='Bearer '+secret);
}

export default async function handler(req,res){
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 try{
  let organizationId=null;
  const cron=cronAuthorized(req);
  if(!cron){
   const user=await getCurrentCareUser(req);
   if(!user?.organization_id)return res.status(401).json({error:'Unauthorized'});
   organizationId=user.organization_id;
  }
  const limit=Math.min(Math.max(parseInt(req.query?.limit,10)||25,1),100);
  if(cron){
   const orgs=await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 50');
   let found=0,succeeded=0,failed=0;
   for(const org of orgs.rows){
    const result=await processPendingAriaEvents({organizationId:org.id,limit});
    found+=result.found;succeeded+=result.succeeded;failed+=result.failed;
   }
   return res.status(200).json({ok:true,mode:'cron',organizations:orgs.rows.length,found,succeeded,failed});
  }
  const result=await processPendingAriaEvents({organizationId,limit});
  return res.status(200).json({ok:true,mode:'organization',organizationId,...result});
 }catch(e){
  console.error('[ARIA] process-events',e);
  return res.status(500).json({error:'Unable to process ARIA events right now.'});
 }
}
