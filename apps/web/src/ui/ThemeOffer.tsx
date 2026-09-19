/**
 * The FIELD theme is offered prominently on first run, and suggested once if the light sensor
 * reports direct sun (PROMPT §9.3). Never switched without asking.
 */
import { Glyph } from '../design/Glyph';
import { t } from '../i18n/strings';
import type { Device } from '../state/useDevice';

export function ThemeOffer({ device }: { device: Device }) {
  const { locale, themeOffer, theme } = device;
  if (themeOffer === null || theme === 'field') return null;
  return (
    <div className="notice" role="region" aria-label={t(locale, 'spine.theme')} data-testid="theme-offer">
      <Glyph name="sun" />
      <div className="stack" style={{ gap: 'var(--space-2)' }}>
        <span>{t(locale, themeOffer === 'bright-light' ? 'theme.bright' : 'theme.offer')}</span>
        <div className="row">
          <button type="button" className="btn" onClick={() => device.setTheme('field')}>
            {t(locale, 'theme.useField')}
          </button>
          <button type="button" className="btn btn--quiet" onClick={device.dismissThemeOffer}>
            {t(locale, 'theme.keepNight')}
          </button>
        </div>
      </div>
    </div>
  );
}
