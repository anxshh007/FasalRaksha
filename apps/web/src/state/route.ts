/**
 * Three places in this build: home, sell, and the farmer's own listings. Hash routes, so the
 * phone's back button works, a reload keeps the place, and the service worker serves one shell
 * for all of them.
 */
import { useEffect, useState } from 'react';

export type Route = 'home' | 'sell' | 'deals';

const ROUTES: readonly Route[] = ['home', 'sell', 'deals'];

function current(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(hash) ? (hash as Route) : 'home';
}

export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const go = (next: Route) => {
    window.location.hash = next === 'home' ? '' : `/${next}`;
    setRoute(next);
    window.scrollTo({ top: 0 });
  };
  return [route, go];
}

export const href = (route: Route) => (route === 'home' ? '#' : `#/${route}`);
