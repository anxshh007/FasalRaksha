/**
 * The record spine (PROMPT §9.6): a persistent full-height rail carrying district · language ·
 * theme · sync state · as-of date. On a phone it becomes a band across the top. Each item is a
 * 44px target; the two choices (language, theme) are buttons, the rest are readings.
 */
import { Glyph } from '../design/Glyph';
import { shortDay, t } from '../i18n/strings';
import type { Device } from '../state/useDevice';


export function Spine({ device }: { device: Device }) {
  const { locale, theme, reach, briefing, session } = device;
  const signedIn = session !== null && session.status !== 'signed-out';
  const districtName = briefing?.districtNames ? (locale === 'mr' ? briefing.districtNames.mr : briefing.districtNames.en) : signedIn ? session.profile.district : null;
  const asOf = briefing?.crops.map((c) => c.benchmark.asOf).sort().at(-1) ?? null;
  const state = reach === null ? 'checking' : reach.reachable ? 'live' : 'field';

  return (
    <aside className="spine" aria-label={t(locale, 'app.name')} data-testid="spine">
      <span className="spine__item spine__brand" title={t(locale, 'app.name')}>
        <Glyph name="sprout" size={24} label={t(locale, 'app.name')} />
      </span>
      {districtName !== null && (
        <span className="spine__item" data-testid="spine-district" title={t(locale, 'spine.district')}>
          <Glyph name="mandi" />
          <span>{districtName}</span>
        </span>
      )}
      <button type="button" className="spine__item" onClick={() => device.setLocale(locale === 'mr' ? 'en' : 'mr')} aria-label={t(locale, 'spine.language')} data-testid="spine-language">
        <Glyph name="language" />
        <span lang={locale === 'mr' ? 'en' : 'mr'}>{locale === 'mr' ? 'EN' : 'मरा'}</span>
      </button>
      <button
        type="button"
        className="spine__item"
        onClick={() => device.setTheme(theme === 'night' ? 'field' : 'night')}
        aria-label={`${t(locale, 'spine.theme')}: ${t(locale, theme === 'night' ? 'theme.night' : 'theme.field')}`}
        aria-pressed={theme === 'field'}
        data-testid="spine-theme"
      >
        <Glyph name={theme === 'night' ? 'moon' : 'sun'} />
        <span>{t(locale, theme === 'night' ? 'theme.night' : 'theme.field')}</span>
      </button>
      <span className="spine__item" data-testid="spine-sync" data-state={state}>
        <Glyph name={state === 'field' ? 'field' : 'signal'} />
        <span>{t(locale, state === 'live' ? 'strip.live' : state === 'field' ? 'strip.field' : 'strip.checking')}</span>
      </span>
      {asOf !== null && (
        <span className="spine__item" title={t(locale, 'spine.asOf')} data-testid="spine-asof">
          <span className="figure">{shortDay(locale, asOf)}</span>
        </span>
      )}
      <span className="spine__item spine__spacer" aria-hidden="true" />
    </aside>
  );
}
