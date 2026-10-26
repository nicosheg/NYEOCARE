// Canonical identity for one item of organizational care work.
// Keep this in lockstep with public.nyeocare_canonical_aria_work_key() in the SQL migration.
const clean = value => String(value ?? '').trim();
const activeAttendanceKinds = new Set([
  'care_first_check_in',
  'attendance_absence_check_in',
  'first_session_check_in',
  'returned_after_absence'
]);

export function canonicalAriaActionKey({
  organizationId,
  personId = null,
  actionMetadata = {},
  actionKey = null,
  observationType = null
} = {}) {
  const meta = actionMetadata && typeof actionMetadata === 'object' ? actionMetadata : {};
  const person = clean(personId);
  const session = clean(meta.session_id || meta.care_session_id || meta.attendance_session_id);
  const kind = clean(meta.kind);
  const contextId = clean(meta.context_id);
  const sourceEventId = clean(meta.source_event_id);

  if (meta.first_visit_required === true && person && session) {
    return 'attendance:first_visit:' + session + ':' + person;
  }

  // All non-mandatory attendance follow-up signals for one person/session are
  // one human disposition. Confirmed attendance must not leave a second copy.
  if ((activeAttendanceKinds.has(kind) || clean(observationType).toUpperCase() === 'UNUSUAL_ABSENCE') && person && session) {
    return 'attendance:care:' + session + ':' + person;
  }

  if (kind === 'expected_return_due' && contextId) {
    return 'attendance:expected_return:' + contextId;
  }

  if (sourceEventId && kind) {
    return 'event:' + sourceEventId + ':' + kind;
  }

  if (clean(actionKey)) return 'action-key:' + clean(actionKey);
  return 'action:' + clean(organizationId) + ':' + (person || 'organization') + ':' + (kind || clean(observationType) || 'unknown');
}

export function canonicalQueueWorkKey(item = {}) {
  if (item.canonical_work_key) return clean(item.canonical_work_key);
  const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  if (item.action_id || item.action_type) {
    return canonicalAriaActionKey({
      organizationId: item.organization_id,
      personId: item.person_id,
      actionMetadata: meta,
      actionKey: item.action_key || item.action_id
    });
  }
  if (item.observation_id || item.observation_type) {
    return canonicalAriaActionKey({
      organizationId: item.organization_id,
      personId: item.person_id,
      actionMetadata: meta,
      actionKey: item.source_id,
      observationType: item.observation_type
    });
  }
  return (clean(item.task_kind) || 'task') + ':' + (clean(item.source_id) || 'unknown');
}
