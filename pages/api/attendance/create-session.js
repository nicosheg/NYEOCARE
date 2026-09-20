// pages/api/attendance/create-session.js
// Creates one organization-scoped active session only when all previous sessions are fully processed.
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

  const normalizedSections = Array.isArray(sections)
    ? [...new Set(sections.filter(s => typeof s === 'string').map(s => s.trim()).filter(Boolean))]
    : [];

  if (!normalizedSections.length) normalizedSections.push('All');

  const orgId = req.org.id;
  const userId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Serialize the attendance lifecycle per organization.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1::text))",
      [orgId]
    );

    // A new session is forbidden while another is active OR any older closed session
    // still has ARIA work pending/processing/failed. "completed" is the only unlock state.
    const existing = await client.query(
      `SELECT
         s.id,s.name,s.status,s.started_by,s.started_at,s.closed_at,
         s.aria_processing_status,s.aria_processing_attempts,
         s.aria_processing_started_at,s.aria_processing_completed_at,s.aria_processing_error,
         (SELECT COUNT(*)
          FROM sessions b
          WHERE b.organization_id=$1
            AND b.status='closed'
            AND COALESCE(b.aria_processing_status,'pending')<>'completed') AS blocking_count
       FROM sessions s
       WHERE s.organization_id=$1
         AND (
           s.status='active'
           OR (
             s.status='closed'
             AND COALESCE(s.aria_processing_status,'pending')<>'completed'
           )
         )
       ORDER BY
         CASE WHEN s.status='active' THEN 0 ELSE 1 END,
         CASE WHEN COALESCE(s.aria_processing_status,'pending')='failed' THEN 0 ELSE 1 END,
         s.started_at DESC
       LIMIT 1
       FOR UPDATE`,
      [orgId]
    );

    if (existing.rows.length) {
      const blocked = existing.rows[0];
      const isActive = blocked.status === 'active';
      const processingStatus = blocked.aria_processing_status || (isActive ? null : 'pending');

      await client.query('ROLLBACK');

      return res.status(409).json({
        success: false,
        blocked: true,
        can_discard: ['owner','admin'].includes(req.user.role),
        reason: isActive ? 'active' : processingStatus === 'failed' ? 'aria_failed' : 'aria_processing',
        error: isActive
          ? 'An attendance session is already active.'
          : processingStatus === 'failed'
            ? 'ARIA must finish the previous attendance before a new session can start.'
            : 'ARIA is still processing the previous attendance. A new session will unlock when it is finished.',
        session: blocked,
        blocking_count: Number(blocked.blocking_count) || 1,
      });
    }

    const created = await client.query(
      `INSERT INTO sessions (organization_id,name,status,started_by,started_at)
       VALUES ($1,$2,'active',$3,NOW())
       RETURNING id,name,status,started_by,started_at`,
      [orgId, name.trim(), userId]
    );

    const session = created.rows[0];

    await client.query(
      `INSERT INTO session_users (session_id,user_id)
       VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [session.id, userId]
    );

    for (const sectionName of normalizedSections) {
      await client.query(
        `INSERT INTO session_sections (session_id,name,organization_id)
         VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [session.id, sectionName, orgId]
      );
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      id: session.id,
      session,
      sections: normalizedSections,
      joined: true,
      can_discard: ['owner','admin'].includes(req.user.role),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}

    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        blocked: true,
        can_discard: ['owner','admin'].includes(req.user.role),
        reason: 'active',
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
