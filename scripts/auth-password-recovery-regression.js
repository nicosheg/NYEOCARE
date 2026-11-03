// scripts/auth-password-recovery-regression.js
import{readFileSync,existsSync}from'node:fs';

const read=path=>readFileSync(path,'utf8');
const login=read('pages/login.js');
const forgot=read('pages/forgot-password.js');
const verify=read('pages/auth/verify.js');
const reset=read('pages/reset-password.js');
const policy=read('lib/authPasswordPolicy.js');
const docs=read('docs/EMAIL_VERIFICATION.md');
const checks=[
['login no longer calls the public account-existence endpoint',!login.includes('diagnose-login')&&!login.includes('diagnoseLogin')&&!existsSync('pages/api/auth/diagnose-login.js')],
['all incorrect-login failures use an account-neutral message',login.includes('We could not sign you in with those details')&&!login.includes('No NYEOCARE account was found')],
['signup does not disclose an already-registered email address',login.includes('We could not create the account with those details')&&!login.includes('This email is already registered')],
['signup and reset share a 12-character mixed-character password policy',login.includes('getPasswordChecks(password)')&&reset.includes('getPasswordChecks(password)')&&policy.includes('PASSWORD_MIN_LENGTH = 12')&&policy.includes('isStrongPassword')],
['login exposes a branded forgot-password route',login.includes("router.push('/forgot-password')")&&login.includes('Forgot password?')],
['forgot-password sends a reset link through the NYEOCARE verification callback',forgot.includes('resetPasswordForEmail(cleanEmail')&&forgot.includes('/auth/verify?next=')&&forgot.includes("encodeURIComponent('/reset-password')")],
['forgot-password response does not reveal whether the email exists',forgot.includes('If an NYEOCARE account matches that email address')&&forgot.includes('does not reveal whether an email address is registered')],
['forgot-password includes a 60-second user-facing cooldown and rate-limit handling',forgot.includes('COOLDOWN_MS=60000')&&forgot.includes('localStorage')&&forgot.includes('status===429')],
['verification callback accepts recovery token hashes and only routes after exchange',verify.includes("'recovery'")&&verify.includes('verifyOtp({token_hash:tokenHash,type})')&&verify.includes('recoveryVerified')&&verify.includes('password-recovery-verified')],
['reset page requires recovery confirmation and a live session before updating password',reset.includes('sessionStorage.getItem(RECOVERY_KEY)')&&reset.includes('supabase.auth.getSession()')&&reset.includes('supabase.auth.updateUser({password})')],
['successful password reset attempts global session revocation',reset.includes("signOut({scope:'global'})")],
['documentation includes branded recovery/password-change templates and required Auth settings',docs.includes('Recovery email template')&&docs.includes('Password-changed notification template')&&docs.includes('1800 seconds (30 minutes)')&&docs.includes('custom SMTP provider')]
];
const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
for(const[name,ok]of checks)console.log((ok?'PASS: ':'FAIL: ')+name);
if(failures.length){console.error('[AUTH PASSWORD RECOVERY] FAILED:',failures.join(' | '));process.exit(1)}
console.log('[AUTH PASSWORD RECOVERY] Branded password recovery and anti-enumeration checks passed.');
