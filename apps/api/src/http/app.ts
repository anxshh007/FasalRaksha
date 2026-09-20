/**
 * The Fastify application factory. Domain modules register here as they are built (PROMPT §3.3:
 * domain modules, not giant controllers). Constructed with its dependencies so tests inject them
 * and never touch a real network.
 *
 * Hardening that applies to every route (PROMPT §8.5): security headers with a real CSP (no
 * 'unsafe-inline'), HSTS, frame-ancestors 'none', nosniff; a strict CORS allowlist; per-IP rate
 * limits with stricter per-route limits on sign-in and verification; zod at every body; domain
 * errors, never "Something went wrong". None of it is ever shown to a farmer as a badge.
 */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { MessagingAdapter } from '../adapters/messaging/index.js';
import type { PhotoStore, ScanAdapter } from '../adapters/photos/photos.js';
import type { SpeechAdapter } from '../adapters/speech/speech.js';
import type { BuyerRegistryAdapter, FarmerRegistryAdapter } from '../adapters/registry/types.js';
import type { Config } from '../config.js';
import type { Actor, Database } from '../db/actor.js';
import type { Logger } from '../log/logger.js';
import { refreshSession, requestOtp, revokeSession, verifyOtp, type AuthDeps, type SessionTokens } from '../modules/auth/service.js';
import { cropBundle, currentManifest, sharedBundle, type ServedDocument } from '../modules/bundles/store.js';
import { demandFor } from '../modules/demand/service.js';
import { listMine } from '../modules/listings/service.js';
import { getMe } from '../modules/me/service.js';
import { appendChunk, openUpload, PHOTO_LIMITS, readPhoto, type PhotoDeps } from '../modules/photos/service.js';
import { runDemonstrationDesk } from '../modules/deals/desk.js';
import {
  acceptOffer,
  acknowledgeOffer,
  AcknowledgeBody,
  counterOffer,
  CounterBody,
  dealById,
  declineOffer,
  makeOffer,
  myDeals,
  OfferBody,
  saudaSlipOf,
} from '../modules/deals/service.js';
import { createPool, CreateBody, JoinBody, joinPool, leavePool, myPools, OpenQuery, openPools } from '../modules/pools/service.js';
import { parseOutboxEntry } from '../modules/outbox/schema.js';
import { deliverOutboxEntry } from '../modules/outbox/service.js';
import { verifyBuyer, verifyFarmer } from '../modules/verify/service.js';
import type { KeyRing } from '../security/keys.js';
import { signPhotoUrl } from '../security/signed-url.js';
import { verifyAccessToken } from '../security/tokens.js';
import { DomainError, toDomainError } from './errors.js';

export const API_VERSION = '3.0.0';
export const REFRESH_COOKIE = 'fr_rt';
export const CSRF_HEADER = 'x-fasal-csrf';

export interface AppDependencies {
  config: Config;
  logger: Logger;
  /** Absent only in tests that exercise routes with no database behind them. */
  db?: Database;
  keys?: KeyRing;
  messaging?: MessagingAdapter;
  farmerRegistry?: FarmerRegistryAdapter;
  buyerRegistry?: BuyerRegistryAdapter;
  speech?: SpeechAdapter;
  /** Where photographs are spooled and stored, and what scans them (§8.6). */
  photos?: { store: PhotoStore; scanner: ScanAdapter };
  now?: () => Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: (Actor & { sessionId: string }) | null;
  }
}

async function databaseReachable(db: Database | undefined): Promise<boolean> {
  if (db === undefined) return false;
  try {
    await db.pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

const Phone = z.string().trim().min(10).max(20);
const SignupSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('farmer'), displayName: z.string().trim().min(1).max(120), locale: z.enum(['mr', 'hi', 'en', 'bn', 'pa']).default('mr') }),
  z.object({
    kind: z.literal('buyer'),
    businessName: z.string().trim().min(1).max(160),
    place: z.string().trim().min(1).max(80),
    district: z.string().trim().min(1).max(60),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
  }),
  z.object({ kind: z.literal('fpo'), name: z.string().trim().min(1).max(160), district: z.string().trim().min(1).max(60), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
]);

export function buildApp(deps: AppDependencies) {
  const now = deps.now ?? (() => new Date());
  const app = Fastify({
    loggerInstance: deps.logger,
    // Request ids are generated server-side; a client-supplied id is never trusted.
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 256 * 1024,
    trustProxy: false,
  });

  app.decorateRequest('actor', null);

  void app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
  });
  void app.register(cors, { origin: deps.config.CORS_ORIGINS, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT'] });
  void app.register(cookie);
  void app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((error, request, reply) => {
    const domain = toDomainError(error);
    if (domain !== null) {
      if (domain.status >= 500) request.log.error({ err: error }, 'domain error');
      return reply.status(domain.status).send({ error: { code: domain.code, message: domain.message } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      // Fastify's own client errors: malformed JSON, oversized body, rate limit.
      const code = status === 429 ? 'TOO_MANY_REQUESTS' : status === 413 ? 'TOO_LARGE' : 'BAD_REQUEST';
      const message = status === 429 ? 'Too many requests from this device. Please wait a minute and try again.' : 'The request could not be read.';
      return reply.status(status).send({ error: { code, message } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'SERVER_FAULT', message: 'The server could not finish this request. Your data on this phone is safe; please try again shortly.' } });
  });

  // Authentication: a short-lived bearer token. Client checks are UX; this is the security.
  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (deps.keys === undefined || header === undefined || !header.startsWith('Bearer ')) return;
    const verified = verifyAccessToken(deps.keys, header.slice(7), Math.floor(now().getTime() / 1000));
    if (verified.ok) request.actor = { userId: verified.claims.sub, role: verified.claims.role, sessionId: verified.claims.sid };
  });

  const requireActor = (request: FastifyRequest): Actor & { sessionId: string } => {
    if (request.actor === null) throw new DomainError(401, 'SIGN_IN_REQUIRED', 'Please sign in to continue.');
    return request.actor;
  };
  const requireDb = (): Database => {
    if (deps.db === undefined) throw new DomainError(503, 'DATABASE_UNAVAILABLE', 'The server cannot reach its records right now. Prices on your phone still work.');
    return deps.db;
  };
  const authDeps = (): AuthDeps => {
    if (deps.keys === undefined || deps.messaging === undefined) throw new DomainError(503, 'AUTH_UNAVAILABLE', 'Sign-in is not available on this server.');
    return { db: requireDb(), keys: deps.keys, messaging: deps.messaging, now, exposeCodes: deps.config.NODE_ENV !== 'production' };
  };
  const sendSession = (reply: FastifyReply, session: SessionTokens) => {
    void reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: deps.config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60,
    });
    return { accessToken: session.accessToken, sessionId: session.sessionId, user: session.user };
  };

  /**
   * Reachability is measured, not inferred (a lesson from V-2: `navigator.onLine` is true on a
   * captive portal). `no-store` so no cache anywhere can answer on the server's behalf.
   */
  app.get('/api/health', async (_request, reply) => {
    const database = (await databaseReachable(deps.db)) ? 'up' : 'down';
    void reply.header('cache-control', 'no-store');
    return { ok: database === 'up', service: 'fasal-api', version: API_VERSION, database };
  });

  // ── Bundles (PROMPT §5.8): public market data, identical for every farmer, so no sign-in. The
  // body is the canonical JSON the integrity was computed over and the ETag is that integrity, so
  // a phone revalidating an unchanged bundle gets a 304 and spends no bytes.
  const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/);
  const sendDocument = (request: FastifyRequest, reply: FastifyReply, doc: ServedDocument) => {
    void reply.header('etag', doc.etag).header('cache-control', 'no-cache').header('x-bundle-version', doc.version);
    const tags = (request.headers['if-none-match'] ?? '').split(',').map((tag) => tag.trim().replace(/^W\//, ''));
    if (tags.includes(doc.etag) || tags.includes('*')) return reply.status(304).send();
    return reply.type('application/json; charset=utf-8').send(doc.body);
  };

  app.get('/api/bundles/manifest', async (request, reply) => sendDocument(request, reply, await currentManifest(requireDb())));
  app.get('/api/bundles/shared/crops', async (request, reply) => sendDocument(request, reply, await sharedBundle(requireDb(), 'crops')));
  app.get('/api/bundles/shared/msp', async (request, reply) => sendDocument(request, reply, await sharedBundle(requireDb(), 'msp')));
  app.get('/api/bundles/shared/districts', async (request, reply) => sendDocument(request, reply, await sharedBundle(requireDb(), 'districts')));
  app.get('/api/bundles/shared/climatology/:district', async (request, reply) => {
    const { district } = z.object({ district: Slug }).parse(request.params);
    return sendDocument(request, reply, await sharedBundle(requireDb(), `climatology/${district}`));
  });
  app.get('/api/bundles/:crop/:district', async (request, reply) => {
    const { crop, district } = z.object({ crop: Slug, district: Slug }).parse(request.params);
    return sendDocument(request, reply, await cropBundle(requireDb(), crop, district));
  });

  // Demand for the buyer shortlist (FR-09): signed-in only, verified on the phone like a bundle,
  // revalidated by ETag. The phone ranks it against its own lot, which never leaves the phone.
  app.get('/api/demand/:district', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { district } = z.object({ district: Slug }).parse(request.params);
    return sendDocument(request, reply, await demandFor(requireDb(), requireActor(request), district, now()));
  });

  app.post('/api/auth/otp/request', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request) => {
    const body = z.object({ phone: Phone }).parse(request.body);
    return requestOtp(authDeps(), body.phone);
  });

  app.post('/api/auth/otp/verify', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const body = z.object({ phone: Phone, code: z.string().trim().max(6), signup: SignupSchema.optional() }).parse(request.body);
    return sendSession(reply, await verifyOtp(authDeps(), body));
  });

  // Cookie-authenticated, so CSRF-protected: a cross-site form cannot set a custom header, and
  // the strict CORS allowlist refuses the preflight any other origin would need.
  app.post('/api/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request, reply) => {
    if (request.headers[CSRF_HEADER] !== '1') throw new DomainError(403, 'CSRF_HEADER_MISSING', 'This request must come from the Fasal Raksha app.');
    const token = request.cookies[REFRESH_COOKIE];
    if (token === undefined) throw new DomainError(401, 'SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
    return sendSession(reply, await refreshSession(authDeps(), token));
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const actor = requireActor(request);
    await revokeSession(authDeps(), actor.sessionId);
    void reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  app.get('/api/me', async (request) => getMe(requireDb(), requireActor(request)));

  // The drain endpoint for a phone's offline outbox: one entry per request, idempotent under
  // its key. Deal transitions cannot be queued (compile-time) and are refused here too (SEC-09).
  app.get('/api/listings/mine', async (request) => {
    const actor = requireActor(request);
    const keys = deps.keys;
    const sign = keys === undefined ? undefined : (storageKey: string) => signPhotoUrl(keys, storageKey, actor.userId, Math.floor(now().getTime() / 1000));
    return { listings: await listMine(requireDb(), actor, sign) };
  });

  // Photographs (PROMPT §7.8, §8.6): resumable chunked uploads, hardened on arrival, served only
  // through URLs signed for one viewer. A chunk is raw bytes, capped per request.
  const photoDeps = (): PhotoDeps => {
    if (deps.photos === undefined || deps.keys === undefined) throw new DomainError(503, 'PHOTOS_UNAVAILABLE', 'Photographs cannot be received by this server. They stay on your phone.');
    return { db: requireDb(), store: deps.photos.store, scanner: deps.photos.scanner, keys: deps.keys, now, log: deps.logger };
  };
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: PHOTO_LIMITS.chunkBytes }, (_request, body, done) => done(null, body));
  app.post('/api/photos/uploads', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (request) => openUpload(photoDeps(), requireActor(request), request.body));
  app.put('/api/photos/uploads/:id', { config: { rateLimit: { max: 600, timeWindow: '10 minutes' } } }, async (request) => {
    const { id } = request.params as { id: string };
    return appendChunk(photoDeps(), requireActor(request), id, request.headers['upload-offset'], request.body);
  });
  app.get('/api/photos/:storageKey', async (request, reply) => {
    const { storageKey } = request.params as { storageKey: string };
    const photo = await readPhoto(photoDeps(), requireActor(request), storageKey, request.query);
    return reply
      .header('content-type', 'image/jpeg')
      .header('content-disposition', 'attachment; filename="photo.jpg"')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=300')
      .send(photo.bytes);
  });

  // Offline, a farmer's spoken listing is recorded on the phone; on reconnection it is transcribed
  // here to enrich the record (PROMPT §10.2). Raw audio in, text out; nothing is stored.
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_request, body, done) => done(null, body));
  app.post('/api/speech/transcribe', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    requireActor(request);
    if (deps.speech === undefined) throw new DomainError(503, 'SPEECH_UNAVAILABLE', 'Voice is not available on this server. Your recording stays on your phone.');
    const { locale } = z.object({ locale: z.enum(['mr', 'hi', 'en', 'bn', 'pa']) }).parse(request.query);
    const audio = request.body;
    if (!(audio instanceof Buffer) || audio.byteLength === 0) throw new DomainError(422, 'NO_AUDIO', 'The recording was empty.');
    const mimeType = String(request.headers['content-type'] ?? '');
    return deps.speech.transcribe({ audio: new Uint8Array(audio), mimeType, locale });
  });

  app.post('/api/outbox', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const actor = requireActor(request);
    const entry = parseOutboxEntry(request.body);
    const header = request.headers['idempotency-key'];
    const result = await deliverOutboxEntry(requireDb(), actor, entry, typeof header === 'string' ? header : undefined);
    void reply.header('idempotent-replay', result.replayed ? 'true' : 'false');
    // A lot nobody offers on demonstrates nothing: the seeded traders answer it here, through the
    // ordinary offer path (CUTS C-11). Their silence is never the farmer's problem, so a failure
    // is logged and the listing stands.
    if (entry.kind === 'listing.create' && result.status === 201 && !result.replayed) {
      await runDemonstrationDesk(requireDb(), actor, entry.listing.clientId, now()).catch((error: unknown) => {
        request.log.warn({ error: String(error) }, 'the demonstration desk could not place its offers');
      });
    }
    return reply.status(result.status).send(result.body);
  });

  const verifyDeps = () => {
    if (deps.keys === undefined || deps.farmerRegistry === undefined || deps.buyerRegistry === undefined) {
      throw new DomainError(503, 'REGISTRY_UNAVAILABLE', 'Identity verification is not available on this server.');
    }
    return { db: requireDb(), keys: deps.keys, farmers: deps.farmerRegistry, businesses: deps.buyerRegistry };
  };

  // Aggregation (§6.6): a coordinator opens a consignment, and each farmer puts their own
  // opted-in lot into it. The database allows nothing else (migration 0003's policies).
  app.post('/api/pools', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request) => createPool(requireDb(), requireActor(request), CreateBody.parse(request.body)));
  app.get('/api/pools/open', async (request) => ({ pools: await openPools(requireDb(), requireActor(request), OpenQuery.parse(request.query).listing) }));
  app.get('/api/pools/mine', async (request) => ({ pools: await myPools(requireDb(), requireActor(request)) }));
  app.post('/api/pools/:id/join', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    return joinPool(requireDb(), requireActor(request), id, JoinBody.parse(request.body).listingClientId);
  });
  app.post('/api/pools/:id/leave', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    return leavePool(requireDb(), requireActor(request), id, JoinBody.parse(request.body).listingClientId);
  });

  // Offers and the deal they open (§8.9). Every transition is the server's: there is no offline
  // path to one, by type (`OutboxEntry`) and by route (Gate G).
  app.post('/api/offers', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const deal = await makeOffer(requireDb(), requireActor(request), OfferBody.parse(request.body), now());
    return reply.status(201).send(deal);
  });
  const dealId = (request: FastifyRequest) => z.object({ id: z.uuid() }).parse(request.params).id;
  app.post('/api/offers/:id/counter', async (request) => counterOffer(requireDb(), requireActor(request), dealId(request), CounterBody.parse(request.body), now()));
  app.post('/api/offers/:id/accept', async (request) => acceptOffer(requireDb(), requireActor(request), dealId(request), now()));
  app.post('/api/offers/:id/decline', async (request) => declineOffer(requireDb(), requireActor(request), dealId(request), now()));
  app.post('/api/offers/:id/acknowledge', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request) =>
    acknowledgeOffer(requireDb(), requireActor(request), dealId(request), AcknowledgeBody.parse(request.body).reason),
  );
  app.get('/api/deals/mine', async (request) => ({ deals: await myDeals(requireDb(), requireActor(request)) }));
  app.get('/api/deals/:id', async (request) => dealById(requireDb(), requireActor(request), dealId(request)));
  app.get('/api/deals/:id/sauda-slip', async (request) => saudaSlipOf(requireDb(), requireActor(request), dealId(request)));

  app.post('/api/verify/farmer', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const body = z.object({ registry: z.enum(['pm-kisan', 'agristack']), id: z.string().trim().min(5).max(40) }).parse(request.body);
    return verifyFarmer(verifyDeps(), requireActor(request), body.registry, body.id);
  });

  app.post('/api/verify/buyer', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const body = z.object({ method: z.enum(['gstin', 'udyam']), id: z.string().trim().min(5).max(40) }).parse(request.body);
    return verifyBuyer(verifyDeps(), requireActor(request), body.method, body.id);
  });

  return app;
}

export type App = ReturnType<typeof buildApp>;
