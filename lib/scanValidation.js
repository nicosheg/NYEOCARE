// lib/scanValidation.js
import{normalizeConfidence}from'./confidenceUtils';
import normalizePhone from'./phoneUtils';

export const MAX_PEOPLE_PER_SCAN=500;

export function normalizeName(name){if(!name)return'';return String(name).toLowerCase().replace(/^\s*\d+[\.\)]\s*/,'').replace(/\*\*/g,'').replace(/[^a-z\s'\-]/g,' ').replace(/\s+/g,' ').trim()}
export{normalizePhone};

export function fuzzyMatch(a,b){const x=normalizeName(a),y=normalizeName(b);if(!x||!y)return 0;if(x===y)return 1;const ax=x.split(/\s+/),ay=y.split(/\s+/);const tokenScore=ax.reduce((sum,t)=>sum+Math.max(...ay.map(v=>similarity(t,v))),0)/ax.length;return Math.max(similarity(x,y),tokenScore)}
function similarity(a,b){if(a===b)return 1;if(!a||!b)return 0;const prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));for(let j=0;j<cur.length;j++)prev[j]=cur[j]}return 1-prev[b.length]/Math.max(a.length,b.length)}

const HEADERS=new Set(['name','names','phone','phones','mobile','number','numbers','telephone','contact','contacts','member','members','person','people']);
const REASONING_PHRASES=["let's",'re-read','look at','illegible','faint','carefully','seems to be','appears to be','i think','i see','maybe','perhaps','next line','previous line','hard to read'];
function corruptedName(name){if(name===null||name===undefined)return true;const n=String(name).trim(),lower=n.toLowerCase();if(!n||n.length>100)return true;if(HEADERS.has(lower))return true;if(REASONING_PHRASES.some(x=>lower.includes(x)))return true;if(/^\d[\d\s()+\-./]*$/.test(n))return true;if((n.match(/\d/g)||[]).length>Math.max(2,Math.ceil(n.length*.35)))return true;if(!/[a-zA-Z]/.test(n))return true;return false}

function validatePhone(phone){const normalized=normalizePhone(phone);if(!normalized)return{valid:false,reason:'unreadable'};const digits=normalized.replace(/\D/g,'');if(digits.length<10||digits.length>15)return{valid:false,reason:'invalid_length'};if(/^(\d)\1+$/.test(digits))return{valid:false,reason:'invalid_format'};return{valid:true,phone:normalized}}

function parseStrictJSON(text){if(!text||typeof text!=='string')return null;const cleaned=text.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();try{const parsed=JSON.parse(cleaned);if(Array.isArray(parsed))return parsed;if(parsed&&Array.isArray(parsed.people))return parsed.people}catch{}return null}

function splitName(value){const parts=String(value||'').trim().split(/\s+/).filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' ')}}

export function parseScanOutput(rawContent){const people=parseStrictJSON(rawContent);if(!Array.isArray(people))return{valid:false,error:'AI response was not valid JSON.',people:[]};if(people.length>MAX_PEOPLE_PER_SCAN)return{valid:false,error:`Scan exceeds the ${MAX_PEOPLE_PER_SCAN}-person limit.`,people:[]};return{valid:true,people}}

export async function validateScanOutput(rawContent,orgId,programName,jobId,options={}){
const parsed=parseScanOutput(rawContent);
if(!parsed.valid)return{valid:false,error:parsed.error,people:[],needsReview:[],rejected:[],total_extracted:0,total_valid:0};
const rejected=[],needsReview=[],people=[],seenNames=new Set(),seenPhones=new Set();
for(const raw of parsed.people){
if(!raw||typeof raw!=='object'){rejected.push({name:'',phone:'',reason:'Invalid person object'});continue}
const rawName=raw.name==null?'':String(raw.name).trim(),rawPhone=raw.phone==null?'':String(raw.phone).trim();
const phoneCheck=validatePhone(rawPhone),phone=phoneCheck.valid?phoneCheck.phone:null;
const row=Number.isInteger(Number(raw.row_number))?Number(raw.row_number):null;
if(corruptedName(rawName)){
needsReview.push({incoming:{name:rawName||null,phone,rawPhone,row},confidence:35,reason:rawName?'Name needs human verification':'Name unreadable'});
continue;
}
const nameParts=splitName(rawName),name=[nameParts.first_name,nameParts.last_name].filter(Boolean).join(' ').trim(),nameKey=normalizeName(name);
if(!nameKey){needsReview.push({incoming:{name:null,phone,rawPhone,row},confidence:30,reason:'Name could not be safely read'});continue}
if(phone&&seenPhones.has(phone))continue;
if(!phone&&seenNames.has(nameKey))continue;
if(phone)seenPhones.add(phone);
seenNames.add(nameKey);
let confidence=Number(raw.confidence);
if(!Number.isFinite(confidence))confidence=phone?80:55;
confidence=normalizeConfidence(confidence,phone?80:55);
const item={name,first_name:nameParts.first_name,last_name:nameParts.last_name,phone,rawPhone,confidence,row_number:row,relationship_stage:String(raw.relationship_stage||'first_time_visitor').trim()};
if(!phone)needsReview.push({incoming:item,confidence,reason:'Phone number could not be safely validated'});
if(confidence<65)needsReview.push({incoming:item,confidence,reason:'Low extraction confidence'});
people.push(item);
}
return{valid:true,people,needsReview,rejected,total_extracted:parsed.people.length,total_valid:people.length};
 }
