// scripts/release-hardening-regression.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const db = read('lib/db.js');
const client = read('lib/supabaseClient.js');
const next = read('next.config.js');
const worker = read('pages/api/aria/process-events.js');
const health = read('pages/api/health.js');
const ci = read('.github/workflows/ci.yml');

assert.match(next, /NEXT_PUBLIC_VERCEL_ENV:\s*process\.env\.VERCEL_ENV/);
assert.match(client, /previewRequiresIsolation/);
assert.match(client, /targetsCanonicalProduction/);
assert.match(client, /PREVIEW_BLOCKED_SUPABASE_URL/);
assert.match(client, /previewBlockedFetch/);
assert.match(client, /Production Supabase access is blocked/);
assert.match(client, /supabaseAdmin = !previewRequiresIsolation/);
assert.doesNotMatch(client, /throw new Error\(\s*'NYEOCARE Preview requires its own isolated staging Supabase URL/);
assert.match(db, /VERCEL_ENV/);
assert.match(db, /NYEOCARE_PREVIEW_DATABASE_ISOLATED!=='true'/);
assert.match(worker, /timingSafeEqual/);
assert.match(worker, /processPendingAriaEvents\(\{organizationId,limit\}\)/);
assert.doesNotMatch(worker, /LIMIT 50/);
assert.match(health, /nyeocare-aria-event-worker/);
assert.match(health, /net\._http_response/);
assert.match(health, /aria_worker/);
assert.match(ci, /NYEOCARE_VERCEL_GIT_DEPLOYMENT_ENABLED/);
assert.match(ci, /d\.aria_worker!==\"ok\"/);

console.log('[RELEASE HARDENING] Preview build isolation, cron authentication, global event processing and truthful worker health checks passed.');
