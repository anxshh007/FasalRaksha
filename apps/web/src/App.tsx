/**
 * Application root: the record spine beside a stage that carries the field-mode strip, the
 * navigation and the screen. Which screen shows is decided by the device's session state, and
 * none of the three states needs a network to render: a farmer who was signed in stays signed
 * in offline (PROMPT §XI), and home is computed from the device store.
 *
 * Navigation is §9.7's four: HOME · SELL · BUYERS · MY DEALS. No link ever leads to a page that
 * does not exist.
 */
import { lazy, Suspense } from 'react';

import { Glyph } from './design/Glyph';
import { t } from './i18n/strings';
import type { Preferences } from './state/preferences';
import { href, useRoute, type Route } from './state/route';

/** §14.4: lazy, so a farmer's phone never downloads the diagnostics it will never open. */
const JudgeScreen = lazy(() => import('./judge/JudgeScreen').then((m) => ({ default: m.JudgeScreen })));
import { useDevice } from './state/useDevice';
import { BuyersScreen } from './match/BuyersScreen';
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
  const [route, go, detail] = useRoute();
  const signedIn = session !== null && session.status !== 'signed-out';
  const verified = signedIn && session.profile.district !== null;
  const nav: { route: Route; glyph: 'home' | 'sell' | 'buyers' | 'deals'; label: 'nav.home' | 'nav.sell' | 'nav.buyers' | 'nav.deals' }[] = [
    { route: 'home', glyph: 'home', label: 'nav.home' },
    { route: 'sell', glyph: 'sell', label: 'nav.sell' },
    { route: 'buyers', glyph: 'buyers', label: 'nav.buyers' },
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
            {/* Judge Mode (§14.4) answers before the session does: a judge at a demonstration
                has no account, and the diagnostics are nobody's personal data. */}
            {route === '_judge' ? (
              <Suspense fallback={<p className="muted">Loading diagnostics</p>}>
                <JudgeScreen device={device} />
              </Suspense>
            ) : session === null ? null : session.status === 'signed-out' ? (
              <Landing device={device} />
            ) : session.profile.district === null ? (
              <VerifyFarmer device={device} />
            ) : route === 'sell' ? (
              <SellScreen device={device} onListed={() => go('deals')} />
            ) : route === 'buyers' ? (
              <BuyersScreen key={detail ?? 'buyers'} device={device} listingClientId={detail} onHome={() => go('home')} />
            ) : route === 'deals' ? (
              <ListingsScreen device={device} onSell={() => go('sell')} onBuyers={(clientId) => go('buyers', clientId)} />
            ) : (
              <Home device={device} onBuyers={() => go('buyers')} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
