// scripts/auth-password-recovery-regression.js
import{readFileSync,existsSync}from'node:fs';

const read=path=>readFileSync(path,'utf8');
const login=read('pages/login.js');
const profile=read('pages/profile.js');
const forgot=read('pages/forgot-password.js');
const verify=read('pages/auth/verify.js');
const reset=read('pages/reset-password.js');
const policy=read('lib/authPasswordPolicy.js');
const app=read('pages/_app.js');
const recoveryState=read('lib/authRecoveryState.js');
const sessionCache=read('lib/clientSession.js');
const supabaseClient=read('lib/supabaseClient.js');
const redirectHelper=read('lib/authRedirectUrl.js');
const loginRedirects=read('pages/login.js');
const invitation=read('pages/join/[token].js');
const docs=read('docs/EMAIL_VERIFICATION.md');
const checks=[
['login no longer calls the public account-existence endpoint',!login.includes('diagnose-login')&&!login.includes('diagnoseLogin')&&!existsSync('pages/api/auth/diagnose-login.js')],
['all incorrect-login failures use an account-neutral message',login.includes('We could not sign you in with those details')&&!login.includes('No NYEOCARE account was found')],
['signup does not disclose an already-registered email address',login.includes('We could not create the account with those details')&&!login.includes('This email is already registered')],
['signup and reset share a 12-character mixed-character password policy',login.includes('getPasswordChecks(password)')&&reset.includes('getPasswordChecks(password)')&&policy.includes('PASSWORD_MIN_LENGTH = 12')&&policy.includes('isStrongPassword')],
['login exposes a branded forgot-password route',login.includes("router.push('/forgot-password')")&&login.includes('Forgot password?')],
['forgot-password sends the reset email through the NYEOCARE verification callback',forgot.includes('resetPasswordForEmail(cleanEmail')&&forgot.includes('/auth/verify?next=')&&forgot.includes("encodeURIComponent('/reset-password')")],
['forgot-password records a short-lived recovery intent and callback receipt for cross-tab routing',forgot.includes('markPendingRecoveryRequest()')&&forgot.includes('clearPendingRecoveryRequest()')&&recoveryState.includes('RECOVERY_REQUEST_TTL_MS')&&recoveryState.includes('RECOVERY_CALLBACK_SEEN_KEY')],
['forgot-password response does not reveal whether the email exists',forgot.includes('If an NYEOCARE account matches that email address')&&forgot.includes('does not reveal whether an email address is registered')],
['forgot-password includes a 60-second user-facing cooldown and rate-limit handling',forgot.includes('COOLDOWN_MS=60000')&&forgot.includes('localStorage')&&forgot.includes('status===429')],
['Supabase automatically processes browser PKCE callbacks instead of competing manual exchanges',supabaseClient.includes('detectSessionInUrl: isBrowser')&&!supabaseClient.includes('detectSessionInUrl: false,\n    flowType')],
['the Supabase singleton captures the recovery callback before automatic PKCE processing clears the URL',supabaseClient.indexOf('markRecoveryCallbackSeen()')<supabaseClient.indexOf('export const supabase = createClient')&&supabaseClient.includes('searchParams.has')],
['the Supabase singleton installs an early recovery listener and clears markers on sign-out',supabaseClient.includes('supabase.auth.onAuthStateChange')&&supabaseClient.includes("event !== 'PASSWORD_RECOVERY'")&&supabaseClient.includes('markVerifiedRecoverySession()')&&supabaseClient.includes('clearRecoveryCallbackSeen()')],
['ordinary sign-out preserves an outstanding recovery request until it expires or is completed',supabaseClient.includes('Keep an outstanding recovery request alive')&&!supabaseClient.includes("if (event === 'SIGNED_OUT') {\n      clearVerifiedRecoverySession();\n      clearPendingRecoveryRequest();")],
['the shared session cache mirrors PASSWORD_RECOVERY sessions',sessionCache.includes("event === 'PASSWORD_RECOVERY'")],
['production callback URLs preserve either attached stable app alias and exclude preview hosts',redirectHelper.includes('nyeocare.vercel.app')&&redirectHelper.includes('nyeocare-nicosheg.vercel.app')&&redirectHelper.includes('window.location.origin')],
['the verification route waits for Supabase URL initialization and recognizes a captured PKCE recovery callback',verify.includes('supabase.auth.getSession()')&&!verify.includes('exchangeCodeForSession(code)')&&verify.includes('hasVerifiedRecoverySession()')&&verify.includes('hasPendingRecoveryRequest()')&&verify.includes('hasRecoveryCallbackBeenSeen()')&&verify.includes("next==='/reset-password'")&&!verify.includes("if(next!=='/reset-password')")],
['the global app catches Site URL fallback callbacks after PKCE removes the code from the URL',app.includes('hasRecoveryCallbackBeenSeen()')&&app.includes('hasPendingRecoveryRequest()')&&app.includes("router.replace('/reset-password')")&&app.includes("router.pathname!=='/'")],
['reset page requires a live session plus verified callback context before password update',reset.includes('hasVerifiedRecoverySession()')&&reset.includes('hasRecoveryCallbackBeenSeen()')&&reset.includes('supabase.auth.getSession()')&&reset.includes('supabase.auth.updateUser({password})')],
['successful password reset clears recovery markers and attempts global session revocation',reset.includes('clearVerifiedRecoverySession()')&&reset.includes('clearPendingRecoveryRequest()')&&reset.includes("signOut({scope:'global'})")],
['documentation includes recovery templates, sender setup and both production callback aliases',docs.includes('Recovery email template')&&docs.includes('Password-changed notification template')&&docs.includes('custom SMTP provider')&&docs.includes('nyeocare-nicosheg.vercel.app/**')],
['signed-in Profile password recovery uses the browser singleton and same-origin callback',profile.includes('supabase.auth.resetPasswordForEmail(email,{redirectTo})')&&profile.includes('getAuthRedirectUrl')&&!profile.includes("fetch('/api/profile/password-reset'")],
['signed-in Profile recovery records routing state and shares the 60-second cross-flow cooldown',profile.includes('markPendingRecoveryRequest()')&&profile.includes('clearPendingRecoveryRequest()')&&profile.includes("PASSWORD_RECOVERY_COOLDOWN_KEY='nyeocare:password-recovery-requested-at'")&&profile.includes('passwordCooldown>0')],
['legacy server-side password reset endpoints are retired to prevent PKCE verifier loss',!existsSync('pages/api/profile/password-reset.js')&&!existsSync('pages/api/account/password-reset.js')],
['server-side recovery redirect helper is not used; browser origin helper remains canonical',!existsSync('lib/authRecoveryRequest.js')&&redirectHelper.includes('window.location.origin')&&!redirectHelper.includes('getAuthRedirectUrlFromRequest') ]
];
const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
for(const[name,ok]of checks)console.log((ok?'PASS: ':'FAIL: ')+name);
if(failures.length){console.error('[AUTH PASSWORD RECOVERY] FAILED:',failures.join(' | '));process.exit(1)}
console.log('[AUTH PASSWORD RECOVERY] Branded password recovery and anti-enumeration checks passed.');
