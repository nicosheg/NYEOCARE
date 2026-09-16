// lib/scanStore.js
const KEY='nyeocare:scan-state';
const initialState={stage:'idle',jobId:null,scanningLine:false,results:null,revealedPeople:[],ariaMessages:[],summary:null,message:'',progress:null,error:null,updatedAt:null};
function read(){if(typeof window==='undefined')return initialState;try{const raw=window.localStorage.getItem(KEY);if(!raw)return initialState;const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object')return initialState;const merged={...initialState,...parsed};if(merged.stage==='error'&&(!merged.updatedAt||Date.now()-Number(merged.updatedAt)>30*60*1000)){window.localStorage.removeItem(KEY);return initialState}return merged}catch{return initialState}}
let scanState=read();
function notify(){if(typeof window==='undefined')return;try{window.localStorage.setItem(KEY,JSON.stringify(scanState))}catch{}try{window.dispatchEvent(new CustomEvent('nyeocare:scan-state'))}catch{}}
export function getScanState(){if(typeof window!=='undefined')scanState={...initialState,...read()};return{...scanState,revealedPeople:Array.isArray(scanState.revealedPeople)?[...scanState.revealedPeople]:[],ariaMessages:Array.isArray(scanState.ariaMessages)?[...scanState.ariaMessages]:[]}}
export function setScanState(newState){scanState={...scanState,...newState,updatedAt:Date.now()};notify();return getScanState()}
export function clearScanState(force=false){if(scanState.stage==='processing'&&!force)return getScanState();scanState={...initialState,updatedAt:Date.now()};notify();return getScanState()}
if(typeof window!=='undefined')window.addEventListener('storage',e=>{if(e.key!==KEY)return;scanState={...initialState,...read()};try{window.dispatchEvent(new CustomEvent('nyeocare:scan-state'))}catch{}})
