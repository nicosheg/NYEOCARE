// lib/authRedirectUrl.js
const PRODUCTION_AUTH_ORIGIN = 'https://nyeocare.vercel.app';

export function getAuthRedirectUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Invalid authentication redirect path.');
  }

  const isLocalDevelopment = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const origin = isLocalDevelopment ? window.location.origin : PRODUCTION_AUTH_ORIGIN;

  return origin + path;
}
