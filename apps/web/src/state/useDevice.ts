/**
 * The device loop: restore the session, measure reachability, and, only when the server is
 * actually reachable, sync bundles for the farmer's district and drain the outbox. Then
 * recompute the briefing from the device store. The briefing never waits on the network. It is
 * computed from what the phone holds, and the network only ever refreshes what the phone holds.
 */
import type { OutboxEntry } from '@fasal/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Locale } from '../i18n/strings';
import { computeHome, DEFAULT_CONTEXT, type DecisionContext, type HomeBriefing } from '../offline/compute';
import { request } from '../offline/http';
import { drain, enqueue, queueSummary, type QueueSummary } from '../offline/outbox';
import { effectiveType, probe, type Reachability } from '../offline/reach';
import { adoptSession, refreshProfile, restoreSession, signOut as endSession, type SessionState } from '../offline/session';
import { syncDistrict } from '../offline/sync';
import { applyToDocument, savePreference, watchForBrightLight, type Preferences, type Theme } from './preferences';

const LOOP_MS = 20_000;

export interface Device {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Show the first-run FIELD offer, or a one-time bright-light suggestion. */
  themeOffer: 'first-run' | 'bright-light' | null;
  dismissThemeOffer: () => void;
  session: SessionState | null;
  reach: Reachability | null;
  briefing: HomeBriefing | null;
  queue: QueueSummary | null;
  /** The farmer's own decision inputs: joined to market data on this phone only. */
  context: DecisionContext;
  setQuantity: (quintals: number) => void;
  /** The crop the briefing leads with. */
  selectedCrop: string | null;
  selectCrop: (crop: string) => void;
  /** After an OTP sign-in or a verification, adopt the new state. */
  adopt: (accessToken: string) => Promise<void>;
  reloadProfile: () => Promise<void>;
  queueAction: (entry: OutboxEntry) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useDevice(initial: Preferences): Device {
  const [locale, setLocaleState] = useState<Locale>(initial.locale);
  const [theme, setThemeState] = useState<Theme>(initial.theme);
  const [themeOffer, setThemeOffer] = useState<'first-run' | 'bright-light' | null>(initial.themeChosen ? null : 'first-run');
  const [session, setSession] = useState<SessionState | null>(null);
  const [reach, setReach] = useState<Reachability | null>(null);
  const [briefing, setBriefing] = useState<HomeBriefing | null>(null);
  const [queue, setQueue] = useState<QueueSummary | null>(null);
  const [context, setContext] = useState<DecisionContext>({ ...DEFAULT_CONTEXT, quantityQtl: initial.quantityQtl ?? DEFAULT_CONTEXT.quantityQtl });
  const [selectedCrop, setSelectedCrop] = useState<string | null>(initial.selectedCrop ?? null);
  const contextRef = useRef(context);
  contextRef.current = context;
  const sessionRef = useRef<SessionState | null>(null);
  sessionRef.current = session;
  const busy = useRef(false);

  const recompute = useCallback(async (state: SessionState | null) => {
    if (state === null || state.status === 'signed-out') {
      setBriefing(null);
      setQueue(null);
      return;
    }
    setBriefing(await computeHome(state.profile, contextRef.current));
    setQueue(await queueSummary(state.profile.userId));
  }, []);

  /** One pass of the loop. Safe to call at any time; overlapping calls are skipped. */
  const tick = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const measured = await probe();
      setReach(measured);
      let state = sessionRef.current;
      if (measured.reachable) {
        // Offline-restored sessions are re-confirmed with the server the moment it is back.
        if (state === null || state.status === 'offline-restored') {
          state = await restoreSession();
          setSession(state);
        }
        if (state.status === 'signed-in' && state.profile.district !== null) {
          await syncDistrict(state.profile.district);
          await drain(state.profile.userId, { effectiveType: effectiveType() });
        }
      }
      await recompute(state);
    } finally {
      busy.current = false;
    }
  }, [recompute]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Render from the device first, then ask the network.
      const restored = await restoreSession();
      if (cancelled) return;
      setSession(restored);
      sessionRef.current = restored;
      await recompute(restored);
      await tick();
    })();
    const timer = setInterval(() => void tick(), LOOP_MS);
    const wake = () => void tick();
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [recompute, tick]);

  useEffect(() => {
    applyToDocument({ locale, theme });
  }, [locale, theme]);

  useEffect(() => {
    if (initial.lightSuggested || theme === 'field') return undefined;
    return watchForBrightLight(() => {
      setThemeOffer('bright-light');
      void savePreference('lightSuggested', true);
    });
  }, [initial.lightSuggested, theme]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void savePreference('locale', next);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setThemeOffer(null);
    void savePreference('theme', next);
    void savePreference('themeChosen', true);
  }, []);

  const dismissThemeOffer = useCallback(() => {
    setThemeOffer(null);
    void savePreference('themeChosen', true);
  }, []);

  const setQuantity = useCallback(
    (quintals: number) => {
      if (!(quintals > 0) || quintals > 10_000) return;
      const next = { ...contextRef.current, quantityQtl: Math.round(quintals * 10) / 10 };
      contextRef.current = next;
      setContext(next);
      void savePreference('quantityQtl', next.quantityQtl);
      void recompute(sessionRef.current);
    },
    [recompute],
  );

  const selectCrop = useCallback((crop: string) => {
    setSelectedCrop(crop);
    void savePreference('selectedCrop', crop);
  }, []);

  const adopt = useCallback(
    async (accessToken: string) => {
      const next = await adoptSession(accessToken);
      setSession(next);
      sessionRef.current = next;
      await tick();
    },
    [tick],
  );

  const reloadProfile = useCallback(async () => {
    const profile = await refreshProfile();
    if (profile !== null) {
      const next: SessionState = { status: 'signed-in', profile };
      setSession(next);
      sessionRef.current = next;
      await tick();
    }
  }, [tick]);

  const queueAction = useCallback(
    async (entry: OutboxEntry) => {
      const state = sessionRef.current;
      if (state === null || state.status === 'signed-out') return;
      await enqueue(entry, state.profile.userId);
      setQueue(await queueSummary(state.profile.userId));
      await tick();
    },
    [tick],
  );

  const signOut = useCallback(async () => {
    await endSession();
    const next: SessionState = { status: 'signed-out', reason: 'no-session' };
    setSession(next);
    sessionRef.current = next;
    await recompute(next);
  }, [recompute]);

  return { locale, setLocale, theme, setTheme, themeOffer, dismissThemeOffer, session, reach, briefing, queue, context, setQuantity, selectedCrop, selectCrop, adopt, reloadProfile, queueAction, signOut };
}

/** Thin wrappers over the identity endpoints for the sign-in screens. */
export const identity = {
  requestCode: (phone: string) => request<{ challengeId: string; expiresInSeconds: number; devCode?: string }>('/api/auth/otp/request', { method: 'POST', body: { phone }, auth: false }),
  verifyCode: (phone: string, code: string, displayName: string, locale: Locale) =>
    request<{ accessToken: string }>('/api/auth/otp/verify', { method: 'POST', body: { phone, code, signup: { kind: 'farmer', displayName, locale } }, auth: false }),
  verifyFarmer: (id: string) => request<{ district: string; village: string | null }>('/api/verify/farmer', { method: 'POST', body: { registry: 'pm-kisan', id } }),
};
