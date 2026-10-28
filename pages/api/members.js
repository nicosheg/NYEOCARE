import { withOrg } from '../../lib/apiHelpers';
import { createPerson } from '../../lib/aria/peopleMutationEngine';

async function handler(req, res) {
  const organizationId = req.org.id;

  if (req.method === 'GET') {
    try {
      const { rows } = await (await import('../../lib/db')).default.query(
        `SELECT id, first_name, last_name, display_name, phone, status, type, created_at
         FROM people
         WHERE organization_id = $1
           AND type = 'member'
         ORDER BY created_at DESC`,
        [organizationId]
      );
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      return res.status(200).json(rows);
    } catch (error) {
      console.error('[MEMBERS] Tenant-scoped member read failed:', {
        request_id: req.nyeoRequestId || null,
        organization_id: organizationId,
        message: error?.message || String(error),
      });
      return res.status(500).json({ error: 'Unable to load members.' });
    }
  }

  if (req.method === 'POST') {
    if (!['owner', 'admin'].includes(String(req.user?.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'Admin permissions required.' });
    }

    const body = req.body || {};
    const name = [body.first_name, body.last_name].map(value => String(value || '').trim()).filter(Boolean).join(' ');
    if (!name) return res.status(400).json({ error: 'A name is required.' });

    try {
      const result = await createPerson({
        organizationId,
        actorId: req.user.id,
        name,
        phone: body.phone || null,
        type: 'member',
      });
      return res.status(result.created ? 201 : 200).json(result.person);
    } catch (error) {
      const status = [400, 403, 404, 409].includes(Number(error?.status)) ? Number(error.status) : 500;
      if (status >= 500) {
        console.error('[MEMBERS] Tenant-scoped member create failed:', {
          request_id: req.nyeoRequestId || null,
          organization_id: organizationId,
          message: error?.message || String(error),
        });
      }
      return res.status(status).json({
        error: status >= 500 ? 'Unable to create member.' : (error?.message || 'Unable to create member.'),
        ...(error?.code ? { code: error.code } : {}),
        ...(Array.isArray(error?.candidates) ? { candidates: error.candidates } : {}),
      });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withOrg(handler);
