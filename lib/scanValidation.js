// lib/scanValidation.js
import{normalizeConfidence}from'./confidenceUtils';
import normalizePhone from'./phoneUtils';

export const MAX_PEOPLE_PER_SCAN=500;

const HONORIFICS=new Set(['sis','sister','bro','brother','mr','mrs','miss','ms','pastor','past','pst','dr','rev','reverend','elder','deacon','deaconess','chief']);
const HEADERS=new Set(['name','names','phone','phones','mobile','number','numbers','telephone','contact','contacts','member','members','person','people']);
const REASONING_PHRASES=["let's",'re-read','look at','illegible','faint','carefully','seems to be','appears to be','i think','i see','maybe','perhaps','next line','previous line','hard to read'];

export function normalizeName(name){if(!name)return'';return String(name).toLowerCase().replace(/^\s*\d+[\.\)]\s*/,'').replace(/\*\*/g,' ').replace(/\b(sis|sister|bro|brother|mr|mrs|miss|ms|pastor|past|pst|dr|rev|reverend|elder|deacon|deaconess|chief)\b/g,' ').replace(/[^a-z\s'\-]/g,' ').replace(/\s+/g,' ').trim()}
export{normalizePhone};

function similarity(a,b){if(a===b)return 1;if(!a||!b)return 0;const prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));for(let j=0;j<cur.length;j++)prev[j]=cur[j]}return 1-prev[b.length]/Math.max(a.length,b.length)}
export function fuzzyMatch(a,b){const x=normalizeName(a),y=normalizeName(b);if(!x||!y)return 0;if(x===y)return 1;const ax=x.split(/\s+/),ay=y.split(/\s+/);const tokenScore=ax.reduce((sum,t)=>sum+Math.max(...ay.map(v=>similarity(t,v))),0)/ax.length;return Math.max(similarity(x,y),tokenScore)}

function corruptedName(name){if(name===null||name===undefined)return true;const n=String(name).trim(),lower=n.toLowerCase();if(!n||n.length>100||HEADERS.has(lower))return true;if(REASONING_PHRASES.some(x=>lower.includes(x)))return true;if(/^\d[\d\s()+\-./]*$/.test(n))return true;if((n.match(/\d/g)||[]).length>Math.max(2,Math.ceil(n.length*.35)))return true;return!/[a-zA-Z]/.test(n)}

function validatePhone(phone){
const normalized=normalizePhone(phone);if(!normalized)return{valid:false,reason:'unreadable'};
const digits=normalized.replace(/\D/g,'');if(digits.length<10||digits.length>15)return{valid:false,reason:'invalid_length'};if(/^(\d)\1+$/.test(digits))return{valid:false,reason:'invalid_format'};return{valid:true,phone:normalized};
}

function parseStrictJSON(text){
if(!text||typeof text!=='string')return null;
const cleaned=text.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
try{const parsed=JSON.parse(cleaned);if(Array.isArray(parsed))return parsed;if(parsed&&Array.isArray(parsed.people))return parsed.people}catch{}
return null;
}

function splitName(value){
const parts=String(value||'').trim().split(/\s+/).filter(Boolean);let honorific=null;
if(parts.length&&HONORIFICS.has(parts[0].toLowerCase().replace(/\./g,'')))honorific=parts.shift();
return{first_name:parts.shift()||'',last_name:parts.join(' '),honorific};
}

function relationAllowed(value){return['same_row','arrow_link','continuation','visual_link'].includes(String(value||''))}

export function parseScanOutput(rawContent){
const people=parseStrictJSON(rawContent);
if(!Array.isArray(people))return{valid:false,error:'AI response was not valid JSON.',people:[]};
if(people.length>MAX_PEOPLE_PER_SCAN)return{valid:false,error:`Scan exceeds the ${MAX_PEOPLE_PER_SCAN}-person limit.`,people:[]};
return{valid:true,people};
}

export async function validateScanOutput(rawContent,orgId,programName,jobId,options={}){
const parsed=parseScanOutput(rawContent);
if(!parsed.valid)return{valid:false,error:parsed.error,people:[],needsReview:[],rejected:[],total_extracted:0,total_valid:0};

const rejected=[],needsReview=[],people=[],seenNames=new Set(),seenPhones=new Set();

for(const raw of parsed.people){
if(!raw||typeof raw!=='object'){rejected.push({name:'',phone:'',reason:'Invalid person object'});continue}

const rawName=raw.name==null?'':String(raw.name).trim();
const rawPhone=raw.phone==null?'':String(raw.phone).trim();
const verificationStatus=String(raw.verification_status||'review').toLowerCase();
const reasons=Array.isArray(raw.verification_reasons)?raw.verification_reasons.map(String):[];
const relation=String(raw.phone_relation||'uncertain');
const linkEvidence=raw.link_evidence==null?null:String(raw.link_evidence).trim()||null;
const phoneCheck=validatePhone(rawPhone);
const phone=phoneCheck.valid?phoneCheck.phone:null;
const row=Number.isInteger(Number(raw.row_number))?Number(raw.row_number):null;
const parts=splitName(rawName);
const cleanDisplay=[parts.first_name,parts.last_name].filter(Boolean).join(' ').trim();
const nameKey=normalizeName(cleanDisplay||rawName);
const confidence=normalizeConfidence(Number(raw.pair_confidence??raw.confidence),verificationStatus==='verified'?98:60);

if(corruptedName(rawName)||!nameKey){
needsReview.push({status:'needs_decision',extracted_name:rawName||null,extracted_phone:phone,confidence:Math.min(confidence,60),row_number:row,reasons:[...reasons,'name_needs_verification'],verification_alternatives:raw.verification_alternatives||null,incoming:{name:rawName||null,phone,rawPhone,row_number:row,phone_relation:relation,link_evidence:linkEvidence}});
continue;
}

const reviewReasons=[...reasons];
if(verificationStatus!=='verified')reviewReasons.push('independent_verification_failed');
if(!phoneCheck.valid)reviewReasons.push('phone_number_not_safely_validated');
if(confidence<98)reviewReasons.push('verification_confidence_below_98');
if(!relationAllowed(relation))reviewReasons.push('phone_person_relationship_not_safely_established');
if((relation==='arrow_link'||relation==='continuation'||relation==='visual_link')&&!linkEvidence)reviewReasons.push('visual_link_without_evidence');

if(verificationStatus!=='verified'||!phoneCheck.valid||confidence<98||!relationAllowed(relation)||(relation!=='same_row'&&!linkEvidence)){
needsReview.push({status:'needs_decision',extracted_name:cleanDisplay||rawName,extracted_phone:phone,confidence,row_number:row,reasons:[...new Set(reviewReasons)],verification_alternatives:raw.verification_alternatives||null,incoming:{name:cleanDisplay||rawName,phone,rawPhone,row_number:row,phone_relation:relation,link_evidence:linkEvidence}});
continue;
}

if(seenPhones.has(phone)||seenNames.has(nameKey)){
rejected.push({name:cleanDisplay||rawName,phone,reason:'Duplicate row in same scan',row_number:row});continue;
}

seenPhones.add(phone);seenNames.add(nameKey);

people.push({
name:cleanDisplay||rawName,
display_name:cleanDisplay||rawName,
first_name:parts.first_name,
last_name:parts.last_name,
honorific:parts.honorific,
phone,
rawPhone,
confidence:98,
row_number:row,
phone_relation:relation,
link_evidence:linkEvidence,
verification_status:'verified',
verification_reasons:[],
verification_alternatives:raw.verification_alternatives||null,
relationship_stage:String(raw.relationship_stage||'first_time_visitor').trim()
});
}

return{valid:true,people,needsReview,rejected,total_extracted:parsed.people.length,total_valid:people.length};
                                                                                                                                                                                                                                                                   }
