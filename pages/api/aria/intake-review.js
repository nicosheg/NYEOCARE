// pages/api/aria/intake-review.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';
import { planActionFromObservation } from '../../../lib/aria/recommendationEngine';
import { getDailyQueue } from '../../../lib/dailyQueue';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATORS = ['owner', 'admin', 'leader', 'worker', 'user'];
const clean = (value, max = 600) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function todayInZone(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const role = String(req.user?.role || '').toLowerCase();
  if (!['owner', 'admin', 'leader'].includes(role)) {
    return res.status(403).json({ error: 'Care intake review is limited to authorized leaders.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const intakeEventId = clean(body.intake_event_id, 80);
  const idempotencyKey = clean(body.idempotency_key, 100);
  const decision = clean(body.decision, 30).toLowerCase();
  const reason = clean(body.reason, 600);
  const deferUntil = clean(body.defer_until, 10);
  const title = clean(body.title, 100);
  const description = clean(body.description, 600);
  const assignedUserId = clean(body.assigned_user_id, 80);
  const dueDate = clean(body.due_date, 10);
  const priority = ['low', 'medium', 'high'].includes(String(body.priority || '').toLowerCase())
    ? String(body.priority).toLowerCase()
    : 'medium';

  if (!UUID.test(intakeEventId)) return res.status(400).json({ error: 'A valid intake_event_id is required.' });
  if (!UUID.test(idempotencyKey)) return res.status(400).json({ error: 'A UUID idempotency_key is required.' });
  if (!['approved', 'dismissed', 'deferred'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be approved, dismissed or deferred.' });
  }
  if (decision === 'approved' && (!UUID.test(assignedUserId) || !title || !datePattern.test(dueDate))) {
    return res.status(400).json({ error: 'Approval requires a person, accountable operator, task title and due date.' });
  }
  if (decision === 'deferred' && !datePattern.test(deferUntil)) {
    return res.status(400).json({ error: 'Deferral requires a valid defer_until date.' });
  }

  const organizationId = req.org.id;
  const client = await pool.connect();
  let action = null;
  let intake = null;
  let reviewEvent = null;

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ['nyeocare:care-intake-review:' + organizationId + ':' + intakeEventId]
    );

    intake = (await client.query(
      `SELECT * FROM aria_events
       WHERE id=$1::uuid AND organization_id=$2 AND type='CARE_INTAKE_RECORDED'
       LIMIT 1 FOR SHARE`,
      [intakeEventId, organizationId]
    )).rows[0];

    if (!intake) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Care intake record not found.' });
    }
    if (intake.privacy_class === 'restricted' && !['owner', 'admin'].includes(role)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This care signal is restricted to owners and administrators.' });
    }
    if (intake.privacy_class === 'sensitive' && !['owner', 'admin', 'leader'].includes(role)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This care signal is restricted to care leadership.' });
    }

    const duplicateKey = 'care-intake-review:' + intakeEventId + ':' + idempotencyKey;
    const duplicate = await client.query(
      'SELECT id,metadata FROM aria_events WHERE organization_id=$1 AND event_key=$2 LIMIT 1',
      [organizationId, duplicateKey]
    );
    if (duplicate.rows.length) {
      await client.query('COMMIT');
      return res.status(200).json({
        success: true,
        duplicate: true,
        review_event_id: duplicate.rows[0].id,
        action_id: duplicate.rows[0].metadata?.action_id || null
      });
    }

    const prior = await client.query(
      `SELECT metadata,occurred_at
       FROM aria_events
       WHERE organization_id=$1 AND type='CARE_INTAKE_REVIEWED'
         AND metadata->>'intake_event_id'=$2
       ORDER BY occurred_at DESC,created_at DESC
       LIMIT 1`,
      [organizationId, intakeEventId]
    );
    if (prior.rows.length) {
      const previous = prior.rows[0];
      const previousDecision = previous.metadata?.decision;
      const previousDeferUntil = previous.metadata?.defer_until;
      if (previousDecision !== 'deferred' || (previousDeferUntil && previousDeferUntil >= new Date().toISOString().slice(0, 10))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This care signal already has a recorded decision.' });
      }
    }

    let deferUntilStored = null;
    let actionId = null;

    if (decision === 'deferred') {
      const organization = (await client.query(
        "SELECT COALESCE(settings->>'timezone','Africa/Lagos') AS time_zone FROM organizations WHERE id=$1 LIMIT 1",
        [organizationId]
      )).rows[0];
      const today = todayInZone(organization?.time_zone || 'Africa/Lagos');
      const timestamp = Date.parse(deferUntil + 'T12:00:00Z');
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== deferUntil || deferUntil <= today) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Choose a deferral date after today.' });
      }
      deferUntilStored = deferUntil;
    }

    if (decision === 'approved') {
      if (!intake.person_id) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This signal has no confirmed person link. Resolve the person identity before creating a responsibility.' });
      }

      const organization = (await client.query(
        "SELECT COALESCE(settings->>'timezone','Africa/Lagos') AS time_zone FROM organizations WHERE id=$1 LIMIT 1",
        [organizationId]
      )).rows[0];
      const timeZone = organization?.time_zone || 'Africa/Lagos';
      const today = todayInZone(timeZone);
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

      const person = (await client.query(
        `SELECT id FROM people
         WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active'
         LIMIT 1 FOR SHARE`,
        [intake.person_id, organizationId]
      )).rows[0];
      if (!person) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'The linked person is no longer active.' });
      }

      const assignee = (await client.query(
        `SELECT id FROM users
         WHERE id=$1::uuid AND organization_id=$2 AND active=true AND role=ANY($3::text[])
         LIMIT 1`,
        [assignedUserId, organizationId, OPERATORS]
      )).rows[0];
      if (!assignee) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Choose an active operator in this organization.' });
      }

      const doNotContact = await client.query(
        `SELECT 1 FROM aria_care_contexts
         WHERE organization_id=$1 AND person_id=$2 AND kind='other'
           AND metadata->>'do_not_contact'='true'
           AND (ends_on IS NULL OR ends_on>=CURRENT_DATE)
         LIMIT 1`,
        [organizationId, intake.person_id]
      );
      if (doNotContact.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This person has a do-not-contact restriction. Do not create an outreach responsibility.' });
      }

      action = await planActionFromObservation({
        organizationId,
        personId: intake.person_id,
        actionType: 'CARE_FOLLOW_UP',
        priority,
        actionKey: 'care-intake:' + intakeEventId,
        actionMetadata: {
          kind: 'manual_care_responsibility',
          title,
          summary: description || null,
          message: description || null,
          reason: reason || 'A human reviewed a care signal and approved a next step.',
          suggestion: 'Complete the agreed next step and record what actually happened.',
          assigned_user_id: assignee.id,
          due_date: dueDate,
          responsibility_created_by: req.user.id,
          responsibility_created_by_role: role,
          source: 'care_intake_review',
          source_intake_event_id: intakeEventId,
          requires_human_approval: true
        }
      }, client);

      if (!action) {
        action = (await client.query(
          'SELECT * FROM aria_actions WHERE organization_id=$1 AND action_key=$2 LIMIT 1 FOR UPDATE',
          [organizationId, 'care-intake:' + intakeEventId]
        )).rows[0] || null;
      }
      if (!action) throw Object.assign(new Error('The approved care responsibility could not be created.'), { status: 409 });

      const approved = await client.query(
        `UPDATE aria_actions
         SET status='approved',approved_by=$3,approved_at=COALESCE(approved_at,NOW()),
             updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 AND status IN('proposed','approved')
         RETURNING *`,
        [action.id, organizationId, req.user.id]
      );
      action = approved.rows[0] || action;
      actionId = action.id;
    }

    reviewEvent = await emitAriaEvent({
      organizationId,
      personId: intake.person_id,
      type: 'CARE_INTAKE_REVIEWED',
      source: 'care_intake_review',
      actorId: req.user.id,
      actorRole: role,
      evidenceKind: 'human_report',
      verificationStatus: 'verified',
      confidence: 1,
      privacyClass: intake.privacy_class || 'sensitive',
      consentStatus: intake.consent_status || 'unknown',
      eventKey: duplicateKey,
      metadata: {
        intake_event_id: intakeEventId,
        decision,
        reason: reason || null,
        defer_until: deferUntilStored,
        action_id: actionId,
        assigned_user_id: action ? assignedUserId : null,
        due_date: action ? dueDate : null
      }
    }, client);
    if (!reviewEvent) throw new Error('The review decision could not be recorded.');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CARE INTAKE] review failed:', error?.message || error);
    return res.status(error?.status || 500).json({
      error: error?.status ? error.message : 'The care review decision could not be saved.'
    });
  } finally {
    client.release();
  }

  if (action) {
    try {
      await getDailyQueue(organizationId, req.user.id);
      const queueRow = (await pool.query(
        "SELECT id::text queue_item_id,assigned_user_id::text assigned_user_id,queue_date::text due_date FROM aria_daily_queue_items WHERE organization_id=$1 AND task_kind='follow_up' AND source_id=$2 LIMIT 1",
        [organizationId, String(action.id)]
      )).rows[0] || null;
      return res.status(201).json({
        success: true,
        decision,
        review_event_id: reviewEvent.id,
        action_id: String(action.id),
        queue_item_id: queueRow?.queue_item_id || null,
        queue_materialization_pending: !queueRow
      });
    } catch (error) {
      console.error('[CARE INTAKE] approved responsibility queue materialization failed:', error?.message || error);
      return res.status(202).json({
        success: true,
        decision,
        review_event_id: reviewEvent.id,
        action_id: String(action.id),
        queue_item_id: null,
        queue_materialization_pending: true
      });
    }
  }

  return res.status(201).json({
    success: true,
    decision,
    review_event_id: reviewEvent.id,
    action_id: null
  });
}

export default withOrg(handler);
