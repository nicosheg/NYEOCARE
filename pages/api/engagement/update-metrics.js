// pages/api/engagement/update-metrics.js
import { withAdmin } from '../../../lib/apiHelpers';
import { updateEngagementMetrics } from '../../../lib/aria/engagementIntelligence';

export default withAdmin(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Tenant scope comes from the authenticated organization membership, never
  // from req.query or req.body.
  try {
    const updated = await updateEngagementMetrics(req.org.id);
    return res.status(200).json({
      success: true,
      updated,
      message: 'Engagement metrics updated',
    });
  } catch (err) {
    console.error('[ENGAGEMENT] Metric rebuild failed:', {
      request_id: req.nyeoRequestId || null,
      organization_id: req.org.id,
      message: err?.message || String(err),
    });
    return res.status(500).json({ error: 'Unable to update engagement metrics.' });
  }
});
