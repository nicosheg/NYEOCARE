// lib/scanValidation.js
import normalizePhone from'./phoneUtils';

export const MAX_PEOPLE_PER_SCAN=500;
const HONORIFICS=new Set(['sis','sister','bro','brother','mr','mrs','miss','ms','pastor','past','pst','dr','rev','reverend','elder','deacon','deaconess','chief']);
const HEADERS=new Set(['name','names','phone','phones','mobile','number','numbers','telephone','contact','contacts','member','members','person','people']);
const REASONING_PHRASES=["let's",'re-read','look at','illegible','faint','carefully','seems to be','appears to be','i think','i see','maybe','perhaps'];

export function normalizeName(name){
 if(!name)return'';
 return String(name).toLowerCase().replace(/^\s*\d+[\.\)]\s*/,'').replace(/\*\*/g,' ').replace(/\b(sis|sister|bro|brother|mr|mrs|miss|ms|pastor|past|pst|dr|rev|reverend|elder|deacon|deaconess|chief)\b/g,' ').replace(/[^a-z\s'\-]/g,' ').replace(/\s+/g,' ').trim();
}
export{normalizePhone};

function titleToken(v){return String(v||'').split(/(-|')/).map(x=>/^[a-z]/i.test(x)?x.charAt(0).toUpperCase()+x.slice(1).toLowerCase():x).join('')}
export function normalizeDisplayName(name){
 const raw=String(name||'').replace(/\s+/g,' ').trim();
 if(!raw)return{display:'',honorific:null};
 const parts=raw.split(' ');
 let honorific=null;
 if(parts.length&&HONORIFICS.has(parts[0].toLowerCase().replace(/\./g,'')))honorific=parts.shift();
 return{display:parts.map(titleToken).join(' ').trim(),honorific};
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
 if(/^\d[\d\s()+\-./]*$/.test(n))return true;
 if((n.match(/\d/g)||[]).length>Math.max(2,Math.ceil(n.length*.35)))return true;
 return!/[a-zA-Z]/.test(n);
}

function phoneList(raw){
 const value=raw?.phone??raw?.phones??raw?.p;
 if(Array.isArray(value))return value.map(v=>String(v??'').trim()).filter(Boolean).slice(0,2);
 if(value==null)return[];
 const s=String(value).trim();
 return s?[s]:[];
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
 const cleaned=text.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/```json/gi,'').replace(/```/g,'').trim();
 try{
  const parsed=JSON.parse(cleaned);
  if(Array.isArray(parsed))return parsed;
  if(parsed&&Array.isArray(parsed.people))return parsed.people;
 }catch{}
 return null;
}

function splitName(value){
 const normalized=normalizeDisplayName(value),parts=normalized.display.split(/\s+/).filter(Boolean);
 return{first_name:parts.shift()||'',last_name:parts.join(' '),honorific:normalized.honorific};
}

function reasonInfo(reasons){
 const map={
  phone_number_not_safely_validated:['Phone number needs checking.','Compare the number with the original register before confirming it.'],
  too_many_phone_numbers:['More than two phone numbers were found for one name.','Check the original row and keep only the numbers actually assigned to this person.'],
  name_needs_verification:['The name could not be read cleanly enough.','Check the original register and correct the name if necessary.'],
  phone_missing:['No phone number was safely extracted for this person.','Check whether a phone number is visibly assigned to this name.'],
  duplicate_in_scan:['This person appears more than once in the same scan.','Confirm which row should become the canonical record.']
 };
 for(const reason of reasons)if(map[reason])return{reason:map[reason][0],suggestion:map[reason][1]};
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
  const rawPhones=phoneList(raw);
  const parts=splitName(rawName);
  const cleanDisplay=parts.first_name?[parts.first_name,parts.last_name].filter(Boolean).join(' ').trim():rawName;
  const nameKey=normalizeName(cleanDisplay);
  const reasons=[];

  if(corruptedName(rawName)||!nameKey)reasons.push('name_needs_verification');
  if(rawPhones.length>2)reasons.push('too_many_phone_numbers');

  const phones=rawPhones.slice(0,2).map(validatePhone);
  const validPhones=phones.filter(x=>x.valid).map(x=>x.phone);

  if(rawPhones.length===0)reasons.push('phone_missing');
  if(rawPhones.some((_,i)=>!phones[i]?.valid))reasons.push('phone_number_not_safely_validated');

  if(!nameKey){
   const info=reasonInfo(reasons);
   needsReview.push({status:'needs_decision',extracted_name:rawName||null,display_name:cleanDisplay||rawName||null,extracted_phone:validPhones[0]||null,extracted_phones:validPhones,raw_phones:rawPhones,confidence:0,row_number:null,reasons:[...new Set(reasons)],reason:info.reason,suggestion:info.suggestion,incoming:{name:rawName||null,phone:validPhones[0]||null,phones:validPhones,rawPhones}});
   continue;
  }

  if(seenNames.has(nameKey)||validPhones.some(p=>seenPhones.has(p))){
   const info=reasonInfo(['duplicate_in_scan']);
   needsReview.push({status:'needs_decision',extracted_name:cleanDisplay,display_name:cleanDisplay,extracted_phone:validPhones[0]||null,extracted_phones:validPhones,raw_phones:rawPhones,confidence:0,row_number:null,reasons:['duplicate_in_scan'],reason:info.reason,suggestion:info.suggestion,incoming:{name:cleanDisplay,phone:validPhones[0]||null,phones:validPhones,rawPhones}});
   continue;
  }

  seenNames.add(nameKey);
  validPhones.forEach(p=>seenPhones.add(p));

  const nc=Math.max(0,Math.min(100,Number(raw.name_confidence??raw.nc??0)||0));
  const pc=Math.max(0,Math.min(100,Number(raw.phone_confidence??raw.pc??0)||0));
  const modelConfidence=Math.max(0,Math.min(100,Number(raw.confidence??raw.c??0)||0));
  const confidence=validPhones.length?Math.round((nc+pc)/2)||modelConfidence:nc||modelConfidence;

  const candidate={
   name:cleanDisplay,
   display_name:cleanDisplay,
   first_name:parts.first_name,
   last_name:parts.last_name,
   honorific:parts.honorific,
   phone:validPhones[0]||null,
   phones:validPhones,
   rawPhone:rawPhones[0]||null,
   rawPhones,
   confidence,
   name_confidence:nc,
   phone_confidence:pc,
   model_confidence:modelConfidence,
   row_number:null,
   phone_relation:'same_row',
   link_evidence:null,
   verification_status:reasons.length?'review':'extracted',
   verification_reasons:[...new Set(reasons)],
   relationship_stage:String(raw.relationship_stage||'first_time_visitor').trim()
  };

  people.push(candidate);

  if(reasons.length){
   const info=reasonInfo(reasons);
   needsReview.push({status:'needs_decision',extracted_name:cleanDisplay,display_name:cleanDisplay,extracted_phone:validPhones[0]||null,extracted_phones:validPhones,raw_phones:rawPhones,confidence,row_number:null,reasons:[...new Set(reasons)],reason:info.reason,suggestion:info.suggestion,incoming:{name:cleanDisplay,phone:validPhones[0]||null,phones:validPhones,rawPhones}});
  }
 }

 return{valid:true,people,needsReview,rejected,total_extracted:parsed.people.length,total_valid:people.length};
                        }
