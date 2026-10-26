// pages/api/sessions/assign.js
import pool from '../../../lib/db';
import { withAdmin } from '../../../lib/apiHelpers';
import { isOrganizationOperator } from '../../../lib/attendance/access';

export default withAdmin(async function handler(req, res) {
    const { session_id, user_id } = req.body;
    const orgId = req.org.id;

    if (!session_id || !user_id) {
        return res.status(400).json({ error: 'Missing session_id or user_id' });
    }

    // Verify session belongs to org
    const sessionCheck = await pool.query(
        `SELECT id FROM sessions WHERE id = $1 AND organization_id = $2`,
        [session_id, orgId]
    );
    if (sessionCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Session not found in your organization' });
    }

    // Verify user belongs to org
    const userCheck = await pool.query(
        `SELECT id,role,active FROM users WHERE id = $1 AND organization_id = $2 AND active=true`,
        [user_id, orgId]
    );
    if (userCheck.rows.length === 0) {
        return res.status(403).json({ error: 'User not found in your organization' });
    }

    if (!isOrganizationOperator(userCheck.rows[0].role)) {
        return res.status(400).json({ error: 'Only authorized organization operators can be assigned to attendance sessions.' });
    }

    if (req.method === 'POST') {
        try {
            await pool.query(
                `INSERT INTO session_users (session_id, user_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [session_id, user_id]
            );
            res.status(200).json({ success: true, action: 'assigned' });
        } catch (err) {
            console.error('Assign error:', err);
            res.status(500).json({ error: err.message });
        }
        return;
    }

    if (req.method === 'DELETE') {
        try {
            await pool.query(
                `DELETE FROM session_users WHERE session_id = $1 AND user_id = $2`,
                [session_id, user_id]
            );
            res.status(200).json({ success: true, action: 'unassigned' });
        } catch (err) {
            console.error('Unassign error:', err);
            res.status(500).json({ error: err.message });
        }
        return;
    }

    res.status(405).end();
});
