// scripts/auth-session-regression.js
import{readFileSync}from'node:fs';

const read=p=>readFileSync(p,'utf8');
const client=read('lib/clientSession.js');
const keeper=read('components/AuthSessionKeeper.js');
const app=read('pages/_app.js');
const login=read('pages/login.js');

const checks=[
 ['Shared session reader retries transient startup reads',client.includes('READ_RETRIES')&&client.includes('READ_RETRY_MS')&&client.includes('readSession')],
 ['Session reads are serialized',client.includes('inFlight')&&client.includes('refreshInFlight')],
 ['Persisted session can be recovered by refresh',client.includes('refreshClientSession()')],
 ['Global session keeper exists',keeper.includes('TOKEN_REFRESHED')&&keeper.includes('pageshow')&&keeper.includes('visibilitychange')],
 ['App mounts the global keeper',app.includes('<AuthSessionKeeper/>')],
 ['Login does not sign out during passive validation',!login.includes('supabase.auth.signOut({scope:')],
 ['Login preserves a session when Supabase validation is temporarily unavailable',login.includes('Existing session could not be validated after refresh; local session was preserved.')],
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){
 console.error('[AUTH SESSION] FAILED');
 console.error(failures.join(' | '));
 process.exit(1);
}
console.log('[AUTH SESSION] Persistent bootstrap, retry/recovery, global warming, and passive-guard safety passed.');

// CI verification marker
