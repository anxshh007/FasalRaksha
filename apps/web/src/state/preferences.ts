/**
 * Language and theme: the two choices in the record spine (PROMPT §9.3, §10.1). Stored on the
 * device, read before the first render so a FIELD user never sees a NIGHT flash, and applied at
 * the document root so `lang` switches with the locale (§9.10) and the theme with the choice.
 *
 * NIGHT is the default. FIELD is offered prominently on first run. When the ambient light
 * sensor reports direct sun it is suggested once. The theme is never switched without asking.
 */
import type { Locale } from '../i18n/strings';
import { store } from '../offline/db';

export type Theme = 'night' | 'field';

export interface Preferences {
  locale: Locale;
  theme: Theme;
  /** Whether the first-run FIELD offer has been answered (either way). */
  themeChosen: boolean;
  /** Whether a bright-light suggestion has already been made. */
  lightSuggested: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { locale: 'mr', theme: 'night', themeChosen: false, lightSuggested: false };

export async function loadPreferences(): Promise<Preferences> {
  try {
    const rows = await store().settings.bulkGet(['locale', 'theme', 'themeChosen', 'lightSuggested']);
    const [locale, theme, chosen, suggested] = rows.map((r) => r?.value);
    return {
      locale: locale === 'en' || locale === 'mr' ? locale : DEFAULT_PREFERENCES.locale,
      theme: theme === 'field' || theme === 'night' ? theme : DEFAULT_PREFERENCES.theme,
      themeChosen: chosen === true,
      lightSuggested: suggested === true,
    };
  } catch {
    // Private mode or a blocked store: the defaults still render.
    return DEFAULT_PREFERENCES;
  }
}

export async function savePreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
  await store().settings.put({ key, value });
}

export function applyToDocument(preferences: Pick<Preferences, 'locale' | 'theme'>): void {
  const root = document.documentElement;
  root.lang = preferences.locale;
  root.dataset['theme'] = preferences.theme;
  // The browser chrome takes the page ground, read from the tokens rather than repeated here.
  const ground = getComputedStyle(root).getPropertyValue('--ground').trim();
  if (ground !== '') document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground);
}

/**
 * Watch for direct sunlight where the browser exposes an ambient light sensor (Chrome on
 * Android behind a permission). Calls back once when the reading is above `lux`.
 */
export function watchForBrightLight(onBright: () => void, lux = 10_000): () => void {
  const Sensor = (window as unknown as { AmbientLightSensor?: new () => EventTarget & { illuminance: number; start(): void; stop(): void } }).AmbientLightSensor;
  if (Sensor === undefined) return () => undefined;
  try {
    const sensor = new Sensor();
    const read = () => {
      if (sensor.illuminance > lux) {
        onBright();
        sensor.stop();
      }
    };
    sensor.addEventListener('reading', read);
    sensor.addEventListener('error', () => sensor.stop());
    sensor.start();
    return () => sensor.stop();
  } catch {
    return () => undefined;
  }
}
