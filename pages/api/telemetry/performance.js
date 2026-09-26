// pages/api/telemetry/performance.js
import{withOrg}from'../../../lib/apiHelpers';
const METRIC=/^(app_|people_|attendance_|scan_|identity_|aria_|sync_)[a-z0-9_]+$/i;
export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).end();
 const{metric,duration_ms,status='ok',meta={}}=req.body||{},duration=Number(duration_ms);
 if(!metric||!METRIC.test(String(metric))||!Number.isFinite(duration)||duration<0||duration>300000)return res.status(400).json({error:'Invalid performance metric.'});
 const safeMeta={};for(const[k,v]of Object.entries(meta&&typeof meta==='object'?meta:{}).slice(0,8)){if(v!==undefined&&v!==null)safeMeta[k]=typeof v==='number'&&Number.isFinite(v)?v:typeof v==='boolean'?v:String(v).slice(0,120)}
 console.info('[NYEO_PERF]',JSON.stringify({organization:req.org.id,metric:String(metric),duration_ms:Math.round(duration),status:String(status).slice(0,30),meta:safeMeta}));return res.status(204).end();
});