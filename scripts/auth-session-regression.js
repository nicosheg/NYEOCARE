// scripts/auth-session-regression.js
import { readFileSync } from 'node:fs';

const read = p => readFileSync(p, 'utf8');

const client = read('lib/clientSession.js');
const keeper = read('components/AuthSessionKeeper.js');
const app = read('pages/_app.js');
const login = read('pages/login.js');
const supabaseClient = read('lib/supabaseClient.js');
const profile = read('pages/profile.js');

const checks = [
  [
    'Browser persistence is explicit',
    supabaseClient.includes('persistSession: isBrowser') &&
      supabaseClient.includes('autoRefreshToken: isBrowser'),
  ],
  [
    'Canonical Supabase session reads are used',
    client.includes('supabase.auth.getSession()'),
  ],
  [
    'Transient session reads retry',
    client.includes('READ_RETRIES') &&
      client.includes('READ_RETRY_MS') &&
      client.includes('readSession'),
  ],
  [
    'Session operations are serialized',
    client.includes('inFlight') &&
      client.includes('refreshInFlight'),
  ],
  [
    'Forced refresh actually refreshes',
    client.includes('if (forceRefresh)') &&
      client.includes('return refreshClientSession()'),
  ],
  [
    'Global session keeper is mounted exactly once',
    app.split('<AuthSessionKeeper/>').length - 1 === 1,
  ],
  [
    'Global session keeper warms lifecycle events',
    keeper.includes('pageshow') &&
      keeper.includes('visibilitychange') &&
      keeper.includes('online'),
  ],
  [
    'Login never signs out during passive validation',
    !login.includes('supabase.auth.signOut('),
  ],
  [
    'Login does not misreport every Auth error as a wrong password',
    !login.includes("else if(accountExists===true)showMessage('The password is incorrect."),
  ],
  [
    'Profile sign out is local to the current session',
    /supabase\.auth\.signOut\(\{\s*scope:\s*'local'\s*\}\)/.test(profile),
  ],
];

const failures = checks.filter(([, ok]) => !ok).map(([name]) => name);

if (failures.length) {
  console.error('[AUTH SESSION] FAILED');
  console.error(failures.join(' | '));
  process.exit(1);
}

console.log(
  '[AUTH SESSION] Canonical persisted session, automatic refresh, serialized reads, real forced refresh, and single global keeper checks passed.'
);
