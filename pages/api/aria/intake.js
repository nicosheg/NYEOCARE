// pages/api/aria/intake.js
import { recordCareIntake } from '../../../lib/aria/careIntakeService';
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { isOrganizationOperator } from '../../../lib/attendance/access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(['first_visit','prayer_request','personal_need','practical_support','relationship_request','complaint','check_in','general','context_note']);
const CHANNELS = new Set(['in_person','phone','whatsapp','email','form','operator_note','other']);
const CONSENT = new Set(['unknown','granted','declined','withdrawn','not_required']);
const PRIVACY = new Set(['standard','sensitive','restricted']);
const CONTACT = new Set(['unknown','allowed','do_not_contact']);
const clean = (value, max = 1800) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);

async function listIntake(req, res) {
  if (!isOrganizationOperator(req.user?.role)) return res.status(403).json({ error: 'Organization operator access is required.' });
  const role = String(req.user.role || '').toLowerCase();
  const status = ['pending', 'reviewed', 'all'].includes(String(req.query.status || 'pending'))
    ? String(req.query.status || 'pending')
    : 'pending';
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 40, 1), 100);
  const timeZoneResult = await pool.query("SELECT COALESCE(settings->>'timezone','Africa/Lagos') AS time_zone FROM organizations WHERE id=$1 LIMIT 1",[req.org.id]);
  const timeZone = timeZoneResult.rows[0]?.time_zone || 'Africa/Lagos';
  const today = new Intl.DateTimeFormat('en-CA',{timeZone}).format(new Date());

  const result = await pool.query(
    `SELECT
       e.id,e.person_id,p.display_name,e.source,e.actor_id,e.actor_role,e.occurred_at,e.created_at,
       e.privacy_class,e.consent_status,e.metadata->'intake' AS intake,
       r.linked_person_id,r.decision AS review_decision,r.reason AS review_reason,
       r.defer_until,r.reviewed_at,r.action_id
     FROM aria_events e
     LEFT JOIN people p ON p.id=e.person_id AND p.organization_id=e.organization_id
     LEFT JOIN LATERAL (
       SELECT
         d.metadata->>'decision' AS decision,
         d.metadata->>'reason' AS reason,
         d.metadata->>'defer_until' AS defer_until,
         d.metadata->>'action_id' AS action_id,
         d.metadata->>'linked_person_id' AS linked_person_id,
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
       AND COALESCE((e.metadata #>> '{intake,requires_human_review}')::boolean,true)=true
       AND (
         e.privacy_class='standard'
         OR (e.privacy_class='sensitive' AND (e.actor_id=$2 OR $3::text IN('owner','admin','leader')))
         OR (e.privacy_class='restricted' AND (e.actor_id=$2 OR $3::text IN('owner','admin')))
       )
       AND (
         $4::text='all'
         OR ($4::text='pending' AND (
           r.decision IS NULL
           OR (r.decision='deferred' AND r.defer_until IS NOT NULL AND r.defer_until::date<=$6::date)
         ))
         OR ($4::text='reviewed' AND r.decision IS NOT NULL)
       )
     ORDER BY e.occurred_at DESC,e.created_at DESC
     LIMIT $5`,
    [req.org.id, req.user.id, role, status, limit, today]
  );
  const reviewOperators = ['owner','admin','leader'].includes(role)
    ? (await pool.query(
        `SELECT id::text id,name,role FROM users
         WHERE organization_id=$1 AND active=true AND role=ANY($2::text[])
         ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'leader' THEN 2 ELSE 3 END,name,id`,
        [req.org.id, ['owner','admin','leader','worker','user']]
      )).rows
    : [];

  return res.status(200).json({ success: true, items: result.rows, review_operators: reviewOperators, today, time_zone: timeZone });
}


async function createIntake(req, res) {
  if (!isOrganizationOperator(req.user?.role)) {
    return res.status(403).json({ error: 'Organization operator access is required.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const category = clean(body.category, 60).toLowerCase();
  const personId = clean(body.person_id, 80) || null;
  const idempotencyKey = clean(body.idempotency_key || req.headers['idempotency-key'], 100);
  const consentStatus = clean(body.consent_status || 'unknown', 30).toLowerCase();
  const privacyClass = clean(body.privacy_class || 'sensitive', 30).toLowerCase();
  const contactPermission = clean(body.contact_permission || 'unknown', 30).toLowerCase();
  const channel = clean(body.channel || 'operator_note', 30).toLowerCase();
  const statement = clean(body.statement, 1800);
  const summary = clean(body.summary, 260);

  if (!CATEGORIES.has(category)) return res.status(400).json({ error: 'Choose a valid care signal category.' });
  if (personId && !UUID.test(personId)) return res.status(400).json({ error: 'The selected person is invalid.' });
  if (!UUID.test(idempotencyKey)) return res.status(400).json({ error: 'A UUID idempotency_key is required so retries cannot create duplicate care signals.' });
  if (!CONSENT.has(consentStatus)) return res.status(400).json({ error: 'Choose a valid consent status.' });
  if (!PRIVACY.has(privacyClass)) return res.status(400).json({ error: 'Choose a valid confidentiality level.' });
  if (!CONTACT.has(contactPermission)) return res.status(400).json({ error: 'Choose a valid contact preference.' });
  if (!CHANNELS.has(channel)) return res.status(400).json({ error: 'Choose a valid intake channel.' });
  if (personId && consentStatus === 'not_required') {
    return res.status(400).json({ error: 'Identified-person care records cannot be marked as consent-not-required.' });
  }
  if (category === 'context_note' && personId && consentStatus !== 'granted') {
    return res.status(409).json({ error: 'Explicit consent is required before recording private person context.' });
  }
  if (contactPermission === 'do_not_contact' && !personId) {
    return res.status(400).json({ error: 'A person must be identified before a no-contact preference can be enforced.' });
  }
  if (contactPermission === 'allowed' && ['declined','withdrawn'].includes(consentStatus)) {
    return res.status(409).json({ error: 'Contact cannot be marked allowed after consent was declined or withdrawn.' });
  }
  if (consentStatus === 'granted' && !statement && !summary && contactPermission !== 'do_not_contact') {
    return res.status(400).json({ error: 'Add the care details before saving this report.' });
  }

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    result = await recordCareIntake({
      client,
      organizationId: req.org.id,
      personId,
      actorId: req.user.id,
      actorRole: req.user.role,
      source: 'care_intake',
      category,
      statement,
      summary,
      channel,
      privacyClass,
      consentConfirmed: consentStatus === 'granted',
      consentStatus,
      contactPermission,
      idempotencyKey
    });
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

  return res.status(result.duplicate ? 200 : 201).json({
    success: true,
    duplicate: result.duplicate,
    intake_event_id: result.event.id,
    privacy_class: result.privacyClass,
    consent_status: result.event.consent_status,
    contact_restriction_saved: result.contactRestrictionSaved,
    review_required: result.reviewRequired,
    care_responsibility_created: false
  });
}

export default withOrg(async function handler(req, res) {
  if (req.method === 'GET') return listIntake(req, res);
  if (req.method === 'POST') return createIntake(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed.' });
});
