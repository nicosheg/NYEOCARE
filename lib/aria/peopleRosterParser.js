const digits=v=>String(v??'').replace(/\D/g,'');
const PHONE_TOKEN=/(?:\+234[\s().-]?\d{3}[\s().-]?\d{3}[\s().-]?\d{4}|0\d{9,12})/g;
const HONORIFIC=/\b(?:mummy|mama|sis|sister|bro|brother|mr|mrs|miss|ms|pastor|pst|elder|deacon|deaconess|rev|chief)\b/gi;
const instructionLine=line=>{
 const v=String(line||'').trim(),t=v.toLowerCase();
 if(!v)return true;
 if(/^(please|kindly|call|let'?s|let us|the following|these are|our women|women that|ladies|members|contacts?|roster|list|and this|here (are|is))\b/i.test(v))return true;
 if(/\b(names?|phone|phones|number|numbers|roster|contacts?|women|ladies|members|service|church|today|call|know why|attended|attendance|absence|absent)\b/i.test(t))return true;
 return false;
};
const looksPhone=line=>{
 const raw=String(line||'').trim(),d=digits(raw);
 return d.length>=10&&d.length<=13&&/^[+\d\s().-]+$/.test(raw);
};
const looksName=line=>{
 const v=String(line||'').trim();
 const honorific=/^(mummy|mama|sis|sister|bro|brother|mr|mrs|miss|ms|pastor|pst|elder|deacon|deaconess|rev|chief)\b/i.test(v);
 if(v.length<2||v.length>100||looksPhone(v)||!/[a-zA-Z]/.test(v)||(!honorific&&(instructionLine(v)||v.split(/\s+/).length<2)))return false;
 return true;
};
const cleanName=v=>String(v||'').replace(/^[-–—,:;\s]+|[-–—,:;\s]+$/g,'').replace(/\s{2,}/g,' ').trim();
const plausibleHonorificName=name=>{const v=cleanName(name),words=v.split(/\s+/).filter(Boolean),t=v.toLowerCase();if(!v||words.length>8)return false;if(/\b(?:please|kindly|don't|do not|save|add|put|call|numbers?|phones?|people|members?|contacts?|service|attendance|absent|absence|why|today|church)\b/i.test(t))return false;return true;};
const extractPhones=text=>{
 const out=[];let m;
 const re=new RegExp(PHONE_TOKEN.source,'g');
 while((m=re.exec(String(text||''))))out.push({raw:m[0],start:m.index,end:m.index+m[0].length});
 return out;
};
function parseHonorificRoster(text){
 const source=String(text||'').replace(/\r/g,' ').replace(/\n/g,' ').replace(/\s+/g,' ').trim();
 const starts=[];let m;
 const re=new RegExp(HONORIFIC.source,'gi');
 while((m=re.exec(source)))starts.push({start:m.index,end:m.index+m[0].length});
 const phones=extractPhones(source);
 const rows=[];
 for(let i=0;i<starts.length;i++){
  const start=starts[i].start;
  const nextHonorific=starts[i+1]?.start??source.length;
  const firstPhone=phones.find(p=>p.start>=starts[i].end&&p.start<nextHonorific);
  if(firstPhone){
   const name=cleanName(source.slice(start,firstPhone.start));
   if(name&&/[a-zA-Z]/.test(name)){
    rows.push({name,phone:firstPhone.raw});
   }
  }else{
   const rawName=cleanName(source.slice(start,nextHonorific));
   const boundary=rawName.match(/\b(?:please|kindly|don't|do not|save|add|put|call|let(?:'s| us)?)\b/i);
   const name=cleanName(boundary?rawName.slice(0,boundary.index):rawName);
   if(plausibleHonorificName(name)&&/[a-zA-Z]/.test(name)){
    rows.push({name,phone:null});
   }
  }
 }
 return rows;
}

export function parsePeopleRoster(text){
 const raw=String(text||'');
 const rows=[],ignored=[];
 rows.push(...parseHonorificRoster(raw));
 const consumedNames=new Set(rows.map(x=>x.name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+'|'+digits(x.phone)));
 const lines=raw.replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);
 let pending=null;
 for(const line of lines){
  if(looksPhone(line)){
   if(pending){rows.push({name:pending,phone:line});pending=null}
   else ignored.push(line);
   continue;
  }
  if(looksName(line)){
   if(pending)rows.push({name:pending,phone:null});
   pending=line;
   continue;
  }
  ignored.push(line);
 }
 if(pending)rows.push({name:pending,phone:null});

 const dedup=new Map();
 for(const row of rows){
  const name=cleanName(row.name);
  const key=name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+'|'+digits(row.phone);
  if(!consumedNames.has(key)&&!dedup.has(key))dedup.set(key,{name,phone:row.phone||null});
 }
 for(const row of rows){
  const name=cleanName(row.name);
  const key=name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+'|'+digits(row.phone);
  if(!dedup.has(key))dedup.set(key,{name,phone:row.phone||null});
 }
 return{rows:[...dedup.values()].filter(x=>x.name).slice(0,100),ignored:ignored.slice(0,60)};
}

export function inferPeopleRosterIntent(text){
 const input=String(text||'');
 const parsed=parsePeopleRoster(input);
 const phoneLikeCount=extractPhones(input).length;
 const explicitRosterCue=/\b(names?|phone|phones|number|numbers|roster|contacts?|women|ladies|members|people|persons)\b/i.test(input);
 const hasMultiplePeople=parsed.rows.length>=2;
 const strongPhoneEvidence=phoneLikeCount>=2;
 return{
  match:hasMultiplePeople&&strongPhoneEvidence&&(explicitRosterCue||phoneLikeCount>=3),
  rows:parsed.rows,
  ignored:parsed.ignored,
  phoneLikeLines:phoneLikeCount,
  explicitRosterCue
 };
}
