/**
 * Application root: the record spine beside a stage that carries the field-mode strip, the
 * navigation and the screen. Which screen shows is decided by the device's session state, and
 * none of the three states needs a network to render: a farmer who was signed in stays signed
 * in offline (PROMPT §XI), and home is computed from the device store.
 *
 * Navigation carries only what this build can do: HOME · SELL · MY DEALS now; BUYERS joins
 * when the shortlist lands (§9.7). No link ever leads to a page that does not exist yet.
 */
import { Glyph } from './design/Glyph';
import { t } from './i18n/strings';
import type { Preferences } from './state/preferences';
import { href, useRoute, type Route } from './state/route';
import { useDevice } from './state/useDevice';
import { ListingsScreen } from './sell/ListingsScreen';
import { SellScreen } from './sell/SellScreen';
import { FieldStrip } from './ui/FieldStrip';
import { Home } from './ui/Home';
import { Landing } from './ui/Landing';
import { VerifyFarmer } from './ui/SignIn';
import { Spine } from './ui/Spine';
import { ThemeOffer } from './ui/ThemeOffer';

export function App({ preferences }: { preferences: Preferences }) {
  const device = useDevice(preferences);
  const { locale, session } = device;
  const [route, go] = useRoute();
  const signedIn = session !== null && session.status !== 'signed-out';
  const verified = signedIn && session.profile.district !== null;
  const nav: { route: Route; glyph: 'home' | 'sell' | 'deals'; label: 'nav.home' | 'nav.sell' | 'nav.deals' }[] = [
    { route: 'home', glyph: 'home', label: 'nav.home' },
    { route: 'sell', glyph: 'sell', label: 'nav.sell' },
    { route: 'deals', glyph: 'deals', label: 'nav.deals' },
  ];

  return (
    <div className="shell">
      <Spine device={device} />
      <div className="stage">
        <FieldStrip device={device} />
        <div className="content">
          <ThemeOffer device={device} />
          {signedIn && (
            <nav className="nav" aria-label={t(locale, 'nav.label')} style={{ marginTop: 'var(--space-4)' }}>
              {verified &&
                nav.map((item) => (
                  <a
                    key={item.route}
                    className="nav-pill"
                    href={href(item.route)}
                    aria-current={route === item.route ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      go(item.route);
                    }}
                    data-testid={`nav-${item.route}`}
                  >
                    <Glyph name={item.glyph} />
                    {t(locale, item.label)}
                  </a>
                ))}
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
            ) : route === 'sell' ? (
              <SellScreen device={device} onListed={() => go('deals')} />
            ) : route === 'deals' ? (
              <ListingsScreen device={device} onSell={() => go('sell')} />
            ) : (
              <Home device={device} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
