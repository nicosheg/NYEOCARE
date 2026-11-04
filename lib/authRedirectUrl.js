// lib/authRedirectUrl.js
const CANONICAL_PRODUCTION_ORIGIN = 'https://nyeocare.vercel.app';
const STABLE_PRODUCTION_HOSTS = new Set([
  'nyeocare.vercel.app',
  'nyeocare-nicosheg.vercel.app',
]);

export function getAuthRedirectUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Invalid authentication redirect path.');
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname.toLowerCase();
    // Keep the request and callback on the same stable Vercel alias. PKCE
    // stores its verifier per origin, and Supabase must redirect to the alias
    // that was allowed in Auth URL Configuration. Never emit a preview URL.
    if (STABLE_PRODUCTION_HOSTS.has(hostname)) {
      return window.location.origin + path;
    }

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return window.location.origin + path;
    }
  }

  return CANONICAL_PRODUCTION_ORIGIN + path;
}
