// lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

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

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.'
  );
}

// Browser auth uses Supabase's managed persisted session + automatic token
// refresh. Server code gets an auth client without browser-only persistence.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
    flowType: 'pkce',
  },
});

export const supabaseAdmin = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
