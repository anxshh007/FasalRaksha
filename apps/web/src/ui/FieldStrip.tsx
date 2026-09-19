/**
 * The field-mode strip: offline is a designed, permanent part of the chrome, not an alarm
 * (PROMPT §9.9 signature element 6). P9 gives it its final form; this is its behaviour.
 */
import { clock, t } from '../i18n/strings';
import type { Device } from '../state/useDevice';

export function FieldStrip({ device }: { device: Device }) {
  const { locale, reach, queue } = device;
  const state = reach === null ? 'checking' : reach.reachable ? 'live' : 'field';
  return (
    <div className={`field-strip field-strip--${state}`} role="status" aria-live="polite" data-testid="field-strip" data-state={state}>
      <span>{state === 'checking' ? t(locale, 'field.checking') : state === 'live' ? t(locale, 'field.live') : t(locale, 'field.offline')}</span>
      {state === 'field' && (
        <span className="field-strip__detail">
          {reach?.lastReachedAt ? t(locale, 'field.lastReached', { time: clock(locale, reach.lastReachedAt) }) : t(locale, 'field.never')}
        </span>
      )}
      {queue !== null && queue.waiting > 0 && (
        <span className="field-strip__detail" data-testid="queue-waiting">
          {t(locale, 'field.waiting', { n: queue.waiting })}
        </span>
      )}
    </div>
  );
}
