// lib/authRecoveryState.js
export const PENDING_RECOVERY_KEY = 'nyeocare:pending-password-recovery-at';
export const RECOVERY_SESSION_KEY = 'nyeocare:password-recovery-verified';
export const RECOVERY_CALLBACK_SEEN_KEY = 'nyeocare:password-recovery-callback-seen';
export const RECOVERY_REQUEST_TTL_MS = 30 * 60 * 1000;

export function markPendingRecoveryRequest() {
  if (typeof window === 'undefined') return;
  // A new recovery attempt must not inherit callback/session markers from
  // an earlier consumed or failed one-time link.
  clearRecoveryCallbackSeen();
  clearVerifiedRecoverySession();
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

export function markRecoveryCallbackSeen() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RECOVERY_CALLBACK_SEEN_KEY, String(Date.now()));
}

export function hasRecoveryCallbackBeenSeen() {
  if (typeof window === 'undefined') return false;
  const seenAt = Number(window.localStorage.getItem(RECOVERY_CALLBACK_SEEN_KEY) || 0);
  if (!Number.isFinite(seenAt) || seenAt <= 0) return false;
  const age = Date.now() - seenAt;
  if (age < -60_000 || age > RECOVERY_REQUEST_TTL_MS) {
    clearRecoveryCallbackSeen();
    return false;
  }
  return true;
}

export function clearRecoveryCallbackSeen() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(RECOVERY_CALLBACK_SEEN_KEY);
}
