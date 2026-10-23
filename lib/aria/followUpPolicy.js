// lib/aria/followUpPolicy.js
// Organization-configurable follow-up guardrails. Contact is never sent automatically.
export const DEFAULT_FOLLOW_UP_POLICY = Object.freeze({
  firstVisitFollowUpRequired: true,
  attendancePatternFollowUpEnabled: true,
  firstVisitDueHours: 24,
  routineCooldownDays: 7,
  noResponseCooldownDays: 14,
  maxRoutineContactsPer30Days: 2,
  workerDailyCapacity: 5
});

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};

export function normalizeFollowUpPolicy(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    firstVisitFollowUpRequired: input.firstVisitFollowUpRequired !== false,
    attendancePatternFollowUpEnabled: input.attendancePatternFollowUpEnabled !== false,
    firstVisitDueHours: clampInt(input.firstVisitDueHours, DEFAULT_FOLLOW_UP_POLICY.firstVisitDueHours, 6, 72),
    routineCooldownDays: clampInt(input.routineCooldownDays, DEFAULT_FOLLOW_UP_POLICY.routineCooldownDays, 3, 30),
    noResponseCooldownDays: clampInt(input.noResponseCooldownDays, DEFAULT_FOLLOW_UP_POLICY.noResponseCooldownDays, 7, 60),
    maxRoutineContactsPer30Days: clampInt(input.maxRoutineContactsPer30Days, DEFAULT_FOLLOW_UP_POLICY.maxRoutineContactsPer30Days, 1, 8),
    workerDailyCapacity: clampInt(input.workerDailyCapacity, DEFAULT_FOLLOW_UP_POLICY.workerDailyCapacity, 1, 15)
  };
}

function timestamp(value) {
  if (!value) return null;
  const n = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(n) ? n : null;
}

export function isRoutineFollowUpEligible({
  contactCount30d = 0,
  lastOutboundAt = null,
  lastFeedbackAt = null,
  lastFeedbackType = null,
  doNotContact = false,
  policy = DEFAULT_FOLLOW_UP_POLICY,
  now = Date.now()
} = {}) {
  const p = normalizeFollowUpPolicy(policy);
  if (doNotContact) return { allowed: false, reason: 'do_not_contact' };

  const nowAt = timestamp(now) ?? Date.now();
  const feedbackAt = timestamp(lastFeedbackAt);
  const outboundAt = timestamp(lastOutboundAt);
  const latestHumanContact = Math.max(feedbackAt ?? -Infinity, outboundAt ?? -Infinity);
  const dayMs = 86400000;
  const ageDays = Number.isFinite(latestHumanContact) ? Math.max(0, (nowAt - latestHumanContact) / dayMs) : Infinity;

  if (String(lastFeedbackType || '').toLowerCase() === 'no_response' && feedbackAt !== null &&
      nowAt - feedbackAt < p.noResponseCooldownDays * dayMs) {
    return { allowed: false, reason: 'no_response_cooldown', eligibleAt: new Date(feedbackAt + p.noResponseCooldownDays * dayMs).toISOString() };
  }
  if (Number(contactCount30d) >= p.maxRoutineContactsPer30Days) {
    return { allowed: false, reason: 'monthly_contact_limit' };
  }
  if (ageDays < p.routineCooldownDays) {
    return { allowed: false, reason: 'routine_cooldown', eligibleAt: new Date(latestHumanContact + p.routineCooldownDays * dayMs).toISOString() };
  }
  return { allowed: true, reason: 'eligible' };
}
