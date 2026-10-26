// Organization-local event dates for attendance records.
// Timestamps are stored as instants; attendance_date represents the event's local calendar day.
const DEFAULT_TIME_ZONE = 'Africa/Lagos';

export function normalizeOrganizationTimeZone(value) {
  const candidate = typeof value === 'string' && value.trim()
    ? value.trim()
    : DEFAULT_TIME_ZONE;

  try {
    // Validate the configured IANA time zone before using it for date calculations.
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function eventAttendanceDate(startedAt, timeZone = DEFAULT_TIME_ZONE) {
  const parsed = startedAt == null || startedAt === '' ? new Date() : new Date(startedAt);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const zone = normalizeOrganizationTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}
