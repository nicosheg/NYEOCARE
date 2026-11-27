// lib/aria/careIntakeService.js
import crypto from 'node:crypto';
import { emitAriaEvent } from './eventEmitter';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set([
  'first_visit',
  'prayer_request',
  'personal_need',
  'practical_support',
  'relationship_request',
  'complaint',
  'check_in',
  'general',
  'context_note'
]);
const PRIVACY_RANK = { standard: 0, sensitive: 1, restricted: 2 };
const CATEGORY_MINIMUM = {
  first_visit: 'sensitive',
  prayer_request: 'restricted',
  personal_need: 'restricted',
  practical_support: 'sensitive',
  relationship_request: 'sensitive',
  complaint: 'restricted',
  check_in: 'sensitive',
  general: 'sensitive',
  context_note: 'sensitive'
};
const clean = (value, max = 1800) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);

export async function recordCareIntake({
  client,
  organizationId,
  personId,
  actorId,
  actorRole,
  source = 'aria',
  category,
  statement,
  summary,
  channel = 'operator_note',
  privacyClass = 'sensitive',
  consentConfirmed = false,
  contactPermission = 'unknown',
  idempotencyKey,
  additionalIntakeMetadata = {}
}) {
  if (!client || !organizationId || !personId || !actorId) {
    throw Object.assign(new Error('Organization, person, operator and transaction are required.'), { status: 400 });
  }
  category = clean(category, 60).toLowerCase();
  statement = clean(statement, 1800);
  summary = clean(summary || statement.slice(0, 260), 260);
  channel = clean(channel || 'operator_note', 30).toLowerCase();
  privacyClass = clean(privacyClass || 'sensitive', 30).toLowerCase();
  contactPermission = clean(contactPermission || 'unknown', 30).toLowerCase();
  idempotencyKey = clean(idempotencyKey, 100);

  if (!CATEGORIES.has(category)) throw Object.assign(new Error('Choose a valid care category.'), { status: 400 });
  if (!statement) throw Object.assign(new Error('The care report cannot be empty.'), { status: 400 });
  if (!UUID.test(idempotencyKey)) throw Object.assign(new Error('A UUID idempotency key is required.'), { status: 400 });
  if (consentConfirmed !== true) throw Object.assign(new Error('Explicit consent is required before recording identified care information.'), { status: 409 });
  if (!['unknown', 'allowed'].includes(contactPermission)) {
    throw Object.assign(new Error('Contact permission must be unknown or explicitly allowed. A care-recording consent is not contact permission.'), { status: 400 });
  }

  const role = String(actorRole || '').toLowerCase();
  const minimum = CATEGORY_MINIMUM[category];
  if (PRIVACY_RANK[minimum] > PRIVACY_RANK[privacyClass]) privacyClass = minimum;
  if (category === 'context_note') privacyClass = 'sensitive';

  const person = (await client.query(
    "SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1 FOR SHARE",
    [personId, organizationId]
  )).rows[0];
  if (!person) throw Object.assign(new Error('The selected active person could not be found in this organization.'), { status: 404 });

  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    organizationId,
    personId,
    actorId,
    category,
    statement,
    summary,
    channel,
    privacyClass,
    contactPermission,
    consentConfirmed: true
  })).digest('hex');
  const eventKey = 'care-intake:' + idempotencyKey;

  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'nyeocare:care-intake:' + organizationId + ':' + idempotencyKey
  ]);

  const existing = (await client.query(
    "SELECT * FROM aria_events WHERE organization_id=$1 AND event_key=$2 AND type='CARE_INTAKE_RECORDED' LIMIT 1 FOR UPDATE",
    [organizationId, eventKey]
  )).rows[0] || null;

  if (existing) {
    if (existing.metadata?.request_fingerprint !== fingerprint) {
      throw Object.assign(new Error('This request key was already used for different care details. Start a new request.'), { status: 409 });
    }
    return {
      event: existing,
      duplicate: true,
      privacyClass: existing.privacy_class,
      reviewRequired: existing.metadata?.intake?.requires_human_review !== false
    };
  }

  const event = await emitAriaEvent({
    organizationId,
    personId,
    type: 'CARE_INTAKE_RECORDED',
    actorId,
    actorRole: role,
    source,
    evidenceKind: 'human_report',
    verificationStatus: 'reported',
    confidence: 1,
    privacyClass,
    consentStatus: 'granted',
    eventKey,
    metadata: {
      request_fingerprint: fingerprint,
      intake: {
        category,
        statement,
        summary,
        channel,
        contact_permission: contactPermission,
        ...additionalIntakeMetadata,
        requires_human_review: category !== 'context_note',
        details_withheld: false
      },
      provenance: {
        reporter_user_id: actorId,
        reporter_role: role,
        captured_by: 'authenticated_operator'
      },
      consent_capture: {
        confirmed: true,
        method: 'operator_attestation',
        confirmed_by: actorId,
        confirmed_at: new Date().toISOString()
      }
    }
  }, client);

  if (!event) throw new Error('The care report could not be saved safely.');

  return {
    event,
    duplicate: false,
    privacyClass: event.privacy_class || privacyClass,
    reviewRequired: category !== 'context_note'
  };
}
