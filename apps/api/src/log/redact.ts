/**
 * ARCH-02 · personal data never reaches an ordinary log (PROMPT §8.5).
 *
 * Two layers, because either alone leaks:
 *
 *  1. Path redaction — fields that are *always* sensitive (`phone`, `registryId`, auth headers,
 *     request bodies) are censored wherever they appear, whatever their value looks like.
 *  2. Value scrubbing — a phone number interpolated into a message string, or nested somewhere
 *     no path anticipated, is still a phone number. Every string that reaches the logger is
 *     scanned for the identifier shapes this product handles and those spans are replaced.
 *
 * The patterns are anchored on non-alphanumeric boundaries so that a digit run inside a
 * SHA-256 digest, a UUID or a bundle version is not mistaken for a mobile number — a detector
 * that fires on everything is as useless as one that fires on nothing, and the tests assert
 * both directions.
 */

export const REDACTED = '[redacted]';

/** Field names that are censored wherever they occur in a log object. */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'phone',
  'mobile',
  'msisdn',
  'contact',
  'email',
  'registryId',
  'farmerRegistryId',
  'pmKisanId',
  'agriStackId',
  'gstin',
  'udyam',
  'aadhaar',
  'otp',
  'password',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'set-cookie',
]);

const BOUNDARY_BEFORE = '(?<![0-9A-Za-z])';
const BOUNDARY_AFTER = '(?![0-9A-Za-z])';

/** Identifier shapes scrubbed from any string value. Order matters: most specific first. */
const PII_PATTERNS: readonly RegExp[] = [
  // GSTIN: 2-digit state code, PAN, entity number, 'Z', checksum.
  new RegExp(`${BOUNDARY_BEFORE}\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]${BOUNDARY_AFTER}`, 'g'),
  // Udyam registration number.
  new RegExp(`${BOUNDARY_BEFORE}UDYAM-[A-Z]{2}-\\d{2}-\\d{7}${BOUNDARY_AFTER}`, 'gi'),
  // PM-KISAN style registry identifier used by the farmer registry (PMK-MH-1607-09981).
  new RegExp(`${BOUNDARY_BEFORE}PMK-[A-Z]{2}-\\d{4}-\\d{5}${BOUNDARY_AFTER}`, 'gi'),
  // Email addresses.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // Aadhaar-shaped 12-digit numbers (first digit 2-9), optionally grouped in fours.
  new RegExp(`${BOUNDARY_BEFORE}[2-9]\\d{3}[ -]?\\d{4}[ -]?\\d{4}${BOUNDARY_AFTER}`, 'g'),
  // Indian mobile numbers, with or without +91 / 0 prefix and a mid-number space or dash.
  new RegExp(`${BOUNDARY_BEFORE}(?:\\+?91[ -]?|0)?[6-9]\\d{4}[ -]?\\d{5}${BOUNDARY_AFTER}`, 'g'),
];

/** Replace every PII-shaped span in a string. */
export function scrubString(value: string): string {
  let out = value;
  for (const pattern of PII_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/**
 * Return a deep copy of `value` with sensitive keys censored and every string scrubbed.
 * Cycles are cut rather than followed; errors are flattened to their name, message and stack
 * so that a thrown `Error` carrying a phone number in its message is scrubbed too.
 */
export function scrubPii(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Error) {
    const flat: Record<string, unknown> = { type: value.name, message: scrubString(value.message) };
    if (value.stack !== undefined) flat['stack'] = scrubString(value.stack);
    for (const [key, inner] of Object.entries(value)) {
      flat[key] = SENSITIVE_KEYS.has(key) ? REDACTED : scrubPii(inner, seen);
    }
    return flat;
  }
  if (Array.isArray(value)) return value.map((item) => scrubPii(item, seen));
  // Only plain data is walked. Class instances (a Node request, a socket, a Buffer) are left
  // for pino's serializers, whose output is scrubbed as text at the destination instead.
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : scrubPii(inner, seen);
  }
  return out;
}
