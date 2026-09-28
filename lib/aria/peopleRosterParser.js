const digits=v=>String(v??'').replace(/\D/g,'');
const instructionLine=line=>{
 const v=String(line||'').trim(),t=v.toLowerCase();
 if(!v)return true;
 if(/^(please|kindly|call|let'?s|let us|the following|these are|our women|women that|ladies|members|contacts?|roster|list|and this|here (are|is))\b/i.test(v))return true;
 if(/\b(names?|phone|phones|number|numbers|roster|contacts?|women|ladies|members|service|church|today|call|know why|attended|absence|absent)\b/i.test(t))return true;
 if(/[,:;]$/.test(v))return true;
 return false;
};
const looksPhone=line=>{
 const raw=String(line||'').trim(),d=digits(raw);
 return d.length>=10&&d.length<=13&&/^[+\d\s().-]+$/.test(raw);
};
const hasHonorific=line=>/^(mummy|mama|sis|sister|bro|brother|mr|mrs|miss|ms|pastor|pst|elder|deacon|deaconess|rev|chief)\b/i.test(String(line||'').trim());
const looksName=line=>{
 const v=String(line||'').trim();
 if(v.length<2||v.length>100||looksPhone(v)||hasHonorific(v)===false&&instructionLine(v)||!/[a-zA-Z]/.test(v))return false;
 return hasHonorific(v)||v.split(/\s+/).length>=2||v===v.toUpperCase();
};

export function parsePeopleRoster(text){
 const lines=String(text||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);
 const rows=[],ignored=[];let pending=null;
 for(const line of lines){
  if(looksPhone(line)){
   if(pending){
    rows.push({name:pending.name,phone:line});
    pending=null;
   }else{
    ignored.push(line);
   }
   continue;
  }
  if(looksName(line)){
   if(pending)rows.push({name:pending.name,phone:null});
   pending={name:line};
   continue;
  }
  ignored.push(line);
 }
 if(pending)rows.push({name:pending.name,phone:null});
 const dedup=new Map();
 for(const row of rows){
  const key=(row.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+'|'+digits(row.phone);
  if(!dedup.has(key))dedup.set(key,row);
 }
 return{rows:[...dedup.values()].slice(0,100),ignored:ignored.slice(0,40)};
}

export function inferPeopleRosterIntent(text){
 const input=String(text||'');
 const parsed=parsePeopleRoster(input);
 const phoneLikeLines=input.split(/\r?\n/).filter(looksPhone).length;
 const explicitRosterCue=/\b(names?|phone|phones|number|numbers|roster|contacts?|women|ladies|members)\b/i.test(input);
 const hasMultiplePeople=parsed.rows.length>=2;
 const strongPhoneEvidence=phoneLikeLines>=2;
 return{
  match:hasMultiplePeople&&strongPhoneEvidence&&(explicitRosterCue||phoneLikeLines>=3),
  rows:parsed.rows,
  ignored:parsed.ignored,
  phoneLikeLines,
  explicitRosterCue
 };
}
