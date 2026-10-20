import{withOrg}from'../../../lib/apiHelpers';
import{getScanAdmissionStatus}from'../../../lib/aiProvider';

async function handler(req,res){
 res.setHeader('Cache-Control','no-store,no-cache,must-revalidate,private');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const admission=await getScanAdmissionStatus(),now=new Date(),retrySeconds=admission.code==='AI_RATE_LIMIT'?Math.max(0,Number(admission.retry_after_seconds)||0):0;
  return res.status(200).json({...admission,retry_after_seconds:retrySeconds,retry_at:retrySeconds>0?new Date(now.getTime()+retrySeconds*1000).toISOString():null,server_now:now.toISOString()});
 }catch(err){
  console.error('[SCAN ADMISSION] Check failed:',err?.message||err);
  return res.status(503).json({allowed:false,code:'SCAN_ADMISSION_UNAVAILABLE',error:'ARIA could not confirm scan capacity right now. Please try again shortly.'});
 }
}
export default withOrg(handler);
