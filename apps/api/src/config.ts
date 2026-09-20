/**
 * ARCH-04 · configuration is parsed, never cast (PROMPT §8.5: zod at every boundary).
 *
 * The environment is the one boundary every other boundary depends on, so it is parsed first
 * and the process refuses to start on anything it cannot make sense of. No secret has a
 * default: a missing `DATABASE_URL` is an operator error to be reported, not a gap to be
 * papered over with a localhost string that happens to work on one laptop.
 */
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const postgresUrl = z
  .string()
  .trim()
  .refine((value) => /^postgres(ql)?:\/\/[^\s]+$/.test(value), {
    message: 'must be a postgres:// or postgresql:// connection string',
  });

const adapterMode = z.enum(['mock', 'live']).default('mock');
const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value));
const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value))
  .pipe(z.url().optional());

/**
 * A live adapter with a missing credential is a configuration error, reported at boot — never a
 * silent fall back to the mock, and never a screen that claims a live connection (Constitution §15).
 */
const LIVE_REQUIREMENTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['MARKET_ADAPTER', ['MARKET_API_KEY']],
  ['REGISTRY_ADAPTER', ['REGISTRY_GATEWAY_URL', 'REGISTRY_GATEWAY_KEY']],
  ['MESSAGING_ADAPTER', ['SMS_GATEWAY_URL', 'SMS_GATEWAY_KEY', 'SMS_TEMPLATE_ID']],
  ['SPEECH_ADAPTER', ['BHASHINI_URL', 'BHASHINI_KEY', 'BHASHINI_SERVICE_IDS']],
  ['MODEL_FALLBACK_ADAPTER', ['MODEL_FALLBACK_KEY']],
  ['STORAGE_ADAPTER', ['LOGISTICS_GATEWAY_URL', 'LOGISTICS_GATEWAY_KEY']],
  ['TRANSPORT_ADAPTER', ['LOGISTICS_GATEWAY_URL', 'LOGISTICS_GATEWAY_KEY']],
];

const BaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().trim().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** The least-privilege application role (NOBYPASSRLS, not an owner). Required, no default. */
  DATABASE_URL: postgresUrl,
  /**
   * Shared only with the database (app_private.context_key): signs each transaction's actor so
   * row-level security cannot be fed a forged identity. 32 bytes, hex. Required, no default.
   */
  DB_CONTEXT_KEY: z.string().regex(/^[0-9a-f]{64,}$/i, 'must be at least 32 bytes of hex'),
  /** The API's own secret: token signing, phone and registry-id hashing, row MACs. 32 bytes, hex. */
  AUTH_SECRET: z.string().regex(/^[0-9a-f]{64,}$/i, 'must be at least 32 bytes of hex'),
  // ── Adapters (PROMPT §3.4): mock | live, switched here and nowhere else. ────────────────
  MARKET_ADAPTER: adapterMode,
  MARKET_API_KEY: optionalSecret,
  /** OGD resource id of the daily mandi price dataset (not a secret). */
  MARKET_RESOURCE_ID: z.string().trim().default('9ef84268-d588-465a-a308-a864a43d0070'),
  /** The synthetic Agmarknet-shaped file the mock serves (repository-relative). */
  MARKET_MOCK_FILE: z.string().trim().default('data/raw/agmarknet_synthetic.csv'),
  WEATHER_ADAPTER: adapterMode,
  REGISTRY_ADAPTER: adapterMode,
  REGISTRY_GATEWAY_URL: optionalUrl,
  REGISTRY_GATEWAY_KEY: optionalSecret,
  MESSAGING_ADAPTER: adapterMode,
  SMS_GATEWAY_URL: optionalUrl,
  SMS_GATEWAY_KEY: optionalSecret,
  SMS_TEMPLATE_ID: optionalSecret,
  SPEECH_ADAPTER: adapterMode,
  BHASHINI_URL: optionalUrl,
  BHASHINI_KEY: optionalSecret,
  /** JSON map of locale → Bhashini ASR service id, e.g. {"mr":"…","hi":"…"}. */
  BHASHINI_SERVICE_IDS: optionalSecret,
  MODEL_FALLBACK_ADAPTER: adapterMode,
  /** The hosted language model's credential, and optionally which model to ask. */
  MODEL_FALLBACK_KEY: optionalSecret,
  MODEL_FALLBACK_MODEL: optionalSecret,
  STORAGE_ADAPTER: adapterMode,
  TRANSPORT_ADAPTER: adapterMode,
  LOGISTICS_GATEWAY_URL: optionalUrl,
  LOGISTICS_GATEWAY_KEY: optionalSecret,
  /**
   * Where photographs are spooled and stored (repository-relative or absolute). The local disk
   * is the demonstration store; an object store implements the same PhotoStore interface.
   */
  PHOTO_STORE_DIR: z.string().trim().min(1).default('data/uploads'),
  /**
   * Shared with the WhatsApp/SMS/IVR gateway; every inbound webhook presents it (PART XII). No
   * default: unset means those endpoints are closed, which is the safe way for them to fail.
   */
  CHANNEL_SECRET: optionalSecret,
  /**
   * Where the built PWA is, when this process is to serve it as well (`apps/web/dist`). The phone
   * fetches `/api/…` relatively and its refresh cookie is scoped to `/api/auth`, so the app and
   * its API belong on one origin; setting this is the simplest way to give them one. Unset, the
   * API serves only `/api` and something else serves the files.
   */
  WEB_DIST_DIR: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  /** Strict CORS allowlist, comma-separated origins. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .pipe(z.array(z.string().regex(/^https?:\/\/[^\s/]+$/, 'must be an origin like https://host:port, with no path'))),
});

const EnvSchema = BaseSchema.superRefine((env, ctx) => {
  const record = env as unknown as Record<string, unknown>;
  for (const [modeKey, required] of LIVE_REQUIREMENTS) {
    if (record[modeKey] !== 'live') continue;
    for (const key of required) {
      if (record[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: `is required when ${modeKey}=live` });
    }
  }
});

export type Config = z.infer<typeof EnvSchema>;
export type LogLevel = (typeof LOG_LEVELS)[number];

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`The API cannot start because its configuration is incomplete:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** Parse the process environment. Throws `ConfigError` naming every problem at once. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  // Name the variable and the problem — never echo the value, which may be a credential.
  const problems = parsed.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(environment)';
    return issue.code === 'invalid_type' && env[key] === undefined ? `${key} is not set` : `${key} ${issue.message}`;
  });
  throw new ConfigError(problems);
}
