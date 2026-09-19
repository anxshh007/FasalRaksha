/**
 * Three places in this build: home, sell, and the farmer's own listings. Hash routes, so the
 * phone's back button works, a reload keeps the place, and the service worker serves one shell
 * for all of them.
 *
 * The camera is a step inside "sell" (`#/sell/photo`), so the back button closes it, and closing
 * it, by any route, turns the camera off. It is opened only by a tap (CAM-06: a user gesture);
 * a reload onto `#/sell/photo` lands on the sell screen with the camera closed.
 */
import { useEffect, useState } from 'react';

export type Route = 'home' | 'sell' | 'deals';

const ROUTES: readonly Route[] = ['home', 'sell', 'deals'];
const CAMERA_HASH = '#/sell/photo';

function current(): Route {
  const top = window.location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';
  return (ROUTES as readonly string[]).includes(top) ? (top as Route) : 'home';
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
