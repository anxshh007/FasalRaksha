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
import type { BuyerRegistryAdapter, FarmerRegistryAdapter } from '../adapters/registry/types.js';
import type { Config } from '../config.js';
import type { Actor, Database } from '../db/actor.js';
import type { Logger } from '../log/logger.js';
import { refreshSession, requestOtp, revokeSession, verifyOtp, type AuthDeps, type SessionTokens } from '../modules/auth/service.js';
import { cropBundle, currentManifest, sharedBundle, type ServedDocument } from '../modules/bundles/store.js';
import { getMe } from '../modules/me/service.js';
import { verifyBuyer, verifyFarmer } from '../modules/verify/service.js';
import type { KeyRing } from '../security/keys.js';
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
  void app.register(cors, { origin: deps.config.CORS_ORIGINS, credentials: true, methods: ['GET', 'POST', 'PATCH'] });
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
  app.get('/api/bundles/shared/climatology/:district', async (request, reply) => {
    const { district } = z.object({ district: Slug }).parse(request.params);
    return sendDocument(request, reply, await sharedBundle(requireDb(), `climatology/${district}`));
  });
  app.get('/api/bundles/:crop/:district', async (request, reply) => {
    const { crop, district } = z.object({ crop: Slug, district: Slug }).parse(request.params);
    return sendDocument(request, reply, await cropBundle(requireDb(), crop, district));
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

  const verifyDeps = () => {
    if (deps.keys === undefined || deps.farmerRegistry === undefined || deps.buyerRegistry === undefined) {
      throw new DomainError(503, 'REGISTRY_UNAVAILABLE', 'Identity verification is not available on this server.');
    }
    return { db: requireDb(), keys: deps.keys, farmers: deps.farmerRegistry, businesses: deps.buyerRegistry };
  };

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
