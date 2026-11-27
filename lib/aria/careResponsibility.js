// lib/aria/careResponsibility.js
import { planActionFromObservation } from './recommendationEngine';

const clean = (value, max = 600) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);

export async function createCareResponsibility({
  client,
  organizationId,
  personId,
  intakeEvent,
  assigneeId,
  dueDate,
  priority = 'medium',
  title,
  summary = '',
  createdBy,
  createdByRole,
  source = 'care_intake_review',
  contactPermission = 'unknown'
}) {
  if (!client || !organizationId || !personId || !intakeEvent?.id || !assigneeId || !createdBy) {
    throw new Error('A transaction, organization, person, intake event, assignee and creator are required.');
  }

  const privacyClass = ['standard', 'sensitive', 'restricted'].includes(intakeEvent.privacy_class)
    ? intakeEvent.privacy_class
    : 'sensitive';
  const consentStatus = String(intakeEvent.consent_status || 'unknown').toLowerCase();
  if (consentStatus !== 'granted') {
    throw Object.assign(new Error('Explicit consent is required before creating an identifiable care responsibility.'), { status: 409 });
  }

  const sourceIntake = intakeEvent.metadata?.intake || {};
  const sourceTitle = clean(title || sourceIntake.requested_action_title || 'Care follow-up', 100);
  const sourceSummary = clean(summary || sourceIntake.statement || sourceIntake.summary || '', 600);
  const actionKey = 'care-intake:' + intakeEvent.id;
  const isPrivate = privacyClass !== 'standard';

  let action = await planActionFromObservation({
    organizationId,
    personId,
    actionType: 'CARE_FOLLOW_UP',
    priority: ['low', 'medium', 'high', 'critical'].includes(priority) ? priority : 'medium',
    actionKey,
    actionMetadata: {
      kind: 'manual_care_responsibility',
      title: isPrivate
        ? (privacyClass === 'restricted' ? 'Review restricted care signal' : 'Review confidential care signal')
        : sourceTitle,
      summary: isPrivate ? null : (sourceSummary || null),
      message: isPrivate ? null : (sourceSummary || null),
      reason: isPrivate
        ? 'An authorized leader approved a private care signal. Open the permission-scoped person record for details.'
        : 'A human reviewed a care signal and approved a next step.',
      knowledge: 'This responsibility was explicitly approved by a human, not inferred from attendance.',
      suggestion: isPrivate
        ? 'Review the private care record using your authorized access, then complete the agreed next step without copying sensitive details into general notes.'
        : 'Complete the agreed next step and record what actually happened.',
      privacy_class: privacyClass,
      privacy_reporter_id: intakeEvent.actor_id || null,
      privacy_required_role: privacyClass === 'restricted' ? 'admin' : (privacyClass === 'sensitive' ? 'leader' : 'operator'),
      consent_status: consentStatus,
      contact_permission: contactPermission,
      assigned_user_id: assigneeId,
      due_date: dueDate,
      responsibility_created_by: createdBy,
      responsibility_created_by_role: createdByRole,
      source,
      source_intake_event_id: intakeEvent.id,
      requires_human_approval: true
    }
  }, client);

  if (!action) {
    action = (await client.query(
      'SELECT * FROM aria_actions WHERE organization_id=$1 AND action_key=$2 LIMIT 1 FOR UPDATE',
      [organizationId, actionKey]
    )).rows[0] || null;
  }
  if (!action) throw new Error('The approved care responsibility could not be created.');

  const approved = await client.query(
    `UPDATE aria_actions
     SET status='approved',approved_by=$3,approved_at=COALESCE(approved_at,NOW()),updated_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND status IN('proposed','approved')
     RETURNING *`,
    [action.id, organizationId, createdBy]
  );

  return approved.rows[0] || action;
}
