// scripts/strict-tenant-api-regression.mjs
// Regression coverage for the high-risk tenant-boundary failures found in the
// production repository. These checks complement live RLS and API integration tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const apiRoot = path.join(process.cwd(), 'pages/api');

function collectJavaScript(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJavaScript(full));
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const allApiSource = collectJavaScript(apiRoot)
  .map(file => fs.readFileSync(file, 'utf8'))
  .join('\n');

const attention = read('pages/api/attention.js');
const dashboard = read('pages/api/dashboard.js');
const engagement = read('pages/api/engagement/update-metrics.js');
const members = read('pages/api/members.js');
const settings = read('pages/api/settings.js');
const me = read('pages/api/users/me.js');
const bulkSms = read('pages/api/send-whatsapp-bulk.js');
const migrationRoute = read('pages/api/admin/migrate-to-people.js');
const mergeRoute = read('pages/api/admin/merge-and-drop-members.js');
const dropRoute = read('pages/api/admin/drop-members.js');
const migration = read('supabase/migrations/20261028215806_strict_tenant_isolation_hardening.sql');

const checks = [
  ['No API route may use the old query-controlled demo organization fallback',
    !/req\.query\.organization_id\s*\|\|\s*['"]demo-org['"]/.test(allApiSource)],
  ['No API route may use the old body-controlled demo organization fallback',
    !/req\.body\?\.organization_id\s*\|\|[^;\n]*['"]demo-org['"]/.test(allApiSource)],
  ['Legacy church_id must not determine API tenant scope',
    !/req\.(?:query|body)(?:\?\.)?\.?(?:church_id)/.test(allApiSource)],
  ['Attention endpoint requires authenticated organization context',
    attention.includes('withOrg(handler)') && attention.includes('getAttentionItems(req.org.id)') && !attention.includes('req.query.organization_id')],
  ['Dashboard is authenticated and scopes attendance to both tenant keys',
    dashboard.includes('withOrg(handler)') && dashboard.includes('const orgId = req.org.id') && dashboard.includes('ar.organization_id = $1') && dashboard.includes('p.organization_id = ar.organization_id')],
  ['Engagement rebuild requires an organization admin and ignores client tenant identifiers',
    engagement.includes('withAdmin(async function handler') && engagement.includes('updateEngagementMetrics(req.org.id)') && !engagement.includes('req.query.organization_id') && !engagement.includes('req.body?.organization_id')],
  ['Legacy members route uses the canonical tenant-scoped people table',
    members.includes('withOrg(handler)') && members.includes('WHERE organization_id = $1') && !members.includes('church_id') && !members.includes('FROM members')],
  ['Settings are stored inside the authenticated organization row',
    settings.includes('withOrg(async function handler') && settings.includes('WHERE id = $1') && !settings.includes('supabaseAdmin') && !settings.includes(".from('settings')")],
  ['Current-user endpoint does not serialize the complete DB user row',
    me.includes('organization_id: user.organization_id') && !me.includes('res.status(200).json(user)') && !me.includes('password_hash:')],
  ['Legacy bulk SMS fails closed',
    bulkSms.includes('status(410)') && !bulkSms.includes('sendSMS(') && !bulkSms.includes('FROM members')],
  ['Unauthenticated DDL route fails closed',
    migrationRoute.includes('status(404)') && !migrationRoute.includes('CREATE TABLE') && !migrationRoute.includes('pool.query')],
  ['Unauthenticated merge/drop route fails closed',
    mergeRoute.includes('status(404)') && !mergeRoute.includes('DROP TABLE') && !mergeRoute.includes('pool.query')],
  ['Unauthenticated drop-table route fails closed',
    dropRoute.includes('status(404)') && !dropRoute.includes('DROP TABLE') && !dropRoute.includes('pool.query')],
  ['Server-only queues have explicit deny policies and revoked client privileges',
    migration.includes('person_create_requests') && migration.includes('person_identity_review_items') && migration.includes('REVOKE ALL ON TABLE public.%I FROM anon, authenticated') && migration.includes('USING (false) WITH CHECK (false)')],
  ['Session membership writes verify both session and user belong to the caller organization',
    migration.includes('u.organization_id = (SELECT public.current_user_org_id())') && migration.includes('s.organization_id = (SELECT public.current_user_org_id())')],
  ['Tenant tables are forced through RLS where PostgreSQL supports it',
    migration.includes('FORCE ROW LEVEL SECURITY') && migration.includes('ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY')],
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) {
  console.error('[STRICT TENANT API] FAILED');
  console.error(failed.join('\n'));
  process.exit(1);
}

console.log('[STRICT TENANT API] ' + checks.length + ' strict tenant-boundary regression checks passed.');
