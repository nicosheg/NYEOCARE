import { withOrg } from '../../lib/apiHelpers';
import { getAttentionItems } from '../../lib/ariaIntelligence';

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Never accept a tenant identifier from the URL. withOrg derives this from
  // the authenticated user's active database membership.
  try {
    const data = await getAttentionItems(req.org.id);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[ATTENTION] Unable to load tenant attention items:', {
      request_id: req.nyeoRequestId || null,
      organization_id: req.org.id,
      message: err?.message || String(err),
    });
    return res.status(500).json({ error: 'Unable to load attention items.' });
  }
}

export default withOrg(handler);
