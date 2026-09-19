// pages/api/attendance/process-session.js
import{withAdmin}from'../../../lib/apiHelpers';import{generateParticipationFromSession}from'../../../lib/aria/participationGenerator';
export default withAdmin(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const{session_id}=req.body||{};if(!session_id)return res.status(400).json({error:'session_id is required.'});
 try{return res.status(200).json({success:true,aria:await generateParticipationFromSession(session_id,req.org.id)});}
 catch(e){
  console.error('[ATTENDANCE] Retry ARIA processing:',e);
  return res.status(500).json({error:'ARIA could not finish processing this attendance yet. Please retry once more. Your saved attendance records are safe.'});
 }
});
