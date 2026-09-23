
const STATUS=new Set(['verified','observed','reported','inferred','conflicted','unknown','stale']);
const KIND=new Set(['fact','observation','human_report','inference','uncertainty']);

export function clampConfidence(value,fallback=0){
 const n=Number(value);
 return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;
}

export function evidence({kind='observation',status='observed',source='system',sourceId=null,statement='',occurredAt=null,confidence=.5,authority='system',metadata={}}={}){
 return{
  kind:KIND.has(kind)?kind:'observation',
  status:STATUS.has(status)?status:'unknown',
  authority:String(authority||'system'),
  source:String(source||'unknown'),
  source_id:sourceId?String(sourceId):null,
  statement:String(statement||'').trim().slice(0,1200),
  occurred_at:occurredAt||null,
  confidence:clampConfidence(confidence,.5),
  metadata:metadata&&typeof metadata==='object'&&!Array.isArray(metadata)?metadata:{}
 };
}

export function detectConflicts(claims=[]){
 const groups=new Map();
 for(const claim of Array.isArray(claims)?claims:[]){
  if(!claim?.key)continue;
  const value=JSON.stringify(claim.value);
  const bucket=groups.get(claim.key)||new Map();
  bucket.set(value,claim);
  groups.set(claim.key,bucket);
 }
 const conflicts=[];
 for(const [key,values] of groups){
  if(values.size>1)conflicts.push({key,values:[...values.values()].map(v=>({value:v.value,status:v.status,source:v.source,occurred_at:v.occurred_at}))});
 }
 return conflicts;
}

export function uniqueEvidence(items=[]){
 const out=[];const seen=new Set();
 for(const item of Array.isArray(items)?items:[]){
  if(!item?.statement)continue;
  const key=[item.kind,item.source,item.source_id,item.occurred_at,item.statement].join('|');
  if(seen.has(key))continue;
  seen.add(key);out.push(item);
 }
 return out;
}
