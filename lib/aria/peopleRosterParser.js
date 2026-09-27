const digits=v=>String(v??'').replace(/\D/g,'');
const instructionLine=line=>/^(please|kindly|call|let'?s|let us|the following|these are|our women|women that|please let)\b/i.test(String(line||'').trim());
const looksPhone=line=>{const d=digits(line);return d.length>=10&&d.length<=13&&/^[+\d\s().-]+$/.test(String(line||'').trim())};
const looksName=line=>{const v=String(line||'').trim();if(v.length<2||v.length>100||looksPhone(v)||instructionLine(v)||!/[a-zA-Z]/.test(v))return false;return/^(mummy|mama|sis|sister|bro|brother|mr|mrs|miss|ms|pastor|pst|elder|deacon|deaconess|rev|chief)\b/i.test(v)||v.split(/\s+/).length>=2||v===v.toUpperCase()};

export function parsePeopleRoster(text,{normalizePhone=()=>null}={}){
 const lines=String(text||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);
 const rows=[],ignored=[];let pending=null,lastRow=null;
 for(const line of lines){
  if(looksPhone(line)){
   if(pending){rows.push({name:pending.name,phone:line,note:pending.note||null});lastRow=rows[rows.length-1];pending=null}
   else if(lastRow)lastRow.note=lastRow.note?lastRow.note+' '+line:line;
   continue;
  }
  if(looksName(line)){
   if(pending)rows.push({name:pending.name,phone:null,note:pending.note||null});
   pending={name:line,note:null};
   continue;
  }
  if(lastRow&&/\b(strong|please)\b/i.test(line)){lastRow.note=lastRow.note?lastRow.note+' '+line:line;continue}
  ignored.push(line);
 }
 if(pending)rows.push({name:pending.name,phone:null,note:pending.note||null});
 const dedup=new Map();
 for(const row of rows){
  const key=(row.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+'|'+(normalizePhone(row.phone)||'');
  if(!dedup.has(key))dedup.set(key,row);
 }
 return{rows:[...dedup.values()].slice(0,100),ignored:ignored.slice(0,20)};
}
