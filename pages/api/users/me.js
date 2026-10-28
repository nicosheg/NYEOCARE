// pages/api/users/me.js
import { getCurrentCareUser } from '../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  try {
    const user = await getCurrentCareUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // Do not serialize SELECT u.*: the backing row contains password_hash,
    // auth identifiers, and other fields that do not belong in the browser.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).json({
      id: user.id,
      organization_id: user.organization_id,
      organization_name: user.organization_name,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      created_at: user.created_at,
      last_login_at: user.last_login_at,
    });
  } catch (error) {
    console.error('[USERS/ME] Unable to resolve current user:', error?.message || error);
    return res.status(503).json({ error: 'Authentication service temporarily unavailable.' });
  }
}
