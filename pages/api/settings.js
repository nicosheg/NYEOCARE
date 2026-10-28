import pool from '../../lib/db';
import { withOrg } from '../../lib/apiHelpers';

const DEFAULT_SCRIPT = {
  greeting: 'Hello {first_name}, this is Grace from your church.',
  body: 'We missed you today. Are you doing okay?',
  prayer: 'Would you like us to pray with you?',
  closing: 'Thank you. We look forward to seeing you soon. God bless.',
};

export default withOrg(async function handler(req, res) {
  const organizationId = req.org.id;

  if (req.method === 'GET') {
    try {
      const result = await pool.query(
        'SELECT settings->\'call_script\' AS call_script FROM organizations WHERE id = $1 LIMIT 1',
        [organizationId]
      );
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      return res.status(200).json(result.rows[0]?.call_script || DEFAULT_SCRIPT);
    } catch (error) {
      console.error('[SETTINGS] Tenant-scoped read failed:', {
        request_id: req.nyeoRequestId || null,
        organization_id: organizationId,
        message: error?.message || String(error),
      });
      return res.status(500).json({ error: 'Unable to load organization settings.' });
    }
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    if (!['owner', 'admin'].includes(String(req.user?.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'Admin permissions required.' });
    }
    const value = req.body?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return res.status(400).json({ error: 'A settings object is required.' });
    }

    try {
      const result = await pool.query(
        `UPDATE organizations
         SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('call_script', $2::jsonb),
             updated_at = NOW()
         WHERE id = $1
         RETURNING settings->'call_script' AS call_script`,
        [organizationId, JSON.stringify(value)]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Organization not found.' });
      return res.status(200).json({ success: true, value: result.rows[0].call_script });
    } catch (error) {
      console.error('[SETTINGS] Tenant-scoped write failed:', {
        request_id: req.nyeoRequestId || null,
        organization_id: organizationId,
        message: error?.message || String(error),
      });
      return res.status(500).json({ error: 'Unable to save organization settings.' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
});
