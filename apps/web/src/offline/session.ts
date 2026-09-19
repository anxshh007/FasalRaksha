/**
 * Session persistence across connectivity loss (PROMPT §XI).
 *
 * A farmer who opens the app with no network is not signed out because an identity endpoint
 * could not be reached. Two outcomes are kept apart on purpose:
 *
 *   server reached → authentication rejected: the session is over. Clear the cached profile.
 *   network unavailable:                       restore the last-confirmed profile from the
 *                                              device and say how old it is.
 *
 * (Phase 1 read its session from localStorage unconditionally and so got the offline half right
 * by accident. Here it is deliberate, and the rejected half is handled too.)
 *
 * Refresh tokens rotate with reuse detection on the server (P3), so two concurrent refreshes
 * with the same token would look like theft and end the session. All refreshes therefore go
 * through one in-flight promise.
 */
import { store, type StoredProfile } from './db.js';
import { CSRF_HEADER, request, setAccessToken } from './http.js';

export type SessionState =
  | { status: 'signed-in'; profile: StoredProfile }
  | { status: 'offline-restored'; profile: StoredProfile }
  | { status: 'signed-out'; reason: 'no-session' | 'rejected' };

interface SessionBody {
  accessToken: string;
  sessionId: string;
  user: { id: string; role: StoredProfile['role'] };
}

interface MeBody {
  id: string;
  role: StoredProfile['role'];
  displayName: string;
  district: string | null;
  village?: string | null;
  locale?: string;
  verification: { verified: boolean };
}

let inFlight: Promise<SessionState> | null = null;

async function fetchProfile(now: number): Promise<StoredProfile | 'unreachable' | 'rejected'> {
  const me = await request<MeBody>('/api/me');
  if (me.kind === 'unreachable' || me.kind === 'failed') return 'unreachable';
  if (me.kind !== 'ok') return 'rejected';
  const profile: StoredProfile = {
    id: 'me',
    userId: me.body.id,
    role: me.body.role,
    displayName: me.body.displayName,
    district: me.body.district,
    village: me.body.village ?? null,
    locale: me.body.locale ?? 'mr',
    verified: me.body.verification.verified,
    confirmedAt: now,
  };
  await store().profile.put(profile);
  return profile;
}

async function restore(now: number): Promise<SessionState> {
  const cached = await store().profile.get('me');
  const refreshed = await request<SessionBody>('/api/auth/refresh', { method: 'POST', auth: false, headers: { [CSRF_HEADER]: '1' } });
  if (refreshed.kind === 'unreachable' || refreshed.kind === 'failed') {
    // Not an answer about who this is: keep the farmer signed in on the device.
    return cached ? { status: 'offline-restored', profile: cached } : { status: 'signed-out', reason: 'no-session' };
  }
  if (refreshed.kind !== 'ok') {
    setAccessToken(null);
    await store().profile.delete('me');
    return { status: 'signed-out', reason: cached ? 'rejected' : 'no-session' };
  }
  setAccessToken(refreshed.body.accessToken);
  const profile = await fetchProfile(now);
  if (profile === 'unreachable') return cached ? { status: 'offline-restored', profile: cached } : { status: 'signed-out', reason: 'no-session' };
  if (profile === 'rejected') return { status: 'signed-out', reason: 'rejected' };
  return { status: 'signed-in', profile };
}

/** Restore or refresh the session. Concurrent callers share one refresh. */
export function restoreSession(now = Date.now()): Promise<SessionState> {
  inFlight ??= restore(now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** After sign-in or verification: take the token, confirm the profile, cache it. */
export async function adoptSession(accessToken: string, now = Date.now()): Promise<SessionState> {
  setAccessToken(accessToken);
  const profile = await fetchProfile(now);
  if (typeof profile === 'string') return { status: 'signed-out', reason: 'rejected' };
  return { status: 'signed-in', profile };
}

/** Re-read the profile (after verification changes the district). */
export async function refreshProfile(now = Date.now()): Promise<StoredProfile | null> {
  const profile = await fetchProfile(now);
  return typeof profile === 'string' ? null : profile;
}

export async function signOut(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' });
  setAccessToken(null);
  await store().profile.delete('me');
}
