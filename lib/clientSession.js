// lib/clientSession.js
import { supabase } from './supabaseClient';

let cachedSession = null;
let cachedExpiresAt = 0;
let inFlight = null;
let refreshInFlight = null;
let listenerReady = false;

const SKEW_MS = 30_000;
const READ_RETRIES = 3;
const READ_RETRY_MS = 250;
const EMPTY_SESSION_RETRY_MS = 150;

function remember(session) {
  cachedSession = session || null;
  cachedExpiresAt = session?.expires_at ? Number(session.expires_at) * 1000 : 0;
  return cachedSession;
}

function ensureListener() {
  if (listenerReady || typeof window === 'undefined') return;
  listenerReady = true;

  // Keep this listener passive: it mirrors Supabase's canonical auth state
  // but never signs the user out or forces navigation.
  supabase.auth.onAuthStateChange((event, session) => {
    if (
      event === 'INITIAL_SESSION' ||
      event === 'SIGNED_IN' ||
      event === 'TOKEN_REFRESHED' ||
      event === 'USER_UPDATED'
    ) {
      remember(session);
    } else if (event === 'SIGNED_OUT') {
      remember(null);
    }
  });
}

async function readSession() {
  let lastError = null;

  for (let attempt = 0; attempt < READ_RETRIES; attempt += 1) {
    try {
      // Supabase is the source of truth here. getSession() reads the
      // persisted browser session and refreshes it when necessary.
      const { data, error } = await supabase.auth.getSession();

      if (!error) {
        return remember(data?.session || null);
      }

      lastError = error;
    } catch (error) {
      lastError = error;
    }

    if (attempt < READ_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, READ_RETRY_MS * (attempt + 1)));
    }
  }

  throw lastError || new Error('Unable to read the current session.');
}

export async function getClientSession({ forceRefresh = false } = {}) {
  if (typeof window === 'undefined') {
    return cachedSession;
  }

  ensureListener();

  // forceRefresh now has real semantics. This matters for every API retry
  // path that already asks the auth layer for a fresh token.
  if (forceRefresh) {
    return refreshClientSession();
  }

  const now = Date.now();

  if (cachedSession && cachedExpiresAt > now + SKEW_MS) {
    return cachedSession;
  }

  // Never race a refresh with an ordinary session read. Supabase refresh-token
  // rotation means concurrent refreshes are particularly dangerous.
  if (refreshInFlight) {
    return refreshInFlight;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    const session = await readSession();

    // A genuine null means Supabase did not find a session after fully
    // initializing its persisted storage. Re-read once to protect against
    // a transient storage/hydration edge without treating an exception as
    // proof that the user is signed out.
    if (session) return session;

    await new Promise(resolve => setTimeout(resolve, EMPTY_SESSION_RETRY_MS));

    return readSession();
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export function refreshClientSession() {
  if (typeof window === 'undefined') {
    return Promise.resolve(cachedSession);
  }

  ensureListener();

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = supabase.auth
    .refreshSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return remember(data?.session || null);
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

export function clearClientSession() {
  cachedSession = null;
  cachedExpiresAt = 0;
};

export const authHeaders = session =>
  session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
