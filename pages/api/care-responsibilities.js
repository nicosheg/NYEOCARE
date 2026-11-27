// pages/api/care-responsibilities.js
import crypto from 'node:crypto';
import pool from '../../lib/db';
import { withAdmin } from '../../lib/apiHelpers';
import { emitAriaEvent } from '../../lib/aria/eventEmitter';
import { createCareResponsibility } from '../../lib/aria/careResponsibility';
import { recordCareIntake } from '../../lib/aria/careIntakeService';
import { getDailyQueue } from '../../lib/dailyQueue';

const clean = (value, max = 600) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const categories = new Set(['first_visit', 'prayer_request', 'personal_need', 'practical_support', 'relationship_request', 'complaint', 'check_in', 'general']);
const restrictedCategories = new Set(['prayer_request', 'personal_need', 'complaint']);

function todayInZone(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

export default withAdmin(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const personId = clean(body.person_id, 80);
  const assigneeId = clean(body.assigned_user_id, 80);
  const title = clean(body.title, 100);
  const description = clean(body.description, 600);
  const dueDate = clean(body.due_date, 10);
  const priority = ['low', 'medium', 'high'].includes(String(body.priority || '').toLowerCase())
    ? String(body.priority).toLowerCase()
    : 'medium';
  const category = clean(body.category || 'general', 60).toLowerCase();
  const requestedPrivacy = clean(body.privacy_class || 'sensitive', 30).toLowerCase();
  const idempotencyKey = clean(body.idempotency_key || req.headers['idempotency-key'], 100);

  if (!uuidPattern.test(personId) || !uuidPattern.test(assigneeId) || !title || !datePattern.test(dueDate)) {
    return res.status(400).json({ error: 'Choose a person, task, active assignee and valid due date.' });
  }
  if (!categories.has(category)) return res.status(400).json({ error: 'Choose a valid care category.' });
  if (!['sensitive', 'restricted'].includes(requestedPrivacy)) {
    return res.status(400).json({ error: 'Care responsibilities must be confidential or restricted.' });
  }
  if (body.consent_confirmed !== true) {
    return res.status(409).json({ error: 'Confirm that the person agreed to have this care need recorded before assigning responsibility.' });
  }
  if (!uuidPattern.test(idempotencyKey)) {
    return res.status(400).json({ error: 'A UUID idempotency_key is required so a retry cannot create duplicate care work.' });
  }

  const privacyClass = restrictedCategories.has(category) || requestedPrivacy === 'restricted'
    ? 'restricted'
    : 'sensitive';
  const organizationId = req.org.id;
  const actorId = req.user.id;
  const actorRole = String(req.user.role || '').toLowerCase();
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    personId, assigneeId, title, description, dueDate, priority, category, privacyClass
  })).digest('hex');
  const eventKey = 'manual-care-intake:' + idempotencyKey;
  const actionKeyPrefix = 'care-intake:';

  const client = await pool.connect();
  let intakeEvent;
  let action;
  let reviewEvent;
  let duplicate = false;

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ['nyeocare:manual-care:' + organizationId + ':' + idempotencyKey]
    );

    const existing = (await client.query(
      "SELECT * FROM aria_events WHERE organization_id=$1 AND event_key=$2 AND type='CARE_INTAKE_RECORDED' LIMIT 1 FOR UPDATE",
      [organizationId, eventKey]
    )).rows[0] || null;

    if (existing) {
      if (existing.metadata?.request_fingerprint !== fingerprint) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This request key was already used for different care details. Reopen the form to start a new request.' });
      }
      intakeEvent = existing;
      duplicate = true;
    } else {
      const person = (await client.query(
        "SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1 FOR SHARE",
        [personId, organizationId]
      )).rows[0];
      if (!person) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Person not found or no longer active.' });
      }

      const organization = (await client.query(
        "SELECT COALESCE(settings->>'timezone','Africa/Lagos') AS time_zone FROM organizations WHERE id=$1 LIMIT 1",
        [organizationId]
      )).rows[0];
      const today = todayInZone(organization?.time_zone || 'Africa/Lagos');
      const dueMs = Date.parse(dueDate + 'T00:00:00Z');
      if (!Number.isFinite(dueMs) || new Date(dueMs).toISOString().slice(0, 10) !== dueDate || dueDate < today) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Choose a valid due date that is not in the past.' });
      }
      const latestDate = new Date(Date.parse(today + 'T12:00:00Z') + 30 * 86400000).toISOString().slice(0, 10);
      if (dueDate > latestDate) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Choose a due date within the next 30 days.' });
      }

      const assignee = (await client.query(
        "SELECT id,role FROM users WHERE id=$1::uuid AND organization_id=$2 AND active=true LIMIT 1",
        [assigneeId, organizationId]
      )).rows[0];
      if (!assignee) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Choose an active operator in this organization.' });
      }
      const allowedRoles = privacyClass === 'restricted' ? ['owner', 'admin'] : ['owner', 'admin', 'leader'];
      if (!allowedRoles.includes(String(assignee.role || '').toLowerCase())) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: privacyClass === 'restricted'
            ? 'Restricted care can only be assigned to an owner or administrator.'
            : 'Confidential care can only be assigned to an authorized care leader or administrator.'
        });
      }

      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        ['nyeocare:do-not-contact:' + organizationId + ':' + personId]
      );
      const doNotContact = await client.query(
        `SELECT 1 FROM aria_care_contexts
         WHERE organization_id=$1 AND person_id=$2 AND kind='other'
           AND metadata->>'do_not_contact'='true'
           AND (ends_on IS NULL OR ends_on>=CURRENT_DATE)
         LIMIT 1`,
        [organizationId, personId]
      );
      if (doNotContact.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This person has asked not to be contacted. Resolve the contact preference before creating a care responsibility.' });
      }

      const intakeResult = await recordCareIntake({
        client,
        organizationId,
        personId,
        actorId,
        actorRole,
        source: 'person_journey_care',
        category,
        statement: description || title,
        summary: description || title,
        channel: 'operator_note',
        privacyClass,
        consentConfirmed: true,
        consentStatus: 'granted',
        contactPermission: 'unknown',
        idempotencyKey,
        additionalIntakeMetadata: { requested_action_title: title }
      });
      intakeEvent = intakeResult.event;
      duplicate = intakeResult.duplicate;
    }

    const existingAction = (await client.query(
      'SELECT * FROM aria_actions WHERE organization_id=$1 AND action_key=$2 LIMIT 1 FOR UPDATE',
      [organizationId, actionKeyPrefix + intakeEvent.id]
    )).rows[0] || null;

    if (existingAction) {
      action = existingAction;
    } else {
      const person = (await client.query(
        "SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1 FOR SHARE",
        [personId, organizationId]
      )).rows[0];
      const assignee = (await client.query(
        "SELECT id,role FROM users WHERE id=$1::uuid AND organization_id=$2 AND active=true LIMIT 1",
        [assigneeId, organizationId]
      )).rows[0];
      if (!person || !assignee) throw Object.assign(new Error('The person or assigned operator is no longer active.'), { status: 409 });

      action = await createCareResponsibility({
        client,
        organizationId,
        personId,
        intakeEvent,
        assigneeId: assignee.id,
        dueDate,
        priority,
        title,
        summary: description,
        createdBy: actorId,
        createdByRole: actorRole,
        source: 'person_journey_care',
        contactPermission: 'unknown'
      });
    }

    const reviewKey = 'manual-care-review:' + idempotencyKey;
    reviewEvent = (await client.query(
      "SELECT * FROM aria_events WHERE organization_id=$1 AND event_key=$2 AND type='CARE_INTAKE_REVIEWED' LIMIT 1 FOR UPDATE",
      [organizationId, reviewKey]
    )).rows[0] || null;
    if (!reviewEvent) {
      reviewEvent = await emitAriaEvent({
        organizationId,
        personId,
        type: 'CARE_INTAKE_REVIEWED',
        actorId,
        actorRole,
        source: 'person_journey_care_review',
        evidenceKind: 'human_report',
        verificationStatus: 'verified',
        confidence: 1,
        privacyClass,
        consentStatus: 'granted',
        eventKey: reviewKey,
        metadata: {
          intake_event_id: intakeEvent.id,
          linked_person_id: personId,
          decision: 'approved',
          reason: 'A leader explicitly assigned a care responsibility from Person Journey.',
          action_id: action.id,
          assigned_user_id: assigneeId,
          due_date: dueDate,
          contact_permission: 'unknown'
        }
      }, client);
    }
    if (!reviewEvent) throw new Error('The explicit care approval could not be recorded.');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CARE RESPONSIBILITY] save failed:', error?.message || error);
    return res.status(error?.status || 500).json({
      error: error?.status ? error.message : 'Could not assign this care responsibility.'
    });
  } finally {
    client.release();
  }

  try {
    await getDailyQueue(organizationId, actorId);
    const queueRow = (await pool.query(
      "SELECT id::text queue_item_id FROM aria_daily_queue_items WHERE organization_id=$1 AND task_kind='follow_up' AND source_id=$2 LIMIT 1",
      [organizationId, String(action.id)]
    )).rows[0] || null;
    return res.status(duplicate ? 200 : 201).json({
      success: true,
      duplicate,
      intake_event_id: intakeEvent.id,
      review_event_id: reviewEvent.id,
      action_id: String(action.id),
      queue_item_id: queueRow?.queue_item_id || null,
      queue_materialization_pending: !queueRow
    });
  } catch (error) {
    console.error('[CARE RESPONSIBILITY] queue materialization failed:', error?.message || error);
    return res.status(202).json({
      success: true,
      duplicate,
      intake_event_id: intakeEvent.id,
      review_event_id: reviewEvent.id,
      action_id: String(action.id),
      queue_item_id: null,
      queue_materialization_pending: true
    });
  }
});
