// pages/api/attendance/history.js
import { withOrg } from '../../../lib/apiHelpers';
import { isOrganizationOperator } from '../../../lib/attendance/access';
import { getAttendanceHistory, getAttendanceSessionSummary } from '../../../lib/attendance/history';

export default withOrg(async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'Method not allowed.'});
  }
  if(!isOrganizationOperator(req.user?.role)){
    return res.status(403).json({error:'Attendance history is limited to authorized organization operators.'});
  }
  res.setHeader('Cache-Control','no-store');
  try{
    const summaryOnly=String(req.query.summary_only||'')==='1';
    const sessionId=Array.isArray(req.query.session_id)?req.query.session_id[0]:req.query.session_id||null;
    if(summaryOnly){
      if(!sessionId)return res.status(400).json({success:false,error:'session_id is required for a saved attendance summary.'});
      const summary=await getAttendanceSessionSummary(undefined,req.org.id,sessionId);
      if(summary.session.status!=='closed')return res.status(409).json({success:false,error:'Only saved attendance sessions have a summary.',code:'ATTENDANCE_HISTORY_SESSION_NOT_CLOSED'});
      return res.status(200).json({success:true,summary});
    }
    const result=await getAttendanceHistory({
      organizationId:req.org.id,
      sessionId,
      cursor:Array.isArray(req.query.cursor)?req.query.cursor[0]:req.query.cursor||null,
      limit:Array.isArray(req.query.limit)?req.query.limit[0]:req.query.limit||20
    });
    return res.status(200).json({success:true,...result});
  }catch(error){
    if(error?.status)return res.status(error.status).json({success:false,error:error.message,code:error.code||'ATTENDANCE_HISTORY_REQUEST_INVALID'});
    console.error('[ATTENDANCE_HISTORY] Read failed:',error);
    return res.status(500).json({success:false,error:'Could not load saved attendance history.'});
  }
});
