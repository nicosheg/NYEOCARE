// lib/authRecoveryRequest.js
import { supabase } from './supabaseClient';
import { getAuthRedirectUrlFromRequest } from './authRedirectUrl';

const PASSWORD_RECOVERY_CALLBACK = '/auth/verify?next=%2Freset-password';

export function isPasswordRecoveryRateLimitError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return Number(error?.status || 0) === 429 ||
    code === 'over_email_send_rate_limit' ||
    code === 'email_rate_limit_exceeded' ||
    message.includes('rate limit') ||
    message.includes('too many');
}

export async function requestPasswordRecovery(email, req) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return { error: new Error('A valid account email address is required.') };
  }

  const redirectTo = getAuthRedirectUrlFromRequest(req, PASSWORD_RECOVERY_CALLBACK);
  return supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
}
