// lib/authRedirectUrl.js
const CANONICAL_PRODUCTION_ORIGIN = 'https://nyeocare.vercel.app';
const STABLE_PRODUCTION_HOSTS = new Set([
  'nyeocare.vercel.app',
  'nyeocare-nicosheg.vercel.app',
]);

function validateAuthPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Invalid authentication redirect path.');
  }
  return path;
}

function getAllowedOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.split(',')[0].trim();
  try {
    const parsed = new URL(candidate.includes('://') ? candidate : 'https://' + candidate);
    const hostname = parsed.hostname.toLowerCase();
    const validPort = !parsed.port || parsed.port === '443';
    if (parsed.protocol === 'https:' && validPort && STABLE_PRODUCTION_HOSTS.has(hostname)) {
      return parsed.origin;
    }
    if (parsed.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
      return parsed.origin;
    }
  } catch {
    return null;
  }
  return null;
}

export function getAuthRedirectUrl(path) {
  const safePath = validateAuthPath(path);
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname.toLowerCase();
    if (STABLE_PRODUCTION_HOSTS.has(hostname)) {
      return window.location.origin + safePath;
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return window.location.origin + safePath;
    }
  }
  return CANONICAL_PRODUCTION_ORIGIN + safePath;
}

export function getAuthRedirectUrlFromRequest(req, path) {
  const safePath = validateAuthPath(path);
  const headers = req?.headers || {};
  const candidates = [
    headers.origin,
    headers.referer,
    headers['x-forwarded-host'],
    headers.host,
  ];
  let origin = null;
  for (const candidate of candidates) {
    origin = getAllowedOrigin(candidate);
    if (origin) break;
  }
  return (origin || CANONICAL_PRODUCTION_ORIGIN) + safePath;
}
