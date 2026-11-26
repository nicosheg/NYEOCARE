// pages/api/aria/intake.js
import crypto from 'node:crypto';
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';
import { isOrganizationOperator } from '../../../lib/attendance/access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set([
  'first_visit',
  'prayer_request',
  'personal_need',
  'practical_support',
  'relationship_request',
  'complaint',
  'check_in',
  'general'
]);
const CHANNELS = new Set(['in_person', 'phone', 'whatsapp', 'email', 'form', 'operator_note', 'other']);
const CONSENT = new Set(['unknown', 'granted', 'declined', 'withdrawn', 'not_required']);
const PRIVACY = new Set(['standard', 'sensitive', 'restricted']);
const CONTACT = new Set(['unknown', 'allowed', 'do_not_contact']);
const PRIVACY_RANK = { standard: 0, sensitive: 1, restricted: 2 };
const CATEGORY_MINIMUM = {
  first_visit: 'sensitive',
  prayer_request: 'restricted',
  personal_need: 'restricted',
  practical_support: 'sensitive',
  relationship_request: 'sensitive',
  complaint: 'restricted',
  check_in: 'sensitive',
  general: 'sensitive'
};
const CONTACT_ACTION_TYPES = ['SEND_MESSAGE', 'CARE_FOLLOW_UP', 'FOLLOW_UP', 'CHECK_IN', 'CALL', 'VISIT', 'CARE_CONTACT'];

const clean = (value, max = 1800) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const validPrivacyForRole = (privacyClass, role, actorId, eventActorId) => {
  if (privacyClass === 'standard') return true;
  if (String(actorId) === String(eventActorId)) return true;
  if (privacyClass === 'sensitive') return ['owner', 'admin', 'leader'].includes(role);
  return ['owner', 'admin'].includes(role);
};

async function persistNoContact(client, organizationId, personId, actorId, intakeEvent, privacyClass, consentStatus) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    ['nyeocare:do-not-contact:' + organizationId + ':' + personId]
  );

  const existing = await client.query(
    `SELECT id FROM aria_care_contexts
     WHERE organization_id=$1 AND person_id=$2 AND kind='other'
       AND metadata->>'do_not_contact'='true'
       AND (ends_on IS NULL OR ends_on>=CURRENT_DATE)
     ORDER BY created_at DESC LIMIT 1`,
    [organizationId, personId]
  );

  if (!existing.rows.length) {
    await client.query(
      `INSERT INTO aria_care_contexts(
        organization_id,person_id,kind,starts_on,ends_on,service_type,note,metadata,created_by
      ) VALUES($1,$2,'other',CURRENT_DATE,NULL,NULL,$3,$4::jsonb,$5)`,
      [
        organizationId,
        personId,
        'Person asked the organization not to initiate further contact.',
        JSON.stringify({
          do_not_contact: true,
          source: 'care_intake',
          source_event_id: intakeEvent.id,
          human_reported: true
        }),
        actorId
      ]
    );
  }

  await emitAriaEvent({
    organizationId,
    personId,
    type: 'COMMUNICATION_PREFERENCE_CHANGED',
    source: 'care_intake',
    actorId,
    actorRole: null,
    evidenceKind: 'human_report',
    verificationStatus: 'reported',
    confidence: 1,
    privacyClass: privacyClass === 'restricted' ? 'restricted' : 'sensitive',
    consentStatus,
    eventKey: 'care-contact-preference:' + intakeEvent.id,
    metadata: {
      contact_preference: 'do_not_contact',
      source_intake_event_id: intakeEvent.id,
      summary: 'Person asked the organization not to initiate further contact.'
    }
  }, client);

  await client.query(
    `UPDATE aria_actions
     SET status='cancelled',
         failure_reason='Person requested no further organization-initiated contact.',
         updated_at=NOW()
     WHERE organization_id=$1 AND person_id=$2
       AND status IN('proposed','approved','executing')
       AND upper(type)=ANY($3::text[])`,
    [organizationId, personId, CONTACT_ACTION_TYPES]
  );

  await client.query(
    `UPDATE aria_daily_queue_items q
     SET status='dismissed',
         completed_at=COALESCE(q.completed_at,NOW()),
         updated_at=NOW()
     FROM aria_actions a
     WHERE q.organization_id=a.organization_id
       AND q.source_id=a.id::text
       AND q.task_kind='follow_up'
       AND q.status IN('pending','deferred')
       AND a.organization_id=$1 AND a.person_id=$2
       AND a.status='cancelled'
       AND upper(a.type)=ANY($3::text[])`,
    [organizationId, personId, CONTACT_ACTION_TYPES]
  );
}

async function listIntake(req, res) {
  const role = String(req.user.role || '').toLowerCase();
  const status = ['pending', 'reviewed', 'all'].includes(String(req.query.status || 'pending'))
    ? String(req.query.status || 'pending')
    : 'pending';
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 40, 1), 100);

  const result = await pool.query(
    `SELECT
       e.id,e.person_id,e.source,e.actor_id,e.actor_role,e.occurred_at,e.created_at,
       e.privacy_class,e.consent_status,e.metadata->'intake' AS intake,
       r.decision AS review_decision,r.reason AS review_reason,
       r.defer_until,r.reviewed_at,r.action_id
     FROM aria_events e
     LEFT JOIN LATERAL (
       SELECT
         d.metadata->>'decision' AS decision,
         d.metadata->>'reason' AS reason,
         d.metadata->>'defer_until' AS defer_until,
         d.metadata->>'action_id' AS action_id,
         d.occurred_at AS reviewed_at
       FROM aria_events d
       WHERE d.organization_id=e.organization_id
         AND d.type='CARE_INTAKE_REVIEWED'
         AND d.metadata->>'intake_event_id'=e.id::text
       ORDER BY d.occurred_at DESC,d.created_at DESC
       LIMIT 1
     ) r ON true
     WHERE e.organization_id=$1
       AND e.type='CARE_INTAKE_RECORDED'
       AND (
         e.privacy_class='standard'
         OR (e.privacy_class='sensitive' AND (e.actor_id=$2 OR $3::text IN('owner','admin','leader')))
         OR (e.privacy_class='restricted' AND (e.actor_id=$2 OR $3::text IN('owner','admin')))
       )
       AND (
         $4::text='all'
         OR ($4::text='pending' AND r.decision IS NULL)
         OR ($4::text='reviewed' AND r.decision IS NOT NULL)
       )
     ORDER BY e.occurred_at DESC,e.created_at DESC
     LIMIT $5`,
    [req.org.id, req.user.id, role, status, limit]
  );

  return res.status(200).json({ success: true, items: result.rows });
}

async function createIntake(req, res) {
  if (!isOrganizationOperator(req.user?.role)) {
    return res.status(403).json({ error: 'Organization operator access is required.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const category = clean(body.category, 60).toLowerCase();
  const personId = clean(body.person_id, 80);
  const idempotencyKey = clean(body.idempotency_key || req.headers['idempotency-key'], 100);
  const consentStatus = clean(body.consent_status || 'unknown', 30).toLowerCase();
  const requestedPrivacy = clean(body.privacy_class || 'sensitive', 30).toLowerCase();
  const contactPermission = clean(body.contact_permission || 'unknown', 30).toLowerCase();
  const channel = clean(body.channel || 'operator_note', 30).toLowerCase();

  if (!CATEGORIES.has(category)) return res.status(400).json({ error: 'Choose a valid care signal category.' });
  if (personId && !UUID.test(personId)) return res.status(400).json({ error: 'The selected person is invalid.' });
  if (!UUID.test(idempotencyKey)) return res.status(400).json({ error: 'A UUID idempotency_key is required so retries cannot create duplicate care signals.' });
  if (!CONSENT.has(consentStatus)) return res.status(400).json({ error: 'Choose a valid consent status.' });
  if (!PRIVACY.has(requestedPrivacy)) return res.status(400).json({ error: 'Choose a valid confidentiality level.' });
  if (!CONTACT.has(contactPermission)) return res.status(400).json({ error: 'Choose a valid contact preference.' });
  if (!CHANNELS.has(channel)) return res.status(400).json({ error: 'Choose a valid intake channel.' });
  if (contactPermission === 'do_not_contact' && !personId) {
    return res.status(400).json({ error: 'A person must be identified before a no-contact preference can be enforced.' });
  }
  if (personId && consentStatus === 'not_required') {
    return res.status(400).json({ error: 'Identified-person care records cannot be marked as consent-not-required.' });
  }

  const statementInput = clean(body.statement, 1800);
  const summaryInput = clean(body.summary, 260);
  const consentDeclined = consentStatus === 'declined' || consentStatus === 'withdrawn';
  const statement = consentDeclined ? null : statementInput || null;
  const summary = consentDeclined ? null : summaryInput || null;

  let privacyClass = requestedPrivacy;
  if (PRIVACY_RANK[CATEGORY_MINIMUM[category]] > PRIVACY_RANK[privacyClass]) {
    privacyClass = CATEGORY_MINIMUM[category];
  }
  if (personId && consentStatus !== 'granted') privacyClass = 'restricted';
  if (consentDeclined) privacyClass = 'restricted';

  const organizationId = req.org.id;
  const client = await pool.connect();
  let storedEvent = null;
  let duplicate = false;

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ['nyeocare:care-intake:' + organizationId + ':' + idempotencyKey]
    );

    if (personId) {
      const person = await client.query(
        `SELECT id FROM people
         WHERE id=$1::uuid AND organization_id=$2
           AND COALESCE(status,'active')='active'
         LIMIT 1 FOR SHARE`,
        [personId, organizationId]
      );
      if (!person.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'The selected active person could not be found in this organization.' });
      }
    }

    const eventKey = 'care-intake:' + idempotencyKey;
    storedEvent = await emitAriaEvent({
      organizationId,
      personId: personId || null,
      type: 'CARE_INTAKE_RECORDED',
      source: 'care_intake',
      actorId: req.user.id,
      actorRole: req.user.role,
      evidenceKind: 'human_report',
      verificationStatus: 'reported',
      confidence: 0.9,
      privacyClass,
      consentStatus,
      eventKey,
      metadata: {
        intake: {
          category,
          statement,
          summary,
          channel,
          contact_permission: contactPermission,
          requires_human_review: true,
          details_withheld: consentDeclined
        },
        provenance: {
          reporter_user_id: req.user.id,
          reporter_role: req.user.role,
          captured_by: 'authenticated_operator'
        }
      }
    }, client);

    if (!storedEvent) {
      duplicate = true;
      const existing = await client.query(
        'SELECT * FROM aria_events WHERE organization_id=$1 AND event_key=$2 LIMIT 1',
        [organizationId, eventKey]
      );
      storedEvent = existing.rows[0] || null;
    }
    if (!storedEvent) throw new Error('The care signal could not be persisted.');

    const savedPermission = storedEvent.metadata?.intake?.contact_permission;
    if (personId && savedPermission === 'do_not_contact') {
      await persistNoContact(
        client,
        organizationId,
        personId,
        req.user.id,
        storedEvent,
        storedEvent.privacy_class || privacyClass,
        storedEvent.consent_status || consentStatus
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CARE INTAKE] record failed:', error?.message || error);
    return res.status(error?.status || 500).json({
      error: error?.status ? error.message : 'The care signal could not be saved safely.'
    });
  } finally {
    client.release();
  }

  return res.status(duplicate ? 200 : 201).json({
    success: true,
    duplicate,
    intake_event_id: storedEvent.id,
    privacy_class: storedEvent.privacy_class,
    consent_status: storedEvent.consent_status,
    contact_restriction_saved: storedEvent.metadata?.intake?.contact_permission === 'do_not_contact',
    review_required: true,
    care_responsibility_created: false
  });
}

export default withOrg(async function handler(req, res) {
  if (req.method === 'GET') return listIntake(req, res);
  if (req.method === 'POST') return createIntake(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed.' });
});
