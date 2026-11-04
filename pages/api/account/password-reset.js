// pages/api/account/password-reset.js
import { requestPasswordRecovery, isPasswordRecoveryRateLimitError } from '../../../lib/authRecoveryRequest';
import { getCurrentCareUser } from '../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  try {
    const user = await getCurrentCareUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });
    if (!user.email) return res.status(400).json({ error: 'Your account does not have an email address.' });

    const { error } = await requestPasswordRecovery(user.email, req);
    if (error) {
      if (isPasswordRecoveryRateLimitError(error)) {
        return res.status(429).json({
          error: 'NYEOCARE email delivery has reached its sending limit. Repeated requests will not send a link. Configure a dedicated email provider for reliable password recovery.',
        });
      }
      console.error('[PASSWORD_RESET_ACCOUNT] Recovery email request failed:', error?.message || error);
      return res.status(502).json({ error: 'Unable to send the secure reset link right now. Please try again later.' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[PASSWORD_RESET_ACCOUNT] Recovery email request failed:', error?.message || error);
    return res.status(500).json({ error: 'Unable to send the secure reset link right now. Please try again later.' });
  }
}
