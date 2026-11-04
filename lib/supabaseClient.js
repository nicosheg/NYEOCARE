// lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js';
import { markVerifiedRecoverySession, clearPendingRecoveryRequest, clearVerifiedRecoverySession, hasPendingRecoveryRequest, markRecoveryCallbackSeen, clearRecoveryCallbackSeen } from './authRecoveryState';

// These values are intentionally public: Supabase publishable keys are designed
// for browser use. They also give production a safe canonical fallback if a
// Vercel build is missing or carries placeholder NEXT_PUBLIC_* values.
const CANONICAL_SUPABASE_URL = 'https://qleenqqrigcrwcqwtdjb.supabase.co';
const CANONICAL_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kIn76NBy0TKq9MLEbKlSOQ_63ZTyT1N';

const isPlaceholder = value => {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized ||
    normalized.includes('example.supabase.co') ||
    normalized.includes('placeholder') ||
    normalized.includes('your-project');
};

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const configuredSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseUrl = isPlaceholder(configuredSupabaseUrl)
  ? CANONICAL_SUPABASE_URL
  : configuredSupabaseUrl.trim();

const supabaseAnonKey = isPlaceholder(configuredSupabaseKey)
  ? CANONICAL_SUPABASE_PUBLISHABLE_KEY
  : configuredSupabaseKey.trim();

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isBrowser = typeof window !== 'undefined';

// Capture the recovery callback before Supabase's PKCE initializer removes
// the one-time code from the address bar. This marker is only routing state;
// a live session from Supabase is still mandatory before the reset form opens.
if (isBrowser && hasPendingRecoveryRequest()) {
  try {
    if (new URL(window.location.href).searchParams.has('code')) {
      markRecoveryCallbackSeen();
    }
  } catch {
    // Invalid browser URLs are ignored; Supabase remains the auth authority.
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.'
  );
}

// Supabase owns PKCE callback parsing. Install the recovery listener immediately
// after creating the singleton so PASSWORD_RECOVERY cannot be missed by a page
// that mounts after the initial URL has already been processed.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
    flowType: 'pkce',
  },
});

if (isBrowser) {
  // This is intentionally registered at module initialization, before route
  // components or session warmers can subscribe. It records the event for the
  // global recovery redirector and reset page, even when the email callback
  // lands on the app's Site URL instead of /auth/verify.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      clearVerifiedRecoverySession();
      clearPendingRecoveryRequest();
      clearRecoveryCallbackSeen();
      return;
    }
    if (event !== 'PASSWORD_RECOVERY' || !session) return;
    try {
      markVerifiedRecoverySession();
      clearPendingRecoveryRequest();
      clearRecoveryCallbackSeen();
      window.dispatchEvent(new Event('nyeocare:password-recovery'));
    } catch (error) {
      console.warn('[AUTH] Could not persist password recovery state:', error?.message || error);
    }
  });
}

export const supabaseAdmin = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
