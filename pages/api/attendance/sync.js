// pages/api/attendance/sync.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { eventAttendanceDate } from '../../../lib/attendance/eventDate';
import { isOrganizationOperator } from '../../../lib/attendance/access';
import { enqueueAttendanceProcessing } from '../../../lib/aria/attendanceQueue';

const MAX_OPERATIONS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default withOrg(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isOrganizationOperator(req.user?.role)) {
    return res.status(403).json({ error: 'Only authorized organization operators can sync attendance.' });
  }

  const { session_id, operations } = req.body || {};
  if (!UUID_RE.test(String(session_id || ''))) {
    return res.status(400).json({ error: 'A valid attendance session is required.' });
  }
  if (!Array.isArray(operations) || !operations.length) {
    return res.status(400).json({ error: 'Attendance operations are required.' });
  }
  if (operations.length > MAX_OPERATIONS) {
    return res.status(413).json({ error: 'Too many attendance changes.' });
  }

  const deduped = new Map();
  for (const operation of operations) {
    if (!operation?.people_id) continue;
    if (!UUID_RE.test(String(operation.people_id))) {
      return res.status(400).json({ error: 'Each attendance change needs a valid person ID.' });
    }
    if (typeof operation.present !== 'boolean') {
      return res.status(400).json({ error: 'Attendance changes need boolean present values.' });
    }
    deduped.set(String(operation.people_id), {
      people_id: String(operation.people_id),
      present: operation.present
    });
  }
  if (!deduped.size) {
    return res.status(400).json({ error: 'No valid attendance changes supplied.' });
  }

  const orgId = req.org.id;
  const userId = req.user.id;
  const isAdmin = ['owner', 'admin'].includes(String(req.user.role || '').toLowerCase());
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const session = (await client.query(
      `SELECT s.id, s.started_at, s.status, s.closed_by,s.closed_at,s.auto_close_at,s.closure_reason,s.aria_processing_status,
              COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos') AS organization_timezone
       FROM sessions s
       JOIN organizations o ON o.id = s.organization_id
       WHERE s.id = $1 AND s.organization_id = $2
       LIMIT 1 FOR UPDATE OF s`,
      [session_id, orgId]
    )).rows[0];

    if (!session) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Attendance session not found.' });
    }
    if (session.status === 'closed') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Attendance has already been saved. An owner or admin must verify any later attendance correction through ARIA.',
        attendance_closed: true,
        requires_admin_verification: true,
        pending_people_ids: ids
      });
    }
    if (session.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This attendance session is no longer available.' });
    }

    const member = (await client.query(
      'SELECT 1 FROM session_users WHERE session_id = $1 AND user_id = $2 LIMIT 1',
      [session_id, userId]
    )).rows[0];
    if (!member) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Join this attendance session before syncing attendance.' });
    }

    const ids = [...deduped.keys()];
    const valid = (await client.query(
      `SELECT id FROM people
       WHERE organization_id = $1
         AND COALESCE(status,'active') = 'active'
         AND id = ANY($2::uuid[])`,
      [orgId, ids]
    )).rows.map(row => String(row.id));
    const validSet = new Set(valid);
    const ignored = ids.filter(id => !validSet.has(id));
    const ops = [...deduped.values()].filter(operation => validSet.has(operation.people_id));
    const payload = JSON.stringify(ops);
    const date = eventAttendanceDate(session.started_at, session.organization_timezone);
    const confirmed = session.status === 'closed' && isAdmin;
    let writes = [];

    if (ops.length) {
      const result = await client.query(
        `INSERT INTO attendance_records(
           people_id, attendance_date, present, session_id, marked_by, marked_at,
           status, confirmed, reviewed_by, reviewed_at, organization_id, source
         )
         SELECT
           o.people_id, $4::date, o.present, $2, $3, NOW(),
           CASE WHEN o.present THEN 'present' ELSE 'not_present' END,
           false, NULL, NULL, $1, 'operator'
         FROM jsonb_to_recordset($6::jsonb) AS o(people_id uuid, present boolean)
         ON CONFLICT (organization_id, people_id, session_id) WHERE session_id IS NOT NULL
         DO UPDATE SET
           present = EXCLUDED.present,
           marked_by = EXCLUDED.marked_by,
           marked_at = NOW(),
           status = EXCLUDED.status,
           source = 'operator'
         WHERE attendance_records.confirmed = false
           AND attendance_records.present IS DISTINCT FROM EXCLUDED.present
         RETURNING people_id, present, confirmed, source`,
        [orgId, session_id, userId, date, false, payload]
      );
      writes = result.rows;
    }

    // Only acknowledge local outbox items when the canonical server state matches
    // the requested value. Confirmed attendance is not silently overwritten.
    const actualRows = ops.length ? (await client.query(
      `SELECT people_id, present, confirmed, source
       FROM attendance_records
       WHERE organization_id = $1 AND session_id = $2
         AND people_id = ANY($3::uuid[])`,
      [orgId, session_id, ops.map(operation => operation.people_id)]
    )).rows : [];
    const actualById = new Map(actualRows.map(row => [String(row.people_id), row]));
    const applied = ops
      .filter(operation => actualById.get(operation.people_id)?.present === operation.present)
      .map(operation => operation.people_id);
    const appliedSet = new Set(applied);
    const conflicted = ops
      .filter(operation => !appliedSet.has(operation.people_id))
      .map(operation => operation.people_id);

    await client.query('COMMIT');
    return res.status(200).json({
      success: true,
      applied_people_ids: applied,
      ignored_people_ids: ignored,
      conflicted_people_ids: conflicted
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[ATTENDANCE] Offline sync error:', error);
    return res.status(503).json({ error: 'Attendance sync is temporarily unavailable.' });
  } finally {
    client.release();
  }
});
