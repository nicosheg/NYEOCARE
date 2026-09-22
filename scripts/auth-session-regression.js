// scripts/auth-session-regression.js
import{readFileSync}from'node:fs';

const read=p=>readFileSync(p,'utf8');
const client=read('lib/clientSession.js');
const keeper=read('components/AuthSessionKeeper.js');
const app=read('pages/_app.js');
const login=read('pages/login.js');
const supabaseClient=read('lib/supabaseClient.js');

const checks=[
 ['Session persistence is explicit',supabaseClient.includes('persistSession:true')&&supabaseClient.includes('autoRefreshToken:true')],
 ['Auth startup waits for INITIAL_SESSION',client.includes('INITIAL_WAIT_MS')&&client.includes('INITIAL_SESSION')&&client.includes('waitForInitialSession')],
 ['Transient session reads retry',client.includes('READ_RETRY_MS')&&client.includes('readSession')],
 ['Session operations are serialized',client.includes('inFlight')&&client.includes('refreshInFlight')],
 ['Global session keeper warms lifecycle events',keeper.includes('pageshow')&&keeper.includes('visibilitychange')&&keeper.includes('online')],
 ['Global session keeper is mounted',app.includes('<AuthSessionKeeper/>')],
 ['Login never signs out during passive validation',!login.includes('supabase.auth.signOut(')],
 ['Login does not redirect on a session-read exception',login.includes('[AUTH] Existing session check delayed')]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){
 console.error('[AUTH SESSION] FAILED');
 console.error(failures.join(' | '));
 process.exit(1);
}
console.log('[AUTH SESSION] Persisted-session bootstrap, retry/recovery, lifecycle warming, and passive-guard safety passed.');
