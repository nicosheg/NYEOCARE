// lib/scanValidation.js
import normalizePhone from'./phoneUtils';

export const MAX_PEOPLE_PER_SCAN=500;

const HONORIFICS=new Set(['sis','sister','bro','brother','mr','mrs','miss','ms','pastor','past','pst','dr','rev','reverend','elder','deacon','deaconess','chief']);
const HEADERS=new Set(['name','names','phone','phones','mobile','number','numbers','telephone','contact','contacts','member','members','person','people']);
const REASONING_PHRASES=["let's",'re-read','look at','illegible','faint','carefully','seems to be','appears to be','i think','i see','maybe','perhaps','next line','previous line','hard to read'];

export function normalizeName(name){
 if(!name)return'';
 return String(name).toLowerCase().replace(/^\s*\d+[\.\)]\s*/,'').replace(/\*\*/g,' ').replace(/\b(sis|sister|bro|brother|mr|mrs|miss|ms|pastor|past|pst|dr|rev|reverend|elder|deacon|deaconess|chief)\b/g,' ').replace(/[^a-z\s'\-]/g,' ').replace(/\s+/g,' ').trim();
}
export{normalizePhone};

function titleToken(v){return String(v||'').split(/(-|')/).map(x=>/^[a-z]/i.test(x)?x.charAt(0).toUpperCase()+x.slice(1).toLowerCase():x).join('')}
export function normalizeDisplayName(name){
 const raw=String(name||'').replace(/\s+/g,' ').trim();
 if(!raw)return'';
 const parts=raw.split(' ');
 let honorific=null;
 if(parts.length&&HONORIFICS.has(parts[0].toLowerCase().replace(/\./g,'')))honorific=parts.shift();
 const display=parts.map(titleToken).join(' ').trim();
 return{display,honorific};
}
function similarity(a,b){
 if(a===b)return 1;
 if(!a||!b)return 0;
 const prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const cur=[i];
  for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
  for(let j=0;j<cur.length;j++)prev[j]=cur[j];
 }
 return 1-prev[b.length]/Math.max(a.length,b.length);
}
export function fuzzyMatch(a,b){
 const x=normalizeName(a),y=normalizeName(b);
 if(!x||!y)return 0;
 if(x===y)return 1;
 const ax=x.split(/\s+/),ay=y.split(/\s+/);
 const tokenScore=ax.reduce((sum,t)=>sum+Math.max(...ay.map(v=>similarity(t,v))),0)/ax.length;
 return Math.max(similarity(x,y),tokenScore);
}
function corruptedName(name){
 if(name===null||name===undefined)return true;
 const n=String(name).trim(),lower=n.toLowerCase();
 if(!n||n.length>100||HEADERS.has(lower))return true;
 if(REASONING_PHRASES.some(x=>lower.includes(x)))return true;
 if(/^\\d[\\d\\s()+\-./]*$/.test(n))return true;
 if((n.match(/\d/g)||[]).length>Math.max(2,Math.ceil(n.length*.35)))return true;
 return!/[a-zA-Z]/.test(n);
}
function validatePhone(phone){
 const normalized=normalizePhone(phone);
 if(!normalized)return{valid:false,reason:'phone_not_readable'};
 const digits=normalized.replace(/\D/g,'');
 if(digits.length<10||digits.length>15)return{valid:false,reason:'invalid_phone_length'};
 if(/^(\d)\1+$/.test(digits))return{valid:false,reason:'invalid_phone_format'};
 return{valid:true,phone:normalized};
}
function parseStrictJSON(text){
 if(!text||typeof text!=='string')return null;
 const cleaned=text.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
 try{
  const parsed=JSON.parse(cleaned);
  if(Array.isArray(parsed))return parsed;
  if(parsed&&Array.isArray(parsed.people))return parsed.people;
 }catch{}
 return null;
}
function splitName(value){
 const normalized=normalizeDisplayName(value);
 const parts=normalized.display.split(/\s+/).filter(Boolean);
 return{first_name:parts.shift()||'',last_name:parts.join(' '),honorific:normalized.honorific};
}
function relationAllowed(value){return['same_row','arrow_link','continuation','visual_link'].includes(String(value||''))}
function reasonInfo(reasons){
 const map={
  phone_number_not_safely_validated:['Phone number needs checking.','Compare the number with the original register before confirming it.'],
  verification_confidence_below_98:['ARIA is less certain about this extraction.','Check the original row and confirm the displayed values.'],
  phone_person_relationship_not_safely_established:['ARIA could not confidently connect the phone number to this person.','Confirm that the number belongs to this row.'],
  visual_link_without_evidence:['The register shows a possible cross-row connection, but it is unclear.','Check the arrow, line or continuation mark in the original image.'],
  name_needs_verification:['The name could not be read cleanly enough.','Check the original handwriting and correct the name if necessary.'],
  duplicate_in_scan:['This person appears more than once in the same scan.','Confirm which row should become the canonical record.'],
  identity_conflict:['ARIA found more than one possible existing person.','Choose the correct existing person or confirm that this is a new person.']
 };
 for(const reason of reasons){if(map[reason])return{reason:map[reason][0],suggestion:map[reason][1]}}
 return{reason:'ARIA found something that needs your attention.','suggestion':'Review the original register and confirm the extracted information.'};
}
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
  const rawName=String(raw.name??'').trim();
  const rawPhone=String(raw.phone??'').trim();
  const phoneCheck=validatePhone(rawPhone);
  const phone=phoneCheck.valid?phoneCheck.phone:null;
  const row=Number.isInteger(Number(raw.row_number))?Number(raw.row_number):null;
  const parts=splitName(rawName);
  const cleanDisplay=parts.first_name?[parts.first_name,parts.last_name].filter(Boolean).join(' ').trim():rawName;
  const nameKey=normalizeName(cleanDisplay);
  const confidence=Math.max(0,Math.min(100,Math.round(Number(raw.pair_confidence??raw.confidence)||0)));
  const relation=String(raw.phone_relation||'uncertain');
  const linkEvidence=raw.link_evidence==null?null:String(raw.link_evidence).trim()||null;
  const rawReasons=[];
  if(corruptedName(rawName)||!nameKey)rawReasons.push('name_needs_verification');
  if(!phoneCheck.valid)rawReasons.push('phone_number_not_safely_validated');
  if(confidence<98)rawReasons.push('verification_confidence_below_98');
  if(phone&&!relationAllowed(relation))rawReasons.push('phone_person_relationship_not_safely_established');
  if(phone&&(relation==='arrow_link'||relation==='continuation'||relation==='visual_link')&&!linkEvidence)rawReasons.push('visual_link_without_evidence');
  if(seenNames.has(nameKey)||(phone&&seenPhones.has(phone)))rawReasons.push('duplicate_in_scan');
  if(!nameKey){
   const info=reasonInfo(rawReasons);
   needsReview.push({status:'needs_decision',extracted_name:rawName||null,display_name:cleanDisplay||rawName||null,extracted_phone:phone,raw_phone:rawPhone||null,raw_name:rawName||null,confidence,row_number:row,reasons:[...new Set(rawReasons)],reason:info.reason,suggestion:info.suggestion,incoming:{name:rawName||null,phone,rawPhone,row_number:row,phone_relation:relation,link_evidence:linkEvidence}});
   continue;
  }
  if(seenNames.has(nameKey)||(phone&&seenPhones.has(phone))){
   const info=reasonInfo(['duplicate_in_scan']);
   needsReview.push({status:'needs_decision',extracted_name:cleanDisplay,display_name:cleanDisplay,extracted_phone:phone,raw_phone:rawPhone||null,raw_name:rawName||null,confidence,row_number:row,reasons:['duplicate_in_scan'],reason:info.reason,suggestion:info.suggestion,incoming:{name:cleanDisplay,phone,rawPhone,row_number:row,phone_relation:relation,link_evidence:linkEvidence}});
   continue;
  }
  seenNames.add(nameKey);
  if(phone)seenPhones.add(phone);
  const info=reasonInfo(rawReasons);
  const candidate={name:cleanDisplay,display_name:cleanDisplay,first_name:parts.first_name,last_name:parts.last_name,honorific:parts.honorific,phone,rawPhone,raw_name:rawName||null,confidence,row_number:row,phone_relation:relation,link_evidence:linkEvidence,verification_status:rawReasons.length?'review':'verified',verification_reasons:[...new Set(rawReasons)],relationship_stage:String(raw.relationship_stage||'first_time_visitor').trim()};
  people.push(candidate);
  if(rawReasons.length)needsReview.push({status:'needs_decision',extracted_name:cleanDisplay,display_name:cleanDisplay,extracted_phone:phone,raw_phone:rawPhone||null,raw_name:rawName||null,confidence,row_number:row,reasons:[...new Set(rawReasons)],reason:info.reason,suggestion:info.suggestion,incoming:{name:cleanDisplay,phone,rawPhone,row_number:row,phone_relation:relation,link_evidence:linkEvidence}});
 }
 return{valid:true,people,needsReview,rejected,total_extracted:parsed.people.length,total_valid:people.length};
                       }
