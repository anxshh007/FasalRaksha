/**
 * ARCH-02 · PROMPT §8.5: "PII redaction in logs, with a test that greps the log stream for a
 * seeded phone number and fails if it appears."
 */
import { describe, expect, it } from 'vitest';

import { createLogger } from '../src/log/logger.js';
import { REDACTED, scrubString } from '../src/log/redact.js';

const SEEDED_PHONE = '9876543210';
const SEEDED_FORMS = ['+91 98765 43210', '98765-43210', '09876543210', SEEDED_PHONE];

function capture(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const logger = createLogger({ level: 'trace', destination: { write: (line: string) => void lines.push(line) } });
  return { lines, logger };
}

describe('ARCH-02 · the log stream never carries a seeded phone number', () => {
  it('scrubs it from messages, merge objects, nested values, errors and child bindings', () => {
    const { lines, logger } = capture();
    logger.info(`sending code to ${SEEDED_FORMS[0]}`);
    logger.info({ farmer: { name: 'Sunil Bhosale', phone: SEEDED_FORMS[1] } }, 'registered');
    logger.warn({ deep: { a: { b: { note: `call ${SEEDED_FORMS[2]} after 6pm` } } } }, 'nested');
    logger.error(new Error(`registry lookup failed for ${SEEDED_PHONE}`));
    logger.child({ contact: SEEDED_FORMS[3] }).info('child binding');
    logger.info({ tags: ['x', `${SEEDED_PHONE}`] }, 'array');

    const stream = lines.join('');
    expect(lines).toHaveLength(6);
    for (const form of SEEDED_FORMS) expect(stream).not.toContain(form);
    expect(stream).not.toContain('98765');
    expect(stream).toContain(REDACTED);
  });

  it('censors always-sensitive keys whatever their value looks like', () => {
    const { lines, logger } = capture();
    logger.info({ otp: '482913', auth: { refreshToken: 'rt_abc', password: 'hunter2' }, gstin: 'x' }, 'keys');
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record['otp']).toBe(REDACTED);
    expect(record['auth']).toEqual({ refreshToken: REDACTED, password: REDACTED });
    expect(lines[0]).not.toContain('482913');
    expect(lines[0]).not.toContain('hunter2');
  });

  it('scrubs registry identifiers, GSTIN, Udyam, Aadhaar-shaped numbers and email', () => {
    const scrubbed = scrubString(
      'farmer PMK-MH-1607-09981 · buyer 27AAPFU0939F1ZV · UDYAM-MH-26-0012345 · aadhaar 2345 6789 0123 · mail sunil@example.in',
    );
    expect(scrubbed).not.toMatch(/PMK-MH|27AAPFU0939F1ZV|UDYAM-MH|2345 6789 0123|sunil@example\.in/);
  });

  it('leaves non-personal figures intact — the detector is not vacuous in the other direction', () => {
    const digest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const uuid = '9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b';
    const text = `sha256-${digest} bundle 2026-09-04.1 modal ₹1,840/qtl lot 98765 kg id ${uuid} ts 1758261234567`;
    expect(scrubString(text)).toBe(text);

    const { lines, logger } = capture();
    logger.info({ integrity: `sha256-${digest}` }, 'bundle served');
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record['integrity']).toBe(`sha256-${digest}`);
    expect(typeof record['time']).toBe('number');
  });

  it('logs requests by method, path and status only — never the query string', () => {
    const { lines, logger } = capture();
    logger.info({ req: { id: 'r1', method: 'GET', url: `/api/farmers/lookup?phone=${SEEDED_PHONE}&x=1`, headers: { authorization: 'Bearer abc' } } }, 'incoming');
    const stream = lines.join('');
    expect(stream).not.toContain(SEEDED_PHONE);
    expect(stream).not.toContain('Bearer abc');
    expect(stream).toContain('/api/farmers/lookup');
  });
});
