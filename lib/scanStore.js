// lib/scanStore.js
const KEY='nyeocare:scan-state';
const initialState={stage:'idle',jobId:null,scanningLine:false,results:null,revealedPeople:[],ariaMessages:[],summary:null,message:''};

function read(){
if(typeof window==='undefined')return initialState;
try{
const raw=window.localStorage.getItem(KEY);
if(!raw)return initialState;
const parsed=JSON.parse(raw);
if(!parsed||typeof parsed!=='object')return initialState;
return{...initialState,...parsed};
}catch{return initialState}
}

let scanState=read();

function persist(){
if(typeof window==='undefined')return;
try{window.localStorage.setItem(KEY,JSON.stringify(scanState))}catch{}
}

function hydrate(){
scanState={...initialState,...read()};
return scanState;
}

export function getScanState(){
if(typeof window!=='undefined')hydrate();
return{...scanState,revealedPeople:Array.isArray(scanState.revealedPeople)?[...scanState.revealedPeople]:[],ariaMessages:Array.isArray(scanState.ariaMessages)?[...scanState.ariaMessages]:[]};
}

export function setScanState(newState){
scanState={...scanState,...newState};
persist();
return getScanState();
}

export function clearScanState(){
if(scanState.stage==='processing')return getScanState();
scanState={...initialState};
persist();
return getScanState();
}

if(typeof window!=='undefined'){
window.addEventListener('storage',e=>{
if(e.key!==KEY)return;
scanState=read();
window.dispatchEvent(new CustomEvent('nyeocare:scan-state'));
});
  }
