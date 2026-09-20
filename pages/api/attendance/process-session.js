// pages/api/attendance/process-session.js
import pool from '../../../lib/db';
import { withAdmin } from '../../../lib/apiHelpers';
import { generateParticipationFromSession } from '../../../lib/aria/participationGenerator';
import { directAriaEvent } from '../../../lib/aria/director';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';

const failMsg = 'ARIA could not finish processing this attendance yet. The saved session and attendance are preserved, and you can retry safely.';

export default withAdmin(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { session_id } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id is required.' });

  const orgId = req.org.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [orgId]);

    const s = await client.query(
      "SELECT id,status,aria_processing_status,aria_processing_started_at FROM sessions " +
      "WHERE id=$1 AND organization_id=$2 LIMIT 1",
      [session_id, orgId]
    );

    if (!s.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Attendance session not found.' });
    }

    if (s.rows[0].status !== 'closed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Save the attendance session before processing ARIA.' });
    }

    if (s.rows[0].aria_processing_status === 'completed') {
      await client.query('COMMIT');
      return res.status(200).json({ success: true, aria: { session_id, already_processed: true } });
    }

    const stale =
      s.rows[0].aria_processing_status === 'processing' &&
      s.rows[0].aria_processing_started_at &&
      new Date(s.rows[0].aria_processing_started_at).getTime() < Date.now() - 120000;

    const claimed = await client.query(
      "UPDATE sessions SET aria_processing_status='processing'," +
      "aria_processing_attempts=aria_processing_attempts+1,aria_processing_started_at=NOW()," +
      "aria_processing_error=NULL,aria_processing_completed_at=NULL " +
      "WHERE id=$1 AND organization_id=$2 AND (" +
      "aria_processing_status IN ('pending','failed') OR (" +
      "aria_processing_status='processing' AND aria_processing_started_at IS NOT NULL " +
      "AND aria_processing_started_at<NOW()-INTERVAL '2 minutes')) " +
      "RETURNING id,aria_processing_attempts",
      [session_id, orgId]
    );

    if (!claimed.rows.length) {
      await client.query('ROLLBACK');
      if (s.rows[0].aria_processing_status === 'processing' && !stale) {
        return res.status(409).json({ error: 'ARIA is still processing this attendance. Please wait a moment.' });
      }
      return res.status(409).json({ error: 'ARIA is already processing this attendance.' });
    }

    await client.query('COMMIT');

    try {
      const aria = await generateParticipationFromSession(session_id, orgId);

      await pool.query(
        "UPDATE sessions SET aria_processing_status='completed',aria_processing_error=NULL,aria_processing_completed_at=NOW() " +
        "WHERE id=$1 AND organization_id=$2",
        [session_id, orgId]
      );

      return res.status(200).json({ success: true, processing_failed: false, aria });
    } catch (e) {
      const internal = String(e.message || 'Processing failed').slice(0, 2000);
      console.error('[ATTENDANCE] Retry ARIA processing:', e);

      await pool.query(
        "UPDATE sessions SET aria_processing_status='failed',aria_processing_error=$1 " +
        "WHERE id=$2 AND organization_id=$3",
        [internal, session_id, orgId]
      );

      const event = await emitAriaEvent({
        organizationId: orgId,
        type: 'ATTENDANCE_PROCESSING_FAILED',
        source: 'attendance',
        actorId: req.user.id,
        metadata: { session_id, error: internal },
        eventKey: 'attendance:' + session_id + ':aria_failed:retry'
      });
      if (event) await directAriaEvent(event);

      return res.status(200).json({
        success: true,
        processing_failed: true,
        error: failMsg,
        aria: { session_id, processing_status: 'failed' }
      });
    }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[ATTENDANCE] Process session error:', e);
    return res.status(500).json({ error: 'Unable to process this attendance session.' });
  } finally {
    client.release();
  }
});
