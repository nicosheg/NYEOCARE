// lib/scanValidation.js
import{normalizeConfidence}from'./confidenceUtils';
import normalizePhone from'./phoneUtils';

export const MAX_PEOPLE_PER_SCAN=500;

export function normalizeName(name){
 if(!name)return'';
 return String(name).toLowerCase().replace(/^\s*\d+[\.\)]\s*/,'').replace(/\*\*/g,'').replace(/[^a-z\s'\-]/g,' ').replace(/\s+/g,' ').trim();
}

export{normalizePhone};

const REASONING_PHRASES=["let's",'re-read','look at','illegible','faint','carefully','seems to be','appears to be','i think','i see','maybe','perhaps','next line','previous line','hard to read','->','=>'];
const MARKDOWN_PATTERNS=[/\*\*/,/```/,/^\s*[-*]\s+/,/^\s*\d+[\.\)]\s+/];

function corruptedName(name){
 if(!name||name.length<2||name.length>100)return true;
 const lower=name.toLowerCase();
 if(REASONING_PHRASES.some(x=>lower.includes(x)))return true;
 if(MARKDOWN_PATTERNS.some(x=>x.test(name)))return true;
 if(/^[^a-zA-Z]+$/.test(name))return true;
 if((name.match(/[.!?]/g)||[]).length>1)return true;
 return false;
}

function validatePhone(phone){
 const normalized=normalizePhone(phone);
 if(!normalized)return{valid:false,reason:'unreadable'};
 const digits=normalized.replace(/\D/g,'');
 if(digits.length<10||digits.length>15)return{valid:false,reason:'invalid_length'};
 if(/^(\d)\1+$/.test(digits))return{valid:false,reason:'invalid_format'};
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
 const parts=String(value||'').trim().split(/\s+/).filter(Boolean);
 return{first_name:parts.shift()||'',last_name:parts.join(' ')};
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

 const rejected=[],needsReview=[],people=[];
 const seenNames=new Set(),seenPhones=new Set();

 for(const raw of parsed.people){
  if(!raw||typeof raw!=='object'){
   rejected.push({name:'',phone:'',reason:'Invalid person object'});
   continue;
  }

  const rawName=String(raw.name||raw.first_name||'').trim();
  const nameParts=splitName(rawName);
  const name=String([nameParts.first_name,nameParts.last_name].filter(Boolean).join(' ')).trim();
  const rawPhone=String(raw.phone||'').trim();
  const phoneCheck=validatePhone(rawPhone);
  const phone=phoneCheck.valid?phoneCheck.phone:null;

  if(corruptedName(name)){
   rejected.push({name:rawName,phone:rawPhone,reason:'Corrupted name pattern'});
   continue;
  }

  const nameKey=normalizeName(name);
  const phoneKey=phone||null;

  if(phoneKey&&seenPhones.has(phoneKey))continue;
  if(!phoneKey&&seenNames.has(nameKey))continue;

  if(phoneKey)seenPhones.add(phoneKey);
  seenNames.add(nameKey);

  const confidence=normalizeConfidence(
   Number.isFinite(Number(raw.confidence))?Number(raw.confidence):(phone?70:45),
   phone?70:45
  );

  const item={
   name,
   first_name:nameParts.first_name,
   last_name:nameParts.last_name,
   phone,
   rawPhone,
   confidence,
   relationship_stage:String(raw.relationship_stage||'first_time_visitor').trim()
  };

  if(!phone){
   needsReview.push({
    incoming:item,
    confidence,
    reason:'Phone number could not be safely validated'
   });
  }

  people.push(item);
 }

 return{
  valid:true,
  people,
  needsReview,
  rejected,
  total_extracted:parsed.people.length,
  total_valid:people.length
 };
}
