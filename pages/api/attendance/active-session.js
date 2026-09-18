// pages/api/attendance/active-session.js

import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';

export default withOrg(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  const orgId = req.org.id;
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `
      SELECT
        s.id,
        s.name,
        s.status,
        s.started_by,
        s.started_at,

        EXISTS (
          SELECT 1
          FROM session_users su
          WHERE su.session_id = s.id
            AND su.user_id = $2
        ) AS joined,

        (
          SELECT COUNT(*)
          FROM session_users su2
          WHERE su2.session_id = s.id
        ) AS participant_count

      FROM sessions s

      WHERE s.organization_id = $1
        AND s.status = 'active'

      ORDER BY s.started_at DESC
      LIMIT 1
      `,
      [orgId, userId]
    );

    if (!result.rows.length) {
      return res.status(200).json({
        active: false,
      });
    }

    const row = result.rows[0];
    const canDiscard = ['owner','admin'].includes(req.user.role);

    return res.status(200).json({
      active: true,
      session_id: row.id,
      name: row.name,
      status: row.status,
      started_by: row.started_by,
      started_at: row.started_at,
      joined: row.joined,
      participant_count: Number(row.participant_count) || 0,
      can_discard: canDiscard,
    });

  } catch (err) {
    console.error(
      '[ATTENDANCE] Active session error:',
      err
    );

    return res.status(500).json({
      error: 'Could not load attendance.',
    });
  }
});
