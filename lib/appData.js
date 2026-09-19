// lib/appData.js
const caches=new Map();

export function getCached(key){
 return caches.get(key)?.value??null;
}

export function setCached(key,value){
 caches.set(key,{value,updatedAt:Date.now()});
 return value;
}

export function clearCached(key){
 if(key) caches.delete(key);
 else caches.clear();
}

export function cacheAge(key){
 const item=caches.get(key);
 return item?Date.now()-item.updatedAt:Infinity;
}

export function publishDataChange(type='general',detail={}){
 if(typeof window==='undefined')return;
 window.dispatchEvent(new CustomEvent('nyeocare:data-changed',{detail:{type,...detail,at:Date.now()}}));
}

export function subscribeDataChange(handler){
 if(typeof window==='undefined')return()=>{};
 const fn=e=>handler(e.detail||{});
 window.addEventListener('nyeocare:data-changed',fn);
 return()=>window.removeEventListener('nyeocare:data-changed',fn);
}
