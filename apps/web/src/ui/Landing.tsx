/**
 * Landing: Phase 1's hero, steps and language pills, corrected (docs/PHASE1-STUDY.md). No
 * "AI-powered" eyebrow, no glow, no floating stats, no match percentage. The display type keeps
 * its tight tracking for Latin and none for Devanagari. Language is chosen here, before sign-in,
 * and drives everything after it. The steps describe only what works in this build.
 */
import { Glyph, type GlyphName } from '../design/Glyph';
import { t, type Locale } from '../i18n/strings';
import type { Device } from '../state/useDevice';
import { SignIn } from './SignIn';

const LANGUAGES: { id: Locale; name: string }[] = [
  { id: 'mr', name: 'मराठी' },
  { id: 'hi', name: 'हिन्दी' },
  { id: 'en', name: 'English' },
];

const STEPS: { n: 1 | 2 | 3; glyph: GlyphName }[] = [
  { n: 1, glyph: 'mandi' },
  { n: 2, glyph: 'warehouse' },
  { n: 3, glyph: 'field' },
];

export function Landing({ device }: { device: Device }) {
  const { locale } = device;
  return (
    <div className="landing">
      <section aria-labelledby="landing-title">
        <h1 id="landing-title" className="display landing__title">
          {t(locale, 'landing.title')}
        </h1>
        <p className="landing__thesis">{t(locale, 'landing.thesis')}</p>
        <p className="label">{t(locale, 'landing.language')}</p>
        <div className="language-pills" role="group" aria-label={t(locale, 'landing.language')}>
          {LANGUAGES.map((l) => (
            <button key={l.id} type="button" className="language-pill" lang={l.id} aria-pressed={locale === l.id} onClick={() => device.setLocale(l.id)}>
              {l.name}
            </button>
          ))}
        </div>
        <h2 className="visually-hidden">{t(locale, 'landing.how')}</h2>
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.n} className="step">
              <span className="row label">
                <Glyph name={s.glyph} />
                {t(locale, 'step.label', { n: s.n })}
              </span>
              <h3>{t(locale, `step.${s.n}.title`)}</h3>
              <p>{t(locale, `step.${s.n}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>
      <SignIn device={device} />
    </div>
  );
}
