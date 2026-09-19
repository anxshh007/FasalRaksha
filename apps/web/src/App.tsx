/**
 * Application root. Which screen shows is decided by the device's session state, and none of
 * the three states needs a network to render: a farmer who was signed in stays signed in
 * offline (PROMPT §XI), and home is computed from the device store.
 *
 * P9 ports the Phase-1 design system onto this skeleton. Until then the styling is deliberately
 * plain, with none of the rounded, glowing card language PART IX forbids.
 */
import { t } from './i18n/strings';
import { useDevice } from './state/useDevice';
import { FieldStrip } from './ui/FieldStrip';
import { Home } from './ui/Home';
import { SignIn, VerifyFarmer } from './ui/SignIn';

export function App() {
  const device = useDevice();
  const { locale, session } = device;
  const signedIn = session !== null && session.status !== 'signed-out';

  return (
    <div className="app" lang={locale}>
      <FieldStrip device={device} />
      <header className="masthead">
        <h1>{t(locale, 'app.name')}</h1>
        <div className="masthead__actions">
          <button type="button" className="link" onClick={() => device.setLocale(locale === 'mr' ? 'en' : 'mr')} lang={locale === 'mr' ? 'en' : 'mr'}>
            {t(locale, 'lang.switch')}
          </button>
          {signedIn && (
            <button type="button" className="link" onClick={() => void device.signOut()}>
              {t(locale, 'home.signOut')}
            </button>
          )}
        </div>
      </header>
      <main data-testid="screen" data-session={session?.status ?? 'booting'}>
        {session === null ? null : session.status === 'signed-out' ? (
          <>
            <p className="tagline">{t(locale, 'app.tagline')}</p>
            <SignIn device={device} />
          </>
        ) : session.profile.district === null ? (
          <VerifyFarmer device={device} />
        ) : (
          <Home device={device} />
        )}
      </main>
    </div>
  );
}
