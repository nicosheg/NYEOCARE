// scripts/auth-email-verification-regression.js
import{readFileSync}from'node:fs';

const read=path=>readFileSync(path,'utf8');
const login=read('pages/login.js');
const join=read('pages/join/[token].js');
const verify=read('pages/auth/verify.js');
const auth=read('lib/auth.js');
const joinApi=read('pages/api/users/join.js');
const createOrg=read('pages/api/auth/create-organization.js');
const migration=read('supabase/migrations/20261102120000_global_email_identity_and_org_auth_cleanup.sql');
const docs=read('docs/EMAIL_VERIFICATION.md');
const redirectHelper=read('lib/authRedirectUrl.js');
const middleware=read('middleware.js');

const checks=[
 ['production auth callbacks use one canonical origin and the legacy Vercel alias redirects before the browser client starts',redirectHelper.includes("CANONICAL_PRODUCTION_HOST = 'nyeocare.vercel.app'")&&!redirectHelper.includes('nyeocare-nicosheg.vercel.app')&&middleware.includes("LEGACY_PRODUCTION_HOST = 'nyeocare-nicosheg.vercel.app'")&&middleware.includes("CANONICAL_PRODUCTION_HOST = 'nyeocare.vercel.app'")&&middleware.includes('NextResponse.redirect(destination, 308)')],
 ['standalone signup sends verification back to the NYEOCARE origin',login.includes('/auth/verify?next=')&&login.includes('/auth/complete-signup')],
 ['invitation signup preserves the invitation destination through verification',join.includes('/auth/verify?next=')&&join.includes("'/join/'+token")],
 ['login offers a resend path for pending verification',login.includes('supabase.auth.resend')&&login.includes('Resend verification email')],
 ['invitation signup offers a resend path for pending verification',join.includes('supabase.auth.resend')&&join.includes('Resend verification email')],
 ['verification exchanges one-time token hashes through Supabase client without exposing its host',verify.includes('supabase.auth.verifyOtp({token_hash:tokenHash,type})')],
 ['verification safely restricts redirect destinations to same-origin allow-listed routes',verify.includes('parsed.origin!==window.location.origin')&&verify.includes("parsed.pathname==='/auth/complete-signup'")&&verify.includes("const invite=parsed.pathname.match(/^\\/join\\/")],
 ['verified standalone signup provisions only after token exchange and session validation',verify.includes("if(next==='/auth/complete-signup')")&&verify.includes("body:JSON.stringify({intent:'create_organization'})")&&verify.includes("if(!session?.access_token)")],
 ['verified invitation signup completes the original invitation instead of creating a personal workspace',verify.includes("const invitation=next.match(/^\\/join\\/")&&verify.includes("fetch('/api/users/join'")],
 ['organization creation refuses unverified email identities',createOrg.includes("if(!authUser.email_confirmed_at)")&&createOrg.includes('EMAIL_NOT_VERIFIED')],
 ['invitation acceptance refuses unverified email identities',joinApi.includes("if(!authUser.email_confirmed_at)")&&joinApi.includes('EMAIL_NOT_VERIFIED')],
 ['workspace creation serializes and rejects an already-owned normalized email',auth.includes("hashtextextended($1, 0)")&&auth.includes("email:${email}")&&auth.includes('EMAIL_ALREADY_ASSIGNED')],
 ['invitation membership assignment serializes on normalized email and returns a clear conflict',joinApi.includes("email:${email}")&&joinApi.includes('EMAIL_ALREADY_ASSIGNED')&&joinApi.includes("error?.code==='23505'")],
 ['database migration enforces global case-insensitive email uniqueness',migration.includes('ON public.users (lower(email))')&&migration.includes('DROP INDEX IF EXISTS public.users_org_email_unique')],
 ['organization deletion releases all linked Auth identities before tenant cascade',migration.includes('BEFORE DELETE ON public.organizations')&&migration.includes('DELETE FROM auth.users a')&&migration.includes('u.organization_id = OLD.id')],
 ['organization deletion writes a restricted minimal audit record',migration.includes('organization_deletion_audit')&&migration.includes('FORCE ROW LEVEL SECURITY')&&migration.includes('auth_accounts_deleted')],
 ['configuration gate documents required custom SMTP and owned sending domain',docs.includes('SMTP Settings')&&docs.includes('SPF, DKIM, and DMARC')&&docs.includes('does not own a sending domain')]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
for(const[name,ok]of checks)console.log((ok?'PASS: ':'FAIL: ')+name);
if(failures.length){
console.error('[AUTH EMAIL VERIFICATION] FAILED:',failures.join(' | '));
process.exit(1);
}
console.log('[AUTH EMAIL VERIFICATION] Branded verification, global email identity, and organization deletion lifecycle checks passed.');
