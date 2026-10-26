// pages/api/attendance/field-changes.js
// Incremental, organization-scoped attendance changes for other open devices.
// This is a polling fallback for Realtime; the server/database remains canonical.
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { isOrganizationOperator } from '../../../lib/attendance/access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OVERLAP_MS = 60000;

export default withOrg(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isOrganizationOperator(req.user?.role)) {
    return res.status(403).json({ error: 'Attendance access is limited to authorized organization operators.' });
  }

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const sessionId = String(req.query?.session_id || '').trim();
  const rawSince = String(req.query?.since || '').trim();

  if (!UUID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'A valid attendance session is required.' });
  }

  let since = null;
  let suppliedSinceTime = null;
  if (rawSince) {
    suppliedSinceTime = Date.parse(rawSince);
    if (!Number.isFinite(suppliedSinceTime)) {
      return res.status(400).json({ error: 'The attendance change cursor is invalid.' });
    }
    since = new Date(suppliedSinceTime - OVERLAP_MS).toISOString();
  }

  const orgId = req.org.id;
  const userId = req.user.id;
  try {
    const access = await pool.query(
      `SELECT s.id, s.started_at
       FROM sessions s
       JOIN session_users su ON su.session_id = s.id AND su.user_id = $3
       WHERE s.id = $1 AND s.organization_id = $2 AND s.status = 'active'
       LIMIT 1`,
      [sessionId, orgId, userId]
    );
    const session = access.rows[0];
    if (!session) {
      return res.status(409).json({ error: 'This attendance session is no longer active or you have not joined it.' });
    }

    // Read a database clock cursor first. Changes committed after this boundary
    // will be returned on the next poll. The overlap safely catches quick commits
    // from transactions that began before this poll but committed after its query.
    const cutoffResult = await pool.query('SELECT clock_timestamp() AS cursor');
    const cursor = cutoffResult.rows[0]?.cursor;
    if (!cursor) {
      return res.status(503).json({ error: 'Could not establish the attendance sync cursor.' });
    }
    // The cursor is server-issued. Avoid relying on each phone's system clock:
    // clamp a corrupted/future cursor against database time rather than rejecting
    // a legitimate client whose clock is slow.
    if (suppliedSinceTime !== null && suppliedSinceTime > new Date(cursor).getTime()) {
      since = new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString();
    }

    let people = [];
    let removedPeople = [];
    let attendance = [];
    if (since) {
      const created = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.display_name, p.phone, p.type, p.created_at, p.updated_at,
           CASE WHEN lower(BTRIM(COALESCE(p.type,''))) = 'visitor'
             AND NOT EXISTS (
               SELECT 1 FROM participation_records previous
               WHERE previous.organization_id = p.organization_id
                 AND previous.person_id = p.id
                 AND previous.participation_type = 'attendance'
                 AND previous.session_id IS DISTINCT FROM $2::uuid
                 AND previous.occurred_at < $4::timestamptz
             )
             AND NOT EXISTS (
               SELECT 1
               FROM attendance_records prior
               LEFT JOIN sessions prior_session
                 ON prior_session.id = prior.session_id
                AND prior_session.organization_id = prior.organization_id
               WHERE prior.organization_id = p.organization_id
                 AND prior.people_id = p.id
                 AND prior.present = true
                 AND prior.confirmed = true
                 AND prior.session_id IS DISTINCT FROM $2::uuid
                 AND COALESCE(prior_session.started_at, prior.attendance_date::timestamptz, prior.marked_at) < $4::timestamptz
             )
             THEN true ELSE false END AS first_visit_candidate,
           EXISTS (
             SELECT 1 FROM care_feedback wf
             WHERE wf.organization_id = p.organization_id
               AND wf.person_id = p.id
               AND wf.context->>'source' = 'first_visit_welcome_during_attendance'
               AND wf.context->>'session_id' = $2::text
               AND wf.context->>'outcome' = 'met_in_person'
               AND wf.verification_status = 'reported'
           ) AS first_visit_welcome_recorded
         FROM people p
         WHERE p.organization_id = $1
           AND COALESCE(p.status,'active') = 'active'
           AND p.updated_at >= $3::timestamptz
           AND p.updated_at <= $5::timestamptz
         ORDER BY p.updated_at, p.id`,
        [orgId, sessionId, since, session.started_at, cursor]
      );
      people = created.rows;

      // Carry deactivations/merges to other open phones as tombstones so stale
      // local rosters do not continue offering people the server will reject.
      const removed = await pool.query(
        `SELECT p.id, p.status, p.updated_at
         FROM people p
         WHERE p.organization_id = $1
           AND COALESCE(p.status,'active') <> 'active'
           AND p.updated_at >= $2::timestamptz
           AND p.updated_at <= $3::timestamptz
         ORDER BY p.updated_at, p.id`,
        [orgId, since, cursor]
      );
      removedPeople = removed.rows;

      const changedMarks = await pool.query(
        `SELECT ar.people_id, ar.present, ar.confirmed, ar.marked_at,
           COALESCE(
             NULLIF(u.name,''),
             NULLIF(CONCAT_WS(' ', au.raw_user_meta_data->>'first_name', au.raw_user_meta_data->>'last_name'),''),
             au.email
           ) AS marked_by_name
         FROM attendance_records ar
         LEFT JOIN users u ON u.id = ar.marked_by
         LEFT JOIN auth.users au ON au.id = u.supabase_user_id
         WHERE ar.organization_id = $1
           AND ar.session_id = $2
           AND ar.marked_at >= $3::timestamptz
           AND ar.marked_at <= $4::timestamptz
         ORDER BY ar.marked_at, ar.people_id`,
        [orgId, sessionId, since, cursor]
      );
      attendance = changedMarks.rows;
    }

    // The client already holds a verified complete roster and applies the returned
    // person/attendance deltas. Re-counting full tables on every poll adds load but
    // does not improve sync correctness.
    return res.status(200).json({
      success: true,
      session_id: sessionId,
      cursor: new Date(cursor).toISOString(),
      people,
      removed_people: removedPeople,
      attendance,
      total: null,
      present_count: null
    });
  } catch (error) {
    console.error('[ATTENDANCE] Field changes error:', error);
    return res.status(503).json({ error: 'Could not refresh shared attendance changes.' });
  }
});
