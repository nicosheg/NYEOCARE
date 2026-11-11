// lib/authRedirectUrl.js
const CANONICAL_PRODUCTION_HOST = 'nyeocare.vercel.app';
const CANONICAL_PRODUCTION_ORIGIN = `https://${CANONICAL_PRODUCTION_HOST}`;

export function getAuthRedirectUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Invalid authentication redirect path.');
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname.toLowerCase();

    // Auth requests must start and finish on one origin because PKCE stores
    // its verifier in browser storage scoped to the initiating origin.
    if (hostname === CANONICAL_PRODUCTION_HOST) {
      return window.location.origin + path;
    }

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return window.location.origin + path;
    }
  }

  // Never generate email callbacks on a Vercel deployment/preview hostname.
  return CANONICAL_PRODUCTION_ORIGIN + path;
}
