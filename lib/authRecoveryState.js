// lib/authRecoveryState.js
export const PENDING_RECOVERY_KEY = 'nyeocare:pending-password-recovery-at';
export const RECOVERY_SESSION_KEY = 'nyeocare:password-recovery-verified';
export const RECOVERY_REQUEST_TTL_MS = 30 * 60 * 1000;

export function markPendingRecoveryRequest() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PENDING_RECOVERY_KEY, String(Date.now()));
}

export function hasPendingRecoveryRequest() {
  if (typeof window === 'undefined') return false;
  const requestedAt = Number(window.localStorage.getItem(PENDING_RECOVERY_KEY) || 0);
  if (!Number.isFinite(requestedAt) || requestedAt <= 0) return false;
  const age = Date.now() - requestedAt;
  if (age < -60_000 || age > RECOVERY_REQUEST_TTL_MS) {
    clearPendingRecoveryRequest();
    return false;
  }
  return true;
}

export function clearPendingRecoveryRequest() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PENDING_RECOVERY_KEY);
}

export function markVerifiedRecoverySession() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(RECOVERY_SESSION_KEY, '1');
}

export function hasVerifiedRecoverySession() {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(RECOVERY_SESSION_KEY) === '1';
}

export function clearVerifiedRecoverySession() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(RECOVERY_SESSION_KEY);
}
