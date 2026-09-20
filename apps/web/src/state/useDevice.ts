/**
 * The device loop: restore the session, measure reachability, and, only when the server is
 * actually reachable, sync bundles for the farmer's district and drain the outbox. Then
 * recompute the briefing from the device store. The briefing never waits on the network. It is
 * computed from what the phone holds, and the network only ever refreshes what the phone holds.
 */
import type { ListingDraft, OutboxEntry } from '@fasal/shared';

import type { AttachedPhoto } from '../camera/CameraSheet';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Locale } from '../i18n/strings';
import { computeHome, DEFAULT_CONTEXT, type DecisionContext, type HomeBriefing } from '../offline/compute';
import { request } from '../offline/http';
import { store, type LocalListing, type QueueState, type StoredPhoto } from '../offline/db';
import { drain, enqueue, queueSummary, type QueueSummary } from '../offline/outbox';
import { photoKey } from '../offline/photos';
import { attachRecording, saveRecording, transcribePending } from '../offline/recordings';
import { effectiveType, probe, type Reachability } from '../offline/reach';
import { adoptSession, refreshProfile, restoreSession, signOut as endSession, type SessionState } from '../offline/session';
import { syncDemand, syncWeather, syncDistrict } from '../offline/sync';
import { refreshDeals, storedDeals, type DealView } from '../deals/deals';
import { refreshMyPools, storedPools, type ConsignmentView } from '../pools/pools';
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
  /** The farmer's listings on this phone, with where each is on its way to the server. */
  listings: ListingState[];
  /** Group sales this farmer's lots are in (§6.6), as last known to this phone. */
  consignments: ConsignmentView[];
  /** Re-read the consignments after joining or leaving one. */
  reloadConsignments: () => Promise<void>;
  /** Offers and deals on this farmer's lots, as the server last described them (§8.9). */
  deals: DealView[];
  /** Re-read the deals after acting on an offer: the server's answer, never a guess. */
  reloadDeals: () => Promise<void>;
  createListing: (draft: ListingDraft, said: string, recordingId: string | null, photo?: AttachedPhoto | null) => Promise<void>;
  keepRecording: (blob: Blob) => Promise<string | null>;
  /** After an OTP sign-in or a verification, adopt the new state. */
  adopt: (accessToken: string) => Promise<void>;
  reloadProfile: () => Promise<void>;
  queueAction: (entry: OutboxEntry) => Promise<void>;
  signOut: () => Promise<void>;
}

/** One record of the demonstration registry (§16.1), for the sign-in list. */
export interface RegistrySample {
  registry: 'pm-kisan' | 'agristack';
  id: string;
  name: string;
  district: string;
  village: string | null;
}

export interface ListingState {
  listing: LocalListing;
  state: 'saved-here' | 'waiting' | 'sent' | 'rejected';
  error: string | null;
  /** The listing's photograph and where it is on its way to the server (CAM-13: per-item state). */
  photo: { stored: StoredPhoto; state: 'saved-here' | 'waiting' | 'sending' | 'sent' | 'rejected'; error: string | null } | null;
}

function photoState(stored: StoredPhoto, outboxState: QueueState | undefined): NonNullable<ListingState['photo']>['state'] {
  if (outboxState === undefined) return 'saved-here';
  if (outboxState === 'sent') return 'sent';
  if (outboxState === 'rejected') return 'rejected';
  if (outboxState === 'sending' || (stored.sentBytes > 0 && stored.sentBytes < stored.byteLength)) return 'sending';
  return 'waiting';
}

function listingState(outboxState: QueueState | undefined): ListingState['state'] {
  if (outboxState === undefined) return 'saved-here';
  if (outboxState === 'sent') return 'sent';
  if (outboxState === 'rejected') return 'rejected';
  return 'waiting';
}

export function useDevice(initial: Preferences): Device {
  const [locale, setLocaleState] = useState<Locale>(initial.locale);
  const [theme, setThemeState] = useState<Theme>(initial.theme);
  const [themeOffer, setThemeOffer] = useState<'first-run' | 'bright-light' | null>(initial.themeChosen ? null : 'first-run');
  const [session, setSession] = useState<SessionState | null>(null);
  const [reach, setReach] = useState<Reachability | null>(null);
  const [briefing, setBriefing] = useState<HomeBriefing | null>(null);
  const [queue, setQueue] = useState<QueueSummary | null>(null);
  const [listings, setListings] = useState<ListingState[]>([]);
  const [consignments, setConsignments] = useState<ConsignmentView[]>([]);
  const [deals, setDeals] = useState<DealView[]>([]);
  const [context, setContext] = useState<DecisionContext>({ ...DEFAULT_CONTEXT, quantityQtl: initial.quantityQtl ?? DEFAULT_CONTEXT.quantityQtl });
  const [selectedCrop, setSelectedCrop] = useState<string | null>(initial.selectedCrop ?? null);
  const contextRef = useRef(context);
  contextRef.current = context;
  const sessionRef = useRef<SessionState | null>(null);
  sessionRef.current = session;
  const busy = useRef(false);
  const again = useRef(false);

  const recompute = useCallback(async (state: SessionState | null) => {
    if (state === null || state.status === 'signed-out') {
      setBriefing(null);
      setQueue(null);
      return;
    }
    setBriefing(await computeHome(state.profile, contextRef.current));
    setQueue(await queueSummary(state.profile.userId));
    const mine = await store().listings.where('userId').equals(state.profile.userId).reverse().sortBy('createdAt');
    const entries = await store().outbox.bulkGet(mine.map((l) => `listing-${l.clientId}`));
    const photos = await store().photos.where('userId').equals(state.profile.userId).toArray();
    const photoEntries = await store().outbox.bulkGet(photos.map((p) => p.key));
    const photoOf = new Map(photos.map((stored, i) => [stored.listingClientId, { stored, state: photoState(stored, photoEntries[i]?.state), error: photoEntries[i]?.lastError ?? null }]));
    setListings(mine.map((listing, i) => ({ listing, state: listingState(entries[i]?.state), error: entries[i]?.lastError ?? null, photo: photoOf.get(listing.clientId) ?? null })));
    setConsignments(await storedPools(state.profile.userId));
    setDeals(await storedDeals(state.profile.userId));
  }, []);

  /**
   * One pass of the loop. Safe to call at any time. A call that arrives mid-pass (the network
   * coming back while a slow probe is still timing out) is not dropped: it runs as soon as the
   * current pass ends, so a returning network is acted on at once rather than on the next timer.
   */
  const tick = useCallback(async (): Promise<void> => {
    if (busy.current) {
      again.current = true;
      return;
    }
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
          await syncDemand(state.profile.district);
          await syncWeather(state.profile.district);
          await refreshMyPools(state.profile.userId);
          await refreshDeals(state.profile.userId);
          await drain(state.profile.userId, { effectiveType: effectiveType() });
          await transcribePending(state.profile.userId);
        }
      }
      await recompute(state);
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void tick();
      }
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

  const createListing = useCallback(
    async (draft: ListingDraft, said: string, recordingId: string | null, photo: AttachedPhoto | null = null) => {
      const state = sessionRef.current;
      if (state === null || state.status === 'signed-out') return;
      const now = Date.now();
      const userId = state.profile.userId;
      await store().listings.put({ clientId: draft.clientId, userId, draft, said, createdAt: now });
      if (recordingId !== null) await attachRecording(recordingId, draft.clientId);
      await enqueue({ kind: 'listing.create', idempotencyKey: `listing-${draft.clientId}`, createdAt: new Date(now).toISOString(), attempts: 0, listing: draft }, userId, now);
      if (photo !== null) {
        // The photograph is saved as a Blob and queued behind its listing; the listing never waits for it (CAM-12).
        const key = photoKey(draft.clientId, photo.contentHash);
        const byteLength = photo.blob.size;
        await store().photos.put({ key, userId, listingClientId: draft.clientId, blob: photo.blob, width: photo.width, height: photo.height, byteLength, contentHash: photo.contentHash, sentBytes: 0, createdAt: now });
        await enqueue(
          { kind: 'photo.upload', idempotencyKey: key, createdAt: new Date(now).toISOString(), attempts: 0, listingClientId: draft.clientId, contentHash: photo.contentHash, blobKey: key, byteLength, proposal: photo.proposal },
          userId,
          now,
        );
      }
      await recompute(state);
      void tick();
    },
    [recompute, tick],
  );

  const keepRecording = useCallback(
    async (blob: Blob) => {
      const state = sessionRef.current;
      if (state === null || state.status === 'signed-out') return null;
      return (await saveRecording(state.profile.userId, blob, locale)).id;
    },
    [locale],
  );

  const reloadConsignments = useCallback(async () => {
    const state = sessionRef.current;
    if (state === null || state.status === 'signed-out') return;
    await refreshMyPools(state.profile.userId);
    setConsignments(await storedPools(state.profile.userId));
  }, []);

  const reloadDeals = useCallback(async () => {
    const state = sessionRef.current;
    if (state === null || state.status === 'signed-out') return;
    await refreshDeals(state.profile.userId);
    setDeals(await storedDeals(state.profile.userId));
  }, []);

  const signOut = useCallback(async () => {
    await endSession();
    const next: SessionState = { status: 'signed-out', reason: 'no-session' };
    setSession(next);
    sessionRef.current = next;
    await recompute(next);
  }, [recompute]);

  return { locale, setLocale, theme, setTheme, themeOffer, dismissThemeOffer, session, reach, briefing, queue, listings, consignments, reloadConsignments, deals, reloadDeals, createListing, keepRecording, context, setQuantity, selectedCrop, selectCrop, adopt, reloadProfile, queueAction, signOut };
}

/**
 * Thin wrappers over the identity endpoints for the sign-in screens. Signing in needs the network
 * anyway, so these wait longer than the default: on 2G, or against a server that has just started,
 * a sign-in round trip can take well over six seconds, and giving up early would tell the farmer
 * there is no network when there is.
 */
const SIGN_IN_TIMEOUT_MS = 20_000;

export const identity = {
  requestCode: (phone: string) =>
    request<{ challengeId: string; expiresInSeconds: number; devCode?: string }>('/api/auth/otp/request', { method: 'POST', body: { phone }, auth: false, timeoutMs: SIGN_IN_TIMEOUT_MS }),
  verifyCode: (phone: string, code: string, displayName: string, locale: Locale) =>
    request<{ accessToken: string }>('/api/auth/otp/verify', { method: 'POST', body: { phone, code, signup: { kind: 'farmer', displayName, locale } }, auth: false, timeoutMs: SIGN_IN_TIMEOUT_MS }),
  verifyFarmer: (id: string, registry: 'pm-kisan' | 'agristack' = 'pm-kisan') =>
    request<{ district: string; village: string | null }>('/api/verify/farmer', { method: 'POST', body: { registry, id }, timeoutMs: SIGN_IN_TIMEOUT_MS }),
  /** The demonstration registry's sample records, or an empty list against a live registry. */
  registrySamples: () => request<{ mode: 'mock' | 'live'; farmers: RegistrySample[] }>('/api/verify/samples', { timeoutMs: SIGN_IN_TIMEOUT_MS }),
};
