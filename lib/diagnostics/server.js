
import crypto from'node:crypto';
import pool from'../db';

const clean=(value,max=2000)=>String(value??'').replace(/[\\r\\n]+/g,' ').slice(0,max);
const stack=(value,max=6000)=>String(value??'').slice(0,max);
const normalizeForFingerprint=value=>String(value||'')
 .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,'<id>')
 .replace(/\\b\\d{5,}\\b/g,'<n>')
 .toLowerCase().slice(0,500);

export function diagnosticFingerprint({kind,message,route,statusCode=''}) {
 return crypto.createHash('sha256')
  .update([kind,normalizeForFingerprint(message),String(route||''),String(statusCode||'')].join('|'))
  .digest('hex')
  .slice(0,32);
}

export function recordDiagnosticEvent(event){
 const organizationId=event?.organizationId?String(event.organizationId):null;
 if(!organizationId)return Promise.resolve(null);
 const message=clean(event.message||'Unknown diagnostic event',4000);
 const route=clean(event.route||'',500);
 const kind=clean(event.kind||'server_error',80);
 const severity=['info','warning','error','fatal'].includes(event.severity)?event.severity:'error';
 const status=event.status==='resolved'||event.status==='acknowledged'?'acknowledged':'open';
 const buildId=clean(event.buildId||process.env.VERCEL_GIT_COMMIT_SHA||'unknown',120);
 const fingerprint=event.fingerprint||diagnosticFingerprint({kind,message,route,statusCode:event.statusCode});
 const metadata=event.metadata&&typeof event.metadata==='object'?event.metadata:{};
 return pool.query(
  `INSERT INTO system_diagnostic_events
   (organization_id,user_id,kind,severity,status,fingerprint,route,surface,message,stack,request_id,build_id,user_agent,metadata)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
   ON CONFLICT(organization_id,fingerprint,route,build_id)
   DO UPDATE SET
     severity=CASE WHEN EXCLUDED.severity='fatal' THEN 'fatal' ELSE system_diagnostic_events.severity END,
     status=CASE WHEN system_diagnostic_events.status='resolved' THEN 'open' ELSE system_diagnostic_events.status END,
     message=EXCLUDED.message,
     stack=CASE WHEN EXCLUDED.stack<>'' THEN EXCLUDED.stack ELSE system_diagnostic_events.stack END,
     request_id=COALESCE(EXCLUDED.request_id,system_diagnostic_events.request_id),
     user_agent=CASE WHEN EXCLUDED.user_agent<>'' THEN EXCLUDED.user_agent ELSE system_diagnostic_events.user_agent END,
     metadata=COALESCE(system_diagnostic_events.metadata,'{}'::jsonb)||COALESCE(EXCLUDED.metadata,'{}'::jsonb),
     occurrences=system_diagnostic_events.occurrences+1,
     last_seen_at=NOW(),
     updated_at=NOW()
   RETURNING id,fingerprint,occurrences,last_seen_at`,
  [
   organizationId,
   event.userId?String(event.userId):null,
   kind,
   severity,
   status,
   fingerprint,
   route,
   clean(event.surface||'',160),
   message,
   stack(event.stack||''),
   clean(event.requestId||'',160)||null,
   buildId,
   clean(event.userAgent||'',700),
   JSON.stringify(metadata)
  ]
 ).then(r=>r.rows[0]||null).catch(error=>{
  console.error('[DIAGNOSTICS] Persistence failed:',error?.message||error);
  return null;
 });
}
