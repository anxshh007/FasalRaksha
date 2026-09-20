/**
 * Weather as one operational sentence (PROMPT §XIII).
 *
 *   ⛆ Rain expected Tuesday in Nashik. Onion is moisture-sensitive. Move the lot within 48 hours.
 *
 * Not a forecast screen, not a chart, not a five-day strip: a farmer standing in a field wants to
 * know whether to move the lot today. `weatherUrgency` decides that from published millimetres
 * and the crop's own sensitivity; this renders its answer and nothing else. When the forecast is
 * older than the engine will stand behind, or there is none, this renders nothing at all rather
 * than a reassuring silence dressed as a clear sky.
 */
import type { WeatherUrgency } from '@fasal/shared';

import { Glyph } from '../design/Glyph';
import { number, shortDay, t, type Locale } from '../i18n/strings';
import { Tx } from '../i18n/Tx';

export function WeatherLine({
  locale,
  urgency,
  cropName,
  districtName,
  source,
}: {
  locale: Locale;
  urgency: WeatherUrgency;
  cropName: string;
  districtName: string;
  source: string | null;
}) {
  if (urgency.level === 'none' || urgency.day === null) return null;
  const key = urgency.reason === 'humid' ? 'weather.humid' : urgency.level === 'move' ? 'weather.move' : 'weather.watch';
  return (
    <p
      className={`weather weather--${urgency.level}`}
      data-testid="weather-urgency"
      data-level={urgency.level}
      data-reason={urgency.reason}
      data-day={urgency.day}
      data-hours={urgency.hoursToAct ?? ''}
    >
      <Glyph name={urgency.reason === 'humid' ? 'rain' : 'rain'} size={16} />
      <span>
        <Tx
          locale={locale}
          k={key}
          values={{
            day: shortDay(locale, urgency.day),
            district: districtName,
            crop: cropName,
            hours: number(locale, urgency.hoursToAct ?? 0),
          }}
          words={['day', 'district', 'crop']}
        />
        {/* A seasonal pattern is not a forecast, and the screen says so where it is one. */}
        {source !== null && source.startsWith('mock') && <span className="muted"> {t(locale, 'weather.demonstration')}</span>}
      </span>
    </p>
  );
}
