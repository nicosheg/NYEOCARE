// pages/api/attendance/create-session.js
// Creates one organization-scoped active session, its sections, and creator membership.
// IMPORTANT: session_sections is the canonical section table. Do NOT use attendance_groups.

import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';

export default withOrg(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, sections } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Event name is required.' });
  }

  // Normalize sections: unique, non-empty strings.
  const normalizedSections = Array.isArray(sections)
    ? [...new Set(sections.filter(s => typeof s === 'string').map(s => s.trim()).filter(Boolean))]
    : [];

  // Every session must have at least the default "All" section.
  if (!normalizedSections.length) normalizedSections.push('All');

  const orgId = req.org.id;
  const userId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Defense-in-depth: only one active session per organization.
    const existing = await client.query(
      `SELECT id,name,started_by,started_at
       FROM sessions
       WHERE organization_id = $1 AND status = 'active'
       ORDER BY started_at DESC
       LIMIT 1
       FOR UPDATE`,
      [orgId]
    );

    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'An attendance session is already active.',
        session: existing.rows[0],
      });
    }

    // Create the session.
    const created = await client.query(
      `INSERT INTO sessions (organization_id,name,status,started_by,started_at)
       VALUES ($1,$2,'active',$3,NOW())
       RETURNING id,name,status,started_by,started_at`,
      [orgId, name.trim(), userId]
    );

    const session = created.rows[0];

    // Creator automatically joins the session.
    await client.query(
      `INSERT INTO session_users (session_id,user_id)
       VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [session.id, userId]
    );

    // Create the requested sections.
    // organization_id is required and must match the session organization.
    for (const sectionName of normalizedSections) {
      await client.query(
        `INSERT INTO session_sections (session_id,name,organization_id)
         VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [session.id, sectionName, orgId]
      );
    }

    await client.query('COMMIT');

    // Return both shapes for frontend compatibility:
    // data.id and data.session.id are both valid.
    return res.status(201).json({
      success: true,
      id: session.id,
      session,
      sections: normalizedSections,
      joined: true,can_discard:['owner','admin'].includes(req.user.role),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}

    // If another request won the race to create an active session,
    // surface a clean conflict instead of a generic 500.
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'An attendance session is already active.',
      });
    }

    console.error('[ATTENDANCE] Create session error:', err);
    return res.status(500).json({
      error: 'Could not start attendance.',
    });
  } finally {
    client.release();
  }
});
