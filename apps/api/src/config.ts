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

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().trim().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** The least-privilege application role (NOBYPASSRLS, not an owner). Required, no default. */
  DATABASE_URL: postgresUrl,
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
