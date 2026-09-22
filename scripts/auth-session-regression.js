// scripts/auth-session-regression.js
import{readFileSync,readdirSync,statSync}from'node:fs';
import{join}from'node:path';

const read=p=>readFileSync(p,'utf8');

function collect(dir){
 const out=[];
 for(const name of readdirSync(dir)){
  const path=join(dir,name),stat=statSync(path);
  if(stat.isDirectory())out.push(...collect(path));
  else if(/.(js|jsx|ts|tsx)$/.test(name))out.push(path);
 }
 return out;
}

const client=read('lib/clientSession.js');
const login=read('pages/login.js');
const person=read('pages/person/[id].js');
const app=read('pages/_app.js');
const all=collect('pages').concat(collect('components'));
const directSessionReads=all.filter(path=>/supabase\.auth\.getSession\s*\(/.test(read(path)));

const checks=[
 ['Client session manager serializes reads and refreshes',client.includes('readInFlight')&&client.includes('refreshInFlight')&&client.includes('await readInFlight.catch')],
 ['Session reads retry before giving up',client.includes('READ_RETRY_MS')&&client.includes('if(session)return session')],
 ['Login never signs out during passive validation',!login.includes('supabase.auth.signOut({scope:')],
 ['Person route uses shared session recovery',person.includes('getClientSession')&&person.includes('refreshClientSession')],
 ['Global app warms the persisted session',app.includes('AuthSessionKeeper')],
 ['No direct browser getSession calls remain in pages/components',directSessionReads.length===0]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){
 console.error('[AUTH SESSION] FAILED');
 console.error(failures.join(' | '));
 if(directSessionReads.length)console.error('Direct reads: '+directSessionReads.join(', '));
 process.exit(1);
}
console.log('[AUTH SESSION] Persistent session bootstrap, serialized auth operations, passive-guard safety, and route coverage passed.');
