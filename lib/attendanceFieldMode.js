// lib/attendanceFieldMode.js
import{getClientSession,refreshClientSession}from'./clientSession';

const DB_NAME='nyeocare-field-mode',DB_VERSION=1;
const STORES={sessions:'sessions',people:'people',mutations:'mutations'};
let dbPromise=null,syncPromise=null;
const FIELD_REQUEST_TIMEOUT_MS=12000;
async function fetchFieldWithTimeout(url,options={}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),FIELD_REQUEST_TIMEOUT_MS);
 try{return await fetch(url,{...options,signal:controller.signal})}
 catch(error){if(controller.signal.aborted){const timeout=new Error('Field Mode request timed out.');timeout.name='TimeoutError';timeout.transient=true;throw timeout}throw error}
 finally{clearTimeout(timer)}
}
const supported=()=>typeof window!=='undefined'&&typeof window.indexedDB!=='undefined';
const keyFor=(sessionId,userId,personId)=>String(sessionId)+':'+String(userId)+':'+String(personId);
const emit=(kind='local',detail={})=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('nyeocare:field-sync',{detail:{kind,...detail,at:Date.now()}}))};

function openDb(){
 if(!supported())return Promise.resolve(null);
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  const r=window.indexedDB.open(DB_NAME,DB_VERSION);
  r.onupgradeneeded=()=>{
   const db=r.result;
   if(!db.objectStoreNames.contains(STORES.sessions)){const s=db.createObjectStore(STORES.sessions,{keyPath:'key'});s.createIndex('userId','userId',{unique:false})}
   if(!db.objectStoreNames.contains(STORES.people)){const s=db.createObjectStore(STORES.people,{keyPath:'key'});s.createIndex('sessionId','sessionId',{unique:false})}
   if(!db.objectStoreNames.contains(STORES.mutations)){const s=db.createObjectStore(STORES.mutations,{keyPath:'key'});s.createIndex('sessionId','sessionId',{unique:false})}
  };
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>{dbPromise=null;reject(r.error||new Error('IndexedDB unavailable.'))}
 });return dbPromise;
}
async function readAll(name){
 const db=await openDb();if(!db)return[];
 return new Promise((resolve,reject)=>{const tx=db.transaction(name,'readonly'),r=tx.objectStore(name).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error||new Error('Local store read failed.'))})
}
async function putRows(name,rows){
 const db=await openDb();if(!db)return;
 return new Promise((resolve,reject)=>{const tx=db.transaction(name,'readwrite'),s=tx.objectStore(name);rows.forEach(x=>s.put(x));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Local store write failed.'))})
}
async function deleteKeys(name,keys){
 const db=await openDb();if(!db)return;
 return new Promise((resolve,reject)=>{const tx=db.transaction(name,'readwrite'),s=tx.objectStore(name);keys.forEach(x=>s.delete(x));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Local store delete failed.'))})
}
export function isFieldModeSupported(){return supported()}
export async function saveFieldSession(userId,session,options={}){
 if(!userId||!session?.session_id)return;
 const rows=await readAll(STORES.sessions),old=rows.find(x=>x.userId===String(userId)&&x.sessionId===String(session.session_id));
 await putRows(STORES.sessions,[{key:String(userId)+':'+String(session.session_id),userId:String(userId),sessionId:String(session.session_id),session,closeRequested:Boolean(options.closeRequested)||Boolean(old?.closeRequested),updatedAt:Date.now()}])
}
export async function getFieldSession(userId){
 if(!userId)return null;
 const rows=(await readAll(STORES.sessions)).filter(x=>x.userId===String(userId)&&(x.session?.status==='active'||x.closeRequested));
 rows.sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));return rows[0]||null;
}
export async function setFieldCloseRequested(userId,sessionId,value=true){
 const rows=await readAll(STORES.sessions),row=rows.find(x=>x.userId===String(userId)&&x.sessionId===String(sessionId));if(!row)return;
 row.closeRequested=value===true;row.updatedAt=Date.now();await putRows(STORES.sessions,[row]);emit();
}
export async function saveFieldPeople(sessionId,people,options={}){
 if(!sessionId||!Array.isArray(people))return;
 if(options.replace){const rows=await readAll(STORES.people),keys=rows.filter(x=>x.sessionId===String(sessionId)).map(x=>x.key);if(keys.length)await deleteKeys(STORES.people,keys)}
 const values=people.filter(x=>x?.id).map(p=>({key:keyFor(sessionId,p.id),sessionId:String(sessionId),person:{...p},updatedAt:Date.now()}));
 if(values.length)await putRows(STORES.people,values);
}
export async function getFieldPeople(sessionId){if(!sessionId)return[];return(await readAll(STORES.people)).filter(x=>x.sessionId===String(sessionId)).map(x=>x.person)}
export async function getPendingFieldMutations(sessionId,userId){
 if(!userId)return[];
 return(await readAll(STORES.mutations)).filter(x=>x.status==='pending'&&x.userId===String(userId)&&(!sessionId||x.sessionId===String(sessionId))).sort((a,b)=>Number(a.updatedAt||0)-Number(b.updatedAt||0))
}
export async function getFieldPendingCount(sessionId,userId){return(await getPendingFieldMutations(sessionId,userId)).length}
export async function getUnattributedPendingFieldMutationCount(sessionId){return(await readAll(STORES.mutations)).filter(x=>x.status==='pending'&&!x.userId&&(!sessionId||x.sessionId===String(sessionId))).length}
export async function enqueueFieldMutation({sessionId,userId,personId,present}){
 if(!sessionId||!userId||!personId)return;
 await putRows(STORES.mutations,[{key:keyFor(sessionId,userId,personId),sessionId:String(sessionId),userId:String(userId),personId:String(personId),present:Boolean(present),status:'pending',updatedAt:Date.now()}]);emit('local',{sessionId:String(sessionId),userId:String(userId),personId:String(personId)});
}
export async function removeFieldMutation(sessionId,userId,personId){if(!sessionId||!userId||!personId)return;await deleteKeys(STORES.mutations,[keyFor(sessionId,userId,personId)]);emit('local',{sessionId:String(sessionId),userId:String(userId),personId:String(personId)})}
export async function clearFieldSession(userId,sessionId){
 const[a,b,c]=await Promise.all([readAll(STORES.sessions),readAll(STORES.people),readAll(STORES.mutations)]);
 const uid=String(userId),sid=String(sessionId);
 const sk=a.filter(x=>x.userId===uid&&x.sessionId===sid).map(x=>x.key);
 const hasOtherOwner=a.some(x=>x.sessionId===sid&&x.userId!==uid);
 const pk=hasOtherOwner?[]:b.filter(x=>x.sessionId===sid).map(x=>x.key);
 const mk=c.filter(x=>x.sessionId===sid&&x.userId===uid).map(x=>x.key);
 if(sk.length)await deleteKeys(STORES.sessions,sk);if(pk.length)await deleteKeys(STORES.people,pk);if(mk.length)await deleteKeys(STORES.mutations,mk);emit('clear',{sessionId:sid,userId:uid});
}
async function authedFetch(url,options={}){
 let s=await getClientSession();if(!s)return null;
 let h={...(options.headers||{}),Authorization:'Bearer '+s.access_token};
 let r=await fetchFieldWithTimeout(url,{...options,headers:h});
 if(r.status===401){s=await refreshClientSession().catch(()=>null);if(!s)return r;r=await fetchFieldWithTimeout(url,{...options,headers:{...(options.headers||{}),Authorization:'Bearer '+s.access_token}})}
 return r;
}
async function readJson(r){const t=await r.text();if(!t)return{};try{return JSON.parse(t)}catch{return{error:'Request failed ('+r.status+').'}}}
function chunks(a,n){const out=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out}
async function syncSession(sessionId,userId){
 const pending=await getPendingFieldMutations(sessionId,userId);if(!pending.length)return true;
 for(const part of chunks(pending,100)){
  if(typeof navigator!=='undefined'&&!navigator.onLine)return false;
  const r=await authedFetch('/api/attendance/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sessionId,operations:part.map(x=>({people_id:x.personId,present:x.present}))})});
  if(!r)return false;
  const data=await readJson(r);if(!r.ok||data.success!==true)return false;
  const applied=new Set((data.applied_people_ids||[]).concat(data.ignored_people_ids||[]).map(String));
  const remaining=await getPendingFieldMutations(sessionId,userId);
  for(const item of part){const current=remaining.find(x=>x.personId===item.personId);if(current?.updatedAt===item.updatedAt&&applied.has(String(item.personId)))await removeFieldMutation(sessionId,userId,item.personId)}
 }
 return(await getFieldPendingCount(sessionId,userId))===0;
}
async function closeSession(userId,sessionId){
 const r=await authedFetch('/api/attendance/close-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sessionId})});
 if(!r)return false;const data=await readJson(r);
 if(r.ok&&data.success===true){await clearFieldSession(userId,sessionId);return true}return false;
}
export async function syncFieldMode(){
 if(syncPromise)return syncPromise;
 if(typeof navigator!=='undefined'&&!navigator.onLine)return false;
 syncPromise=(async()=>{const rows=await readAll(STORES.sessions);let changed=false;
  for(const row of rows.sort((a,b)=>Number(a.updatedAt||0)-Number(b.updatedAt||0))){if(typeof navigator!=='undefined'&&!navigator.onLine)break;const done=await syncSession(row.sessionId);if(done&&row.closeRequested)changed=(await closeSession(row.userId,row.sessionId))||changed;else if(done)changed=true}
  emit('sync',{changed});return changed;
 })().finally(()=>{syncPromise=null});return syncPromise;
}
export function localRosterSearch(people,query,limit=80){
 const q=String(query||'').trim().toLowerCase();if(!q)return people.slice(0,limit);const compact=q.replace(/\s+/g,'');const out=[];
 for(const p of people){const name=String(p.display_name||((p.first_name||'')+' '+(p.last_name||''))).toLowerCase(),phone=String(p.phone||'').toLowerCase();if(name.includes(q)||name.replace(/\s+/g,'').includes(compact)||phone.includes(q)){out.push(p);if(out.length>=limit)break}}return out;
}