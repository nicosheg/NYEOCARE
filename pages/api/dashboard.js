import pool from '../../lib/db';
import { withOrg } from '../../lib/apiHelpers';

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const orgId = req.org.id;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const attendanceRes = await pool.query(
      `SELECT ar.present
       FROM attendance_records ar
       JOIN people p
         ON p.id = ar.people_id
        AND p.organization_id = ar.organization_id
       WHERE ar.organization_id = $1
         AND p.organization_id = $1
         AND ar.attendance_date = $2`,
      [orgId, today]
    );

    const todaysCommunity = attendanceRes.rows.filter(r => r.present).length;
    const needCare = attendanceRes.rows.filter(r => !r.present).length;
    const ambientInsight = needCare > 0
      ? `${needCare} people missed today – most are first-time absences.`
      : null;

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).json({ todaysCommunity, needCare, ambientInsight });
  } catch (error) {
    console.error('[DASHBOARD] Unable to load tenant dashboard:', {
      request_id: req.nyeoRequestId || null,
      organization_id: orgId,
      message: error?.message || String(error),
    });
    return res.status(500).json({ error: 'Unable to load dashboard.' });
  }
}

export default withOrg(handler);
