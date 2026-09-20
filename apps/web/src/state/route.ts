/**
 * Four places (§9.7): home, sell, buyers and the farmer's own listings. Hash routes, so the
 * phone's back button works, a reload keeps the place, and the service worker serves one shell
 * for all of them. `#/buyers/<listing>` opens the shortlist for one listing.
 *
 * The camera is a step inside "sell" (`#/sell/photo`), so the back button closes it, and closing
 * it, by any route, turns the camera off. It is opened only by a tap (CAM-06: a user gesture);
 * a reload onto `#/sell/photo` lands on the sell screen with the camera closed.
 *
 * `#/_judge` is a fifth place that is not one of the four: Judge Mode (§14.4). It is reachable
 * only by typing it, lazy-loaded when it is, and deliberately absent from the navigation — a test
 * asserts that nothing in the farmer interface links to it.
 */
import { useEffect, useState } from 'react';

export type Route = 'home' | 'sell' | 'buyers' | 'deals' | '_judge';

/** The four places in the navigation. Judge Mode is a route, never a destination on screen. */
const ROUTES: readonly Route[] = ['home', 'sell', 'buyers', 'deals', '_judge'];
const CAMERA_HASH = '#/sell/photo';

function segments(): string[] {
  return window.location.hash.replace(/^#\/?/, '').split('/');
}

function current(): Route {
  const top = segments()[0] ?? '';
  return (ROUTES as readonly string[]).includes(top) ? (top as Route) : 'home';
}

/** The segment after the route, e.g. the listing in `#/buyers/<listing>`; null if none. */
function param(): string | null {
  if (current() !== 'buyers') return null;
  const second = segments()[1];
  return second === undefined || second === '' ? null : decodeURIComponent(second);
}

export function useRoute(): [Route, (next: Route, detail?: string) => void, string | null] {
  const [route, setRoute] = useState<Route>(current);
  const [detail, setDetail] = useState<string | null>(param);
  useEffect(() => {
    const onChange = () => {
      setRoute(current());
      setDetail(param());
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const go = (next: Route, extra?: string) => {
    window.location.hash = next === 'home' ? '' : `/${next}${extra === undefined ? '' : `/${encodeURIComponent(extra)}`}`;
    setRoute(next);
    setDetail(extra ?? null);
    window.scrollTo({ top: 0 });
  };
  return [route, go, detail];
}

export const href = (route: Route) => (route === 'home' ? '#' : `#/${route}`);

/** Whether the camera step is open; opening pushes a history entry, closing steps back over it. */
export function useCameraRoute(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    if (window.location.hash === CAMERA_HASH) window.history.replaceState(null, '', '#/sell');
    return false;
  });
  useEffect(() => {
    const onChange = () => setOpen(window.location.hash === CAMERA_HASH);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const set = (next: boolean) => {
    if (next && window.location.hash !== CAMERA_HASH) window.location.hash = '/sell/photo';
    if (!next && window.location.hash === CAMERA_HASH) window.history.back();
    setOpen(next);
  };
  return [open, set];
}
