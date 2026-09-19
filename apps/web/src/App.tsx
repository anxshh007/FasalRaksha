/**
 * Application root: the record spine beside a stage that carries the field-mode strip, the
 * navigation and the screen. Which screen shows is decided by the device's session state, and
 * none of the three states needs a network to render: a farmer who was signed in stays signed
 * in offline (PROMPT §XI), and home is computed from the device store.
 *
 * Navigation carries only what this build can do. HOME now; SELL, BUYERS and MY DEALS join it
 * as their phases land (§9.7), never as links to pages that do not exist yet.
 */
import { Glyph } from './design/Glyph';
import { t } from './i18n/strings';
import type { Preferences } from './state/preferences';
import { useDevice } from './state/useDevice';
import { FieldStrip } from './ui/FieldStrip';
import { Home } from './ui/Home';
import { Landing } from './ui/Landing';
import { VerifyFarmer } from './ui/SignIn';
import { Spine } from './ui/Spine';
import { ThemeOffer } from './ui/ThemeOffer';

export function App({ preferences }: { preferences: Preferences }) {
  const device = useDevice(preferences);
  const { locale, session } = device;
  const signedIn = session !== null && session.status !== 'signed-out';

  return (
    <div className="shell">
      <Spine device={device} />
      <div className="stage">
        <FieldStrip device={device} />
        <div className="content">
          <ThemeOffer device={device} />
          {signedIn && (
            <nav className="nav" aria-label={t(locale, 'nav.label')} style={{ marginTop: 'var(--space-4)' }}>
              <a className="nav-pill" href="/" aria-current="page">
                <Glyph name="home" />
                {t(locale, 'nav.home')}
              </a>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn--quiet" onClick={() => void device.signOut()}>
                {t(locale, 'home.signOut')}
              </button>
            </nav>
          )}
          <main data-testid="screen" data-session={session?.status ?? 'booting'} style={{ marginTop: signedIn ? 0 : 'var(--space-5)' }}>
            {session === null ? null : session.status === 'signed-out' ? (
              <Landing device={device} />
            ) : session.profile.district === null ? (
              <VerifyFarmer device={device} />
            ) : (
              <Home device={device} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
