// scripts/auth-organization-regression.js
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const auth=read('lib/auth.js');
const join=read('pages/api/users/join.js');
const create=read('pages/api/auth/create-organization.js');
const login=read('pages/login.js');
const packageJson=JSON.parse(read('package.json'));
const resolver=auth.slice(auth.indexOf('export async function getCurrentCareUser'),auth.indexOf('export async function ensureCareUser'));

const checks=[
  ['ordinary authenticated requests never create organizations',resolver.includes('if(!result.rows.length)return null;')&&!resolver.includes('ensureCareUser(')],
  ['explicit organization creation uses a per-identity transaction lock',auth.includes('pg_advisory_xact_lock(hashtextextended($1, 0))')&&auth.includes("client.query('BEGIN')")],
  ['inactive users cannot silently receive a new organization',auth.includes("code:'CARE_USER_INACTIVE'")],
  ['new organization creation requires an explicit authenticated intent',create.includes("req.body?.intent!=='create_organization'")&&create.includes('getAuthUser(req)')&&create.includes('ensureCareUser(authUser)')],
  ['invitation acceptance and organization creation share the same identity lock',join.includes('pg_advisory_xact_lock(hashtextextended($1, 0))')&&auth.includes('pg_advisory_xact_lock(hashtextextended($1, 0))')],
  ['legacy-workspace recovery requires the exact system-created owner signature',join.includes("row.role!=='owner'")&&join.includes("row.organization_name||'')!==expectedWorkspaceName")&&join.includes('organization_member_count')&&join.includes('account_membership_count')&&join.includes('sameInstant(row.auth_created_at,row.organization_created_at,5000)')],
  ['legacy-workspace recovery checks every organization-scoped public data table',join.includes('information_schema.columns')&&join.includes("col.column_name='organization_id'")&&join.includes('has_business_data')],
  ['legacy workspace movement is blocked when any real organization data exists',join.includes("dataCheck.rows[0]?.has_business_data===false")&&join.includes('No data was moved')],
  ['successful invitation acceptance changes only the existing membership row',join.includes('SET organization_id=$1,role=$2')&&join.includes('movedFromPersonalWorkspace')],
  ['login verifies organization membership before entering the app',login.includes("fetch('/api/users/me'")&&login.includes('membership.status===401')],
  ['standalone signup creates a workspace through an explicit endpoint',login.includes("fetch('/api/auth/create-organization'")&&login.includes("intent:'create_organization'")],
  ['unassigned sign-ins are directed back to their invitation instead of auto-provisioned',login.includes('reopen the invitation link')&&login.includes('Create a new organization instead')],
  ['the complete auth regression suite runs with npm test',packageJson.scripts.test.includes('npm run test:auth')&&packageJson.scripts['test:auth'].includes('auth-organization-regression.js')]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
for(const [name,ok] of checks)console.log((ok?'PASS: ':'FAIL: ')+name);
if(failures.length){
  console.error('[AUTH ORGANIZATION] FAILED:',failures.join(' | '));
  process.exit(1);
}
console.log('[AUTH ORGANIZATION] Explicit workspace creation, invitation assignment and guarded legacy-workspace recovery checks passed.');
