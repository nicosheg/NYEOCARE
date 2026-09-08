// lib/documentIntelligence.js
const ENDPOINT=String(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT||'').replace(/\/+$/,'');
const KEY=process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
const API_VERSION='2024-11-30';
const MODEL_ID=process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL||'prebuilt-layout';
const TIMEOUT_MS=120000;
const POLL_MS=2500;

function fail(message,code='DOCUMENT_LAYOUT_ERROR'){throw Object.assign(new Error(message),{code,retryable:false})}
function digits(v){return String(v||'').replace(/\D/g,'')}
function text(v){return String(v||'').replace(/\s+/g,' ').trim()}
function polygonBox(region,page){
 const p=region?.polygon;
 if(!Array.isArray(p)||p.length<4)return null;
 const xs=[],ys=[];
 for(let i=0;i<p.length;i+=2){xs.push(Number(p[i]));ys.push(Number(p[i+1]))}
 const x=Math.min(...xs),y=Math.min(...ys),right=Math.max(...xs),bottom=Math.max(...ys);
 const width=Number(page?.width)||1,height=Number(page?.height)||1;
 return{x:Math.round(((x+right)/2/width)*1000),y:Math.round(((y+bottom)/2/height)*1000),left:x/width*1000,right:right/width*1000,top:y/height*1000,bottom:bottom/height*1000};
}
function cellBox(cell,page){return polygonBox(cell?.boundingRegions?.[0],page)}
function lineBox(line,page){return polygonBox(line?.polygon?{polygon:line.polygon}:line?.boundingRegions?.[0],page)}
function isPhone(v){const d=digits(v);return d.length>=7&&d.length<=15}
function buildTableRows(tables,pages){
 if(!Array.isArray(tables)||!tables.length)return[];
 const table=tables.filter(t=>Number(t?.rowCount)>=2&&Number(t?.columnCount)>=2).sort((a,b)=>Number(b.rowCount)-Number(a.rowCount))[0];
 if(!table)return[];
 const rows=new Map();
 for(const cell of table.cells||[]){
  const r=Number(cell?.rowIndex);
  if(!Number.isInteger(r))continue;
  const page=pages[(cell?.boundingRegions?.[0]?.pageNumber||1)-1]||pages[0];
  const box=cellBox(cell,page);
  const content=text(cell?.content);
  if(!content&&!box)continue;
  if(!rows.has(r))rows.set(r,[]);
  rows.get(r).push({column:Number(cell?.columnIndex)||0,content,box});
 }
 const out=[];
 for(const [r,cells] of [...rows.entries()].sort((a,b)=>a[0]-b[0])){
  const meaningful=cells.filter(c=>c.content);
  if(!meaningful.length)continue;
  const header=meaningful.map(c=>c.content.toLowerCase()).join(' ');
  if(r===0&&/\b(name|names)\b/.test(header)&&/\b(phone|mobile|number|telephone)\b/.test(header))continue;
  const phoneCells=meaningful.filter(c=>isPhone(c.content));
  const nameCells=meaningful.filter(c=>!isPhone(c.content));
  const phone=phoneCells.sort((a,b)=>digits(b.content).length-digits(a.content).length)[0];
  const name=nameCells.sort((a,b)=>b.content.length-a.content.length)[0];
  if(!name&&!phone)continue;
  const yValues=[name?.box?.y,phone?.box?.y].filter(Number.isFinite);
  out.push({row_number:out.length+1,name_hint:name?.content||null,phone_hint:phone?.content||null,name_x:name?.box?.x??null,name_y:name?.box?.y??null,phone_x:phone?.box?.x??null,phone_y:phone?.box?.y??null,row_y:yValues.length?Math.round(yValues.reduce((a,b)=>a+b,0)/yValues.length):null,layout_source:'table'});
 }
 return out;
}
function buildLineRows(pages){
 const groups=[];
 for(const page of pages||[]){
  for(const line of page.lines||[]){
   const content=text(line.content);
   if(!content)continue;
   const box=lineBox(line,page);
   if(!box)continue;
   const digitsCount=digits(content).length;
   let group=groups.find(g=>Math.abs(g.y-box.y)<=28);
   if(!group){group={y:box.y,items:[]};groups.push(group)}
   group.items.push({content,box,phone:digitsCount>=7});
   group.y=Math.round(group.items.reduce((s,x)=>s+x.box.y,0)/group.items.length);
  }
 }
 groups.sort((a,b)=>a.y-b.y);
 const out=[];
 for(const group of groups){
  const phones=group.items.filter(x=>x.phone).sort((a,b)=>digits(b.content).length-digits(a.content).length);
  const names=group.items.filter(x=>!x.phone).sort((a,b)=>b.content.length-a.content.length);
  const phone=phones[0],name=names[0];
  const joined=group.items.map(x=>x.content).join(' ');
  if(!name&&!phone)continue;
  if(!phone&&isPhone(joined))continue;
  out.push({row_number:out.length+1,name_hint:name?.content||null,phone_hint:phone?.content||null,name_x:name?.box?.x??null,name_y:name?.box?.y??null,phone_x:phone?.box?.x??null,phone_y:phone?.box?.y??null,row_y:group.y,layout_source:'lines'});
 }
 return out;
}
function compact(result){
 const pages=result?.analyzeResult?.pages||[];
 const tables=result?.analyzeResult?.tables||[];
 const rows=buildTableRows(tables,pages);
 const finalRows=rows.length>=2?rows:buildLineRows(pages);
 if(!finalRows.length)fail('ARIA could not detect a readable register layout. Please retake the photo with the full register visible.','NO_LAYOUT_ROWS');
 return{provider:'azure-document-intelligence',model:MODEL_ID,pages:pages.length,rows:finalRows,raw_table_count:tables.length};
}
export async function analyzeRegisterLayout(imageBase64,onProgress){
 if(!ENDPOINT||!KEY)fail('Document Intelligence is not configured. Scan is disabled until AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY are configured.','LAYOUT_NOT_CONFIGURED');
 if(typeof imageBase64!=='string'||imageBase64.length<100)fail('Invalid scan image.','INVALID_IMAGE');
 onProgress?.('layout_analysis');
 const url=`${ENDPOINT}/documentintelligence/documentModels/${encodeURIComponent(MODEL_ID)}:analyze?_overload=analyzeDocument&api-version=${API_VERSION}&locale=en-US&features=ocrHighResolution`;
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Ocp-Apim-Subscription-Key':KEY},body:JSON.stringify({base64Source:imageBase64}),signal:AbortSignal.timeout(TIMEOUT_MS)});
 let data={};try{data=await response.json()}catch{}
 if(response.status!==202)throw Object.assign(new Error(data?.error?.message||'Document layout analysis failed.'),{code:'LAYOUT_REQUEST_FAILED',retryable:false});
 const operation=response.headers.get('operation-location');
 if(!operation)fail('Document Intelligence did not return an operation location.','LAYOUT_OPERATION_MISSING');
 const deadline=Date.now()+TIMEOUT_MS;
 while(Date.now()<deadline){
  await new Promise(r=>setTimeout(r,POLL_MS));
  const poll=await fetch(operation,{headers:{'Ocp-Apim-Subscription-Key':KEY},signal:AbortSignal.timeout(30000)});
  let result={};try{result=await poll.json()}catch{}
  if(result.status==='succeeded')return compact(result);
  if(result.status==='failed')throw Object.assign(new Error(result?.error?.message||'Document layout analysis failed.'),{code:'LAYOUT_ANALYSIS_FAILED',retryable:false});
 }
 fail('Document layout analysis timed out. No scan data was saved.','LAYOUT_TIMEOUT');
}
