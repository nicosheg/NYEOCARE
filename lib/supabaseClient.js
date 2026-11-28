// lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js';
import { markVerifiedRecoverySession, clearPendingRecoveryRequest, clearVerifiedRecoverySession, hasPendingRecoveryRequest, markRecoveryCallbackSeen, clearRecoveryCallbackSeen } from './authRecoveryState';

// These values are intentionally public: Supabase publishable keys are designed
// for browser use. They also give local development a safe canonical fallback
// when local NEXT_PUBLIC_* values are missing or contain placeholders.
const CANONICAL_SUPABASE_URL = 'https://qleenqqrigcrwcqwtdjb.supabase.co';
const CANONICAL_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kIn76NBy0TKq9MLEbKlSOQ_63ZTyT1N';
const PREVIEW_BLOCKED_SUPABASE_URL = 'https://preview-disabled.invalid';
const PREVIEW_BLOCKED_SUPABASE_KEY = 'nyeocare-preview-disabled';

const isPlaceholder = value => {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized ||
    normalized.includes('example.supabase.co') ||
    normalized.includes('placeholder') ||
    normalized.includes('your-project');
};

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const configuredSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const deploymentEnvironment = process.env.NEXT_PUBLIC_VERCEL_ENV || 'development';
const isCiBuild = process.env.CI === 'true';
const normalizedConfiguredUrl = String(configuredSupabaseUrl || '').trim().replace(/\/+$/, '');
const targetsCanonicalProduction = normalizedConfiguredUrl === CANONICAL_SUPABASE_URL;

const previewRequiresIsolation = deploymentEnvironment === 'preview' &&
  (isPlaceholder(configuredSupabaseUrl) || isPlaceholder(configuredSupabaseKey) || targetsCanonicalProduction);

const previewBlockMessage =
  'NYEOCARE Preview is disabled until it is configured with an isolated staging Supabase project. Production Supabase access is blocked.';

if (previewRequiresIsolation && typeof console !== 'undefined') {
  console.warn('[SUPABASE]', previewBlockMessage);
}

const allowLocalOrCiFallback = deploymentEnvironment === 'development' || isCiBuild;

// Do not throw during module initialization: Next.js imports this singleton
// while collecting page data during the build. A module-level throw prevents
// all Preview builds from completing, even though no request is being served.
// Instead, use an invalid host and a fetch implementation that always returns
// 503. That guarantees an unsafe Preview cannot send requests to Production.
const supabaseUrl = previewRequiresIsolation
  ? PREVIEW_BLOCKED_SUPABASE_URL
  : isPlaceholder(configuredSupabaseUrl)
    ? (allowLocalOrCiFallback ? CANONICAL_SUPABASE_URL : '')
    : configuredSupabaseUrl.trim();

const supabaseAnonKey = previewRequiresIsolation
  ? PREVIEW_BLOCKED_SUPABASE_KEY
  : isPlaceholder(configuredSupabaseKey)
    ? (allowLocalOrCiFallback ? CANONICAL_SUPABASE_PUBLISHABLE_KEY : '')
    : configuredSupabaseKey.trim();

const previewBlockedFetch = async () => new Response(
  JSON.stringify({ message: previewBlockMessage, code: 'NYEOCARE_PREVIEW_DATABASE_ISOLATION_REQUIRED' }),
  {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  }
);

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
  ...(previewRequiresIsolation ? { global: { fetch: previewBlockedFetch } } : {}),
});

if (isBrowser) {
  // This is intentionally registered at module initialization, before route
  // components or session warmers can subscribe. It records the event for the
  // global recovery redirector and reset page, even when the email callback
  // lands on the app's Site URL instead of /auth/verify.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      // Keep an outstanding recovery request alive across an ordinary sign-out;
      // the user may still need to open the email they already requested.
      clearVerifiedRecoverySession();
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

// Never expose a Production service-role client inside an unsafe Preview build.
export const supabaseAdmin = !previewRequiresIsolation && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
