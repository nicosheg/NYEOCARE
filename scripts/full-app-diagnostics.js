import{readdirSync,readFileSync,existsSync}from'node:fs';
import{join}from'node:path';

const read=p=>readFileSync(p,'utf8');
const walk=dir=>{
 if(!existsSync(dir))return[];
 return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const p=join(dir,entry.name);
  if(entry.isDirectory()&&entry.name!=='node_modules'&&!entry.name.startsWith('.'))return walk(p);
  return entry.isFile()&&/\.(js|jsx)$/.test(entry.name)?[p]:[];
 });
};

const files=[...new Set(['pages','components','lib'].flatMap(walk))];
const apiFiles=files.filter(x=>x.startsWith('pages/api/'));
const clientFiles=files.filter(x=>x.startsWith('pages/')||x.startsWith('components/'));
const failures=[],warnings=[];

for(const file of apiFiles){
 const source=read(file);

 if(source.includes('pool.connect()')&&!/\.release\(\)/.test(source))
  failures.push(file+': pool.connect() without release()');

 if(/await\s+[^\n;]*['"]BEGIN['"]/.test(source)&&!(/COMMIT/.test(source)||/ROLLBACK/.test(source)))
  failures.push(file+': transaction begins without COMMIT/ROLLBACK');

 const commit=source.indexOf('COMMIT');
 if(commit>=0){
  const releaseMatch=source.slice(commit).match(/[A-Za-z_$][A-Za-z0-9_$]*\.release\(\)/);
  const boundary=releaseMatch?commit+releaseMatch.index:source.length;
  const postCommit=source.slice(commit,boundary);

  if(
   /await\s+(?:pool\.)?query\(/.test(postCommit) ||
   /await\s+(?:updateEngagementMetricsForPerson|computeRelationshipScore|updatePeopleIntelligence|updatePersonState|createCareDraft|generateText)\s*\(/.test(postCommit)
  ){
   failures.push(file+': DB/AI work after COMMIT while the DB client may still be held');
  }
 }

 if(
  !/withOrg\(|withAdmin\(|getCurrentCareUser\(|getAuthUser\(/.test(source) &&
  !/(health|healthz|diagnostics\/client-error|login|logout|oauth|webhook|cron)/i.test(file)
 ){
  warnings.push(file+': authorization boundary not statically recognized; verify route intentionally public');
 }
}

for(const file of clientFiles){
 const source=read(file);

 const envMatches=[...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)]
  .map(x=>x[1])
  .filter(k=>!/^NEXT_PUBLIC_|^NODE_ENV$/.test(k));

 if(envMatches.length)
  failures.push(file+': non-public environment variable referenced by browser code: '+[...new Set(envMatches)].join(','));

 if(source.includes('setInterval(')&&!source.includes('clearInterval('))
  warnings.push(file+': setInterval() without a matching clearInterval() in the same file');

 if(/fetch\(/.test(source)&&!source.includes('response.ok')&&!source.includes('r.ok')&&!source.includes('res.ok'))
  warnings.push(file+': fetch() path may not validate HTTP success explicitly');

 if(!source.includes('AbortController')&&source.split('fetch(').length>3)
  warnings.push(file+': multiple fetch() calls without visible AbortController timeout; review slow-network behavior');
}

const pkg=existsSync('package.json')?JSON.parse(read('package.json')):{scripts:{}};

if(!pkg.scripts?.['test:experience'])
 warnings.push('package.json: test:experience is missing');

if(!existsSync('pages/api/health.js'))
 failures.push('pages/api/health.js: public health probe is missing');

if(!existsSync('components/ClientDiagnostics.js'))
 failures.push('components/ClientDiagnostics.js: browser diagnostics collector is missing');

if(!existsSync('pages/api/system/diagnostics/index.js'))
 failures.push('pages/api/system/diagnostics/index.js: admin diagnostics surface is missing');

console.log('[FULL APP DIAGNOSTICS]');
console.log('Scanned '+files.length+' JS/JSX files and '+apiFiles.length+' API routes.');
console.log('High-confidence failures: '+failures.length);

if(failures.length)for(const x of failures)console.error('FAIL:',x);

console.log('Review warnings: '+warnings.length);
for(const x of warnings.slice(0,80))console.warn('WARN:',x);
if(warnings.length>80)console.warn('WARN: '+(warnings.length-80)+' more warnings omitted.');

if(failures.length)process.exit(1);
console.log('PASS: no high-confidence diagnostic hazards found.');
