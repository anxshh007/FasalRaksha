/**
 * The field-mode strip (PROMPT §9.9-6): offline is a designed, permanent part of the chrome,
 * not an alarm. In DM Mono, calm, with the time the server was last reached and what is waiting
 * to be sent. "FIELD MODE · LAST SYNC 18 SEP" rather than "NETWORK ERROR!!!".
 */
import { Glyph } from '../design/Glyph';
import { shortTime, t, type Locale } from '../i18n/strings';
import type { Device } from '../state/useDevice';

function when(locale: Locale, epochMs: number, now: number): string {
  const sameDay = new Date(epochMs + 19_800_000).toISOString().slice(0, 10) === new Date(now + 19_800_000).toISOString().slice(0, 10);
  return shortTime(locale, epochMs, sameDay);
}

export function FieldStrip({ device }: { device: Device }) {
  const { locale, reach, queue } = device;
  const state = reach === null ? 'checking' : reach.reachable ? 'live' : 'field';
  const now = reach?.checkedAt ?? Date.now();
  return (
    <div className={`field-strip field-strip--${state}`} role="status" aria-live="polite" data-testid="field-strip" data-state={state}>
      <span className="field-strip__state">
        <Glyph name={state === 'field' ? 'field' : 'signal'} />
        {t(locale, state === 'live' ? 'strip.live' : state === 'field' ? 'strip.field' : 'strip.checking')}
      </span>
      {reach !== null && (
        <>
          <span className="field-strip__sep" aria-hidden="true">
            ·
          </span>
          <span data-testid="strip-last-sync">{reach.lastReachedAt === null ? t(locale, 'strip.never') : t(locale, 'strip.lastSync', { time: when(locale, reach.lastReachedAt, now) })}</span>
        </>
      )}
      {state === 'field' && <span className="visually-hidden">{t(locale, 'strip.explain')}</span>}
      {queue !== null && queue.waiting > 0 && (
        <span className="field-strip__queue" data-testid="queue-waiting">
          {t(locale, 'strip.waiting', { n: queue.waiting })}
        </span>
      )}
    </div>
  );
}
